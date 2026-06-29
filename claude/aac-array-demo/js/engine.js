// Real-time engine: drives the pipeline from either the simulator (Sim mode) or
// the live USB array (Live mode), feeds the visualisers, and optionally plays the
// processed mono output. Both modes call pipeline.processHop() identically — only
// the audio SOURCE differs, which is the whole point of the architecture.

import { Pipeline } from './dsp.js';
import { SimSource } from './sim.js';
import { circularArray } from './geometry.js';

export const FS_SIM = 16000;
export const N = 512, H = 256;

export class Engine {
  constructor() {
    this.Fs = FS_SIM;
    this.mics = circularArray(4, 0.05);
    this.pipeline = new Pipeline(this.Fs, this.mics, N, H);
    this.sim = new SimSource(this.Fs, this.mics);
    this.running = false;
    this.mode = 'sim';
    this.playing = false;
    this.pending = 0;
    this.lastT = 0;
    this.onHop = null;   // callback(outHop, meta) for visualisation
    this.liveQueue = []; // per-channel sample backlog for Live mode
  }

  setRadius(r) {
    this.mics = circularArray(4, r);
    this.pipeline.setConfig(this.Fs, this.mics);
    this.sim.setGeometry(this.mics);
  }

  setArrayModel(mode) {
    this.pipeline.setArrayModel(mode);
    this.sim.setArrayModel(mode);
  }

  async enableAudio() {
    if (this.audioCtx) return;
    // Sim runs at 16 kHz; create the context at that rate so playback pitch is correct.
    this.audioCtx = new AudioContext({ sampleRate: this.Fs });
    await this.audioCtx.audioWorklet.addModule('js/player-worklet.js');
    this.player = new AudioWorkletNode(this.audioCtx, 'player');
    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.value = 0.8;
    this.player.connect(this.gainNode).connect(this.audioCtx.destination);
  }

  setVolume(v) { if (this.gainNode) this.gainNode.gain.value = v; }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastT = performance.now();
    this.pending = 0;
    const loop = (t) => {
      if (!this.running) return;
      const dt = (t - this.lastT) / 1000;
      this.lastT = t;
      if (this.mode === 'sim') this.runSim(dt);
      else this.runLive();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() { this.running = false; }

  runSim(dt) {
    // generate real-time worth of audio, processed hop by hop
    this.pending += Math.min(dt, 0.1) * this.Fs; // cap after tab-switch stalls
    while (this.pending >= H) {
      const { mics, ref } = this.sim.generate(H);
      const out = this.pipeline.processHop(mics, ref);
      this.emit(out);
      this.pending -= H;
    }
  }

  runLive() {
    // consume backlog from the capture worklet, one hop at a time
    while (this.liveQueue.length >= H) {
      const inCh = this.mics.map(() => new Float32Array(H));
      for (let i = 0; i < H; i++) {
        const frame = this.liveQueue.shift();
        for (let m = 0; m < this.mics.length; m++) inCh[m][i] = frame[m] || 0;
      }
      const out = this.pipeline.processHop(inCh, null);
      this.emit(out);
    }
  }

  emit(out) {
    if (this.playing && this.player) this.player.port.postMessage(out);
    if (this.onHop) this.onHop(out, this.pipeline.meta);
  }

  // ---- Live mode: connect the USB microphone array ----
  async startLive() {
    await this.enableAudio();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: { ideal: this.mics.length }, // ReSpeaker exposes a multichannel UAC2 device
        echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      },
    });
    const track = stream.getAudioTracks()[0];
    const settings = track.getSettings();
    // adopt the device's real sample rate for correct DOA/BF math
    this.Fs = this.audioCtx.sampleRate;
    this.pipeline.setConfig(this.Fs, this.mics);

    await this.audioCtx.audioWorklet.addModule('js/capture-worklet.js');
    const src = this.audioCtx.createMediaStreamSource(stream);
    const cap = new AudioWorkletNode(this.audioCtx, 'capture', { channelCountMode: 'explicit', channelCount: this.mics.length });
    cap.port.onmessage = (e) => {
      const chans = e.data; // array[ch] of Float32Array(128)
      const len = chans[0].length;
      for (let i = 0; i < len; i++) {
        const frame = new Float32Array(this.mics.length);
        for (let m = 0; m < this.mics.length; m++) frame[m] = chans[m] ? chans[m][i] : 0;
        this.liveQueue.push(frame);
      }
    };
    src.connect(cap);
    // worklet still needs to be pulled by the graph; route through a muted gain
    const mute = this.audioCtx.createGain(); mute.gain.value = 0;
    cap.connect(mute).connect(this.audioCtx.destination);

    this.mode = 'live';
    return { channels: settings.channelCount || '?', sampleRate: this.Fs };
  }
}
