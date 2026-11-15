// Collects microphone audio into ~100 ms chunks of 16-bit PCM for streaming.
class PcmChunker extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.round(sampleRate * 0.1);
    this.buf = new Int16Array(this.size);
    this.n = 0;
    this.sumSq = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      this.sumSq += s * s;
      this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === this.size) {
        const pcm = this.buf.buffer;
        this.port.postMessage({ pcm, level: Math.sqrt(this.sumSq / this.size) }, [pcm]);
        this.buf = new Int16Array(this.size);
        this.n = 0;
        this.sumSq = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-chunker', PcmChunker);
