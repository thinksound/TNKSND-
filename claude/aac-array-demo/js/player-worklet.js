// Playback sink: buffers mono samples pushed from the main thread and streams them
// to the output. Runs in an AudioContext created at the pipeline's sample rate, so
// no resampling is needed. (Live capture later uses capture-worklet.js instead.)
class Player extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(32768);
    this.r = 0; this.w = 0; this.count = 0;
    this.port.onmessage = (e) => {
      const d = e.data;
      for (let i = 0; i < d.length; i++) {
        this.buf[this.w] = d[i];
        this.w = (this.w + 1) % this.buf.length;
        if (this.count < this.buf.length) this.count++;
        else this.r = (this.r + 1) % this.buf.length; // overrun -> drop oldest
      }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0][0];
    for (let i = 0; i < out.length; i++) {
      if (this.count > 0) { out[i] = this.buf[this.r]; this.r = (this.r + 1) % this.buf.length; this.count--; }
      else out[i] = 0;
    }
    return true;
  }
}
registerProcessor('player', Player);
