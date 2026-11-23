// Microphone -> AssemblyAI streaming speech-to-text.
// The browser only ever sees a short-lived token minted by our server.

const WS_URL = 'wss://streaming.assemblyai.com/v3/ws';

// Inside the iOS app the page talks to native code instead of AssemblyAI.
export const nativeBridge =
  (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.voice) || null;

/**
 * Same shape as VoiceInput, backed by the iPhone's on-device speech
 * recognition. The native side sends the running transcript for the current
 * question; reset() starts a clean transcript when a new question appears.
 */
export class NativeVoiceInput {
  constructor(handlers) {
    this.h = handlers;
    this.active = false;
    this.turn = 0;
    this.timer = 0;
    window.__nativeVoice = {
      onResult: (text, turn, alternatives) => this.result(text, turn, alternatives),
      onState: (state, detail) => {
        if (!this.active) return;
        if (state === 'error') this.active = false;
        this.h.onState(state, detail);
      },
    };
  }

  post(msg) {
    try {
      nativeBridge.postMessage(msg);
    } catch {}
  }

  /** @param {string[]} [hints] words the recogniser should expect in this game */
  start(hints = []) {
    if (this.active) return;
    this.active = true;
    this.h.onState('connecting');
    this.post({ cmd: 'start', turn: this.turn, hints });
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    clearTimeout(this.timer);
    this.post({ cmd: 'stop' });
    this.h.onState('off');
  }

  reset() {
    clearTimeout(this.timer);
    this.turn++;
    if (this.active) this.post({ cmd: 'reset', turn: this.turn });
  }

  /** @param {string[]} [alternatives] the recogniser's other readings of the same speech */
  result(text, turn, alternatives = []) {
    if (!this.active || turn !== this.turn) return;
    const msg = { turn_order: turn, transcript: text, alternatives, end_of_turn: false };
    this.h.onTurn(msg);
    // The phone never says "that's the end of the sentence" mid-question, so
    // treat a transcript that has stopped changing as finished. Children stop
    // to think mid-answer, so allow a good pause before calling it wrong.
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.active && turn === this.turn) this.h.onTurn({ ...msg, end_of_turn: true });
    }, 1500);
  }
}

export class VoiceInput {
  /**
   * @param {{onTurn:(msg:object)=>void, onState:(state:string, detail?:string)=>void, onLevel?:(level:number)=>void}} handlers
   * States: 'off' | 'connecting' | 'listening' | 'error'
   */
  constructor(handlers) {
    this.h = handlers;
    this.active = false;
    this.ws = null;
    this.ctx = null;
    this.stream = null;
    this.retries = 0;
  }

  async start() {
    if (this.active) return;
    this.active = true;
    this.h.onState('connecting');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (!this.active) {
        // Stopped while the permission prompt was up: release the mic again.
        this.stream.getTracks().forEach((t) => t.stop());
        this.stream = null;
        return;
      }
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx({ sampleRate: 16000 });
      await this.ctx.audioWorklet.addModule('pcm-worklet.js');
      if (!this.active) return;
      const source = this.ctx.createMediaStreamSource(this.stream);
      const node = new AudioWorkletNode(this.ctx, 'pcm-chunker');
      node.port.onmessage = (e) => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(e.data.pcm);
        if (this.h.onLevel) this.h.onLevel(e.data.level);
      };
      const silent = this.ctx.createGain();
      silent.gain.value = 0;
      source.connect(node).connect(silent).connect(this.ctx.destination);
      await this.connect();
    } catch (err) {
      if (!this.active) return;
      const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      const missing = err && (err.name === 'NotFoundError' || err.name === 'OverconstrainedError');
      this.fail(denied ? 'mic_denied' : missing ? 'no_mic' : err.message || 'voice_failed');
    }
  }

  async connect() {
    const r = await fetch('/api/token', { method: 'POST' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'token_failed');
    if (!this.active) return;

    const params = new URLSearchParams({
      sample_rate: String(this.ctx.sampleRate),
      encoding: 'pcm_s16le',
      token: data.token,
    });
    if (data.speechModel) params.set('speech_model', data.speechModel);

    const ws = new WebSocket(`${WS_URL}?${params}`);
    this.ws = ws;
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === 'Begin') {
        this.retries = 0;
        this.h.onState('listening');
      } else if (msg.type === 'Turn') {
        this.h.onTurn(msg);
      }
    };
    ws.onclose = () => {
      if (!this.active || this.ws !== ws) return;
      // Dropped mid-game: reconnect with a fresh token a few times.
      if (this.retries++ < 4) {
        this.h.onState('connecting');
        setTimeout(() => {
          if (this.active) this.connect().catch((err) => this.fail(err.message));
        }, 800 * this.retries);
      } else {
        this.fail('connection_lost');
      }
    };
  }

  fail(detail) {
    this.stop();
    this.h.onState('error', detail);
  }

  stop() {
    const wasActive = this.active;
    this.active = false;
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'Terminate' }));
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null;
    if (wasActive) this.h.onState('off');
  }
}

/** Opens the microphone as a stream of ~100 ms chunks of 16-bit PCM. */
async function openMic(onChunk) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx({ sampleRate: 16000 });
  const close = () => {
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
  };
  try {
    await ctx.audioWorklet.addModule('pcm-worklet.js');
    const node = new AudioWorkletNode(ctx, 'pcm-chunker');
    node.port.onmessage = (e) => onChunk(e.data.pcm, e.data.level);
    const silent = ctx.createGain();
    silent.gain.value = 0;
    ctx.createMediaStreamSource(stream).connect(node).connect(silent).connect(ctx.destination);
  } catch (err) {
    close();
    throw err;
  }
  return { sampleRate: ctx.sampleRate, close };
}

/**
 * Listens for single short sounds ("sss", "buh") rather than words. Each
 * burst of sound is cut out of the microphone stream and sent to the server's
 * phoneme recogniser; the answer arrives through handlers.onSound as
 * {phonemes, letters: [{letter, score}], startedAt}.
 */
export class PhonemeVoiceInput {
  constructor(handlers) {
    this.h = handlers;
    this.active = false;
    this.mic = null;
    this.noise = 0.004;
    this.target = ''; // the letter on screen, stored with the recording
    this.paused = false;
    this.source = 'game';
    this.clear();
  }

  clear() {
    this.speaking = false;
    this.before = []; // the last few quiet chunks, so the start of a sound is not clipped
    this.clip = [];
    this.quiet = 0;
  }

  async start() {
    if (this.active) return;
    this.active = true;
    this.h.onState('connecting');
    try {
      const mic = await openMic((pcm, level) => this.chunk(pcm, level));
      if (!this.active) return mic.close();
      if (mic.sampleRate !== 16000) {
        mic.close();
        throw new Error('unsupported_sample_rate');
      }
      this.mic = mic;
      this.h.onState('listening');
    } catch (err) {
      if (!this.active) return;
      this.active = false;
      const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      const missing = err && (err.name === 'NotFoundError' || err.name === 'OverconstrainedError');
      this.h.onState('error', denied ? 'mic_denied' : missing ? 'no_mic' : err.message || 'voice_failed');
    }
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    if (this.mic) this.mic.close();
    this.mic = null;
    this.clear();
    this.h.onState('off');
  }

  chunk(pcm, level) {
    if (!this.active) return;
    if (this.h.onLevel) this.h.onLevel(level);
    if (this.h.onChunk) this.h.onChunk(pcm, level);
    if (this.paused) return this.clear(); // e.g. while a clip is being played back
    const loud = level > Math.max(0.012, this.noise * 3);
    if (!this.speaking) {
      if (!loud) this.noise = this.noise * 0.95 + level * 0.05;
      this.before.push(pcm);
      if (this.before.length > 3) this.before.shift();
      if (loud) {
        this.speaking = true;
        this.startedAt = performance.now() - 100;
        this.clip = this.before;
        this.before = [];
        this.quiet = 0;
      }
      return;
    }
    this.clip.push(pcm);
    this.quiet = loud ? 0 : this.quiet + 1;
    // Done after 0.4 s of quiet, or 3 s in total.
    if (this.quiet >= 4 || this.clip.length >= 30) this.send();
  }

  async send() {
    const clip = this.clip;
    const startedAt = this.startedAt;
    this.clear();
    // In the recording game the clip is kept for training instead of recognised.
    if (this.h.onClip && this.h.onClip(clip, startedAt)) return;
    try {
      const query = `target=${encodeURIComponent(this.target || '')}&from=${encodeURIComponent(this.source)}`;
      const r = await fetch(`/api/phonemes?${query}`, { method: 'POST', body: new Blob(clip) });
      if (!r.ok) return;
      const result = await r.json();
      if (this.active && this.h.onSound) this.h.onSound({ ...result, startedAt });
    } catch {}
  }
}
