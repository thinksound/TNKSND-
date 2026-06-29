// Live capture source (used in Live mode with the ReSpeaker USB array).
// Forwards every render quantum's multichannel input to the main thread, which
// re-blocks it into the pipeline's hop size. Copies are required because the
// input arrays are recycled by the audio engine.
class Capture extends AudioWorkletProcessor {
  process(inputs) {
    const inp = inputs[0];
    if (inp && inp.length) {
      const chans = inp.map((c) => Float32Array.from(c));
      this.port.postMessage(chans);
    }
    return true;
  }
}
registerProcessor('capture', Capture);
