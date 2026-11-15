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
      onResult: (text, turn) => this.result(text, turn),
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

  result(text, turn) {
    if (!this.active || turn !== this.turn) return;
    const msg = { turn_order: turn, transcript: text, end_of_turn: false };
    this.h.onTurn(msg);
    // The phone never says "that's the end of the sentence" mid-question, so
    // treat a transcript that has stopped changing as finished.
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.active && turn === this.turn) this.h.onTurn({ ...msg, end_of_turn: true });
    }, 900);
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
