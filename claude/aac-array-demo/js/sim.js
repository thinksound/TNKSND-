// Acoustic scene simulator.
//
// Produces 4 microphone channels from a virtual scene so the DSP pipeline has
// something realistic to chew on before the real ReSpeaker array is connected:
//   - a "target" talker at a chosen azimuth (speech-like, voiced formant model)
//   - an optional "interferer" talker at another azimuth
//   - per-mic independent (diffuse) noise
//   - simple reverberation (a few attenuated, delayed reflections)
//   - an optional far-end echo with a known reference signal (for the AEC demo)
//
// Per-mic propagation uses the real array geometry: each mic reads the clean
// source from a fractional-delay history line, so inter-channel phase is correct
// and DOA / beamforming actually work on the result.

import { arrivalTau, SPEED_OF_SOUND } from './geometry.js';
import { ifft } from './fft.js';
import { manifoldAt, spherePrecompute } from './sphere.js';

// One-pole resonator used as a crude vocal-tract formant filter.
class Resonator {
  constructor() { this.a1 = 0; this.a2 = 0; this.g = 1; this.z1 = 0; this.z2 = 0; }
  set(f, bw, Fs) {
    const r = Math.exp(-Math.PI * bw / Fs);
    this.a1 = 2 * r * Math.cos((2 * Math.PI * f) / Fs);
    this.a2 = -r * r;
    this.g = 1 - r * r; // rough normalisation
  }
  proc(x) {
    const y = this.g * x + this.a1 * this.z1 + this.a2 * this.z2;
    this.z2 = this.z1; this.z1 = y;
    return y;
  }
}

// A speech-like voice: glottal impulse train -> 3 formants, gated into syllables.
class Voice {
  constructor(Fs, f0, formants) {
    this.Fs = Fs;
    this.f0 = f0;
    this.phase = 0;            // glottal phase, fires an impulse each period
    this.res = [new Resonator(), new Resonator(), new Resonator()];
    this.baseFormants = formants;
    this.setFormants(formants);
    // syllable gate state machine
    this.state = 'silence';
    this.timer = 0.2;
    this.env = 0;             // smoothed amplitude envelope
    this.vibrato = 0;
  }
  setFormants(f) {
    const bw = [80, 100, 160];
    for (let i = 0; i < 3; i++) this.res[i].set(f[i], bw[i], this.Fs);
  }
  sample() {
    const dt = 1 / this.Fs;
    // ---- syllable gating -> drives the amplitude envelope target ----
    this.timer -= dt;
    if (this.timer <= 0) {
      if (this.state === 'silence') {
        this.state = 'voiced';
        this.timer = 0.15 + Math.random() * 0.35;
        // pick a new vowel each syllable (jitter formants a little)
        this.setFormants(this.baseFormants.map((x) => x * (0.85 + Math.random() * 0.3)));
      } else {
        this.state = 'silence';
        this.timer = 0.1 + Math.random() * 0.35;
      }
    }
    const target = this.state === 'voiced' ? 1 : 0;
    this.env += (target - this.env) * 0.002; // smooth attack/decay

    // ---- glottal excitation (impulse train) ----
    this.vibrato += dt;
    const f0 = this.f0 * (1 + 0.03 * Math.sin(2 * Math.PI * 5 * this.vibrato));
    this.phase += f0 * dt;
    let exc = 0;
    if (this.phase >= 1) { this.phase -= 1; exc = 1; }
    exc += 0.05 * (Math.random() * 2 - 1); // aspiration noise

    // ---- formant filtering ----
    let y = 0;
    for (let i = 0; i < 3; i++) y += this.res[i].proc(exc) * (i === 0 ? 1 : 0.6);
    return y * this.env * 0.5;
  }
}

// Fractional-delay history line (linear interpolation), addressed by absolute
// sample index. Long enough to cover propagation + reverb delays.
class History {
  constructor(size) { this.buf = new Float32Array(size); this.size = size; this.written = 0; }
  push(v) { this.buf[this.written % this.size] = v; this.written++; }
  read(idx) {
    const i0 = Math.floor(idx);
    const f = idx - i0;
    const a = this.buf[((i0 % this.size) + this.size) % this.size];
    const b = this.buf[(((i0 + 1) % this.size) + this.size) % this.size];
    return a + (b - a) * f;
  }
}

export class SimSource {
  constructor(Fs, mics) {
    this.Fs = Fs;
    this.mics = mics;
    this.c = SPEED_OF_SOUND;
    this.n = 0; // absolute sample counter

    this.target = new Voice(Fs, 120, [600, 1400, 2600]);
    this.interf = new Voice(Fs, 180, [500, 1900, 2900]);
    this.targetHist = new History(8192);
    this.interfHist = new History(8192);
    this.refHist = new History(8192);
    this.refPhase = 0;

    // global delay offset (seconds) so per-mic read indices stay in the past
    this.delayOffset = 0.005;

    // editable scene parameters (set from the UI)
    this.params = {
      targetAngle: 90,     // degrees
      targetLevel: 1.0,
      interfOn: false,
      interfAngle: 200,
      interfLevel: 0.7,
      noiseLevel: 0.02,    // diffuse per-mic noise amplitude
      reverb: 0.0,         // 0..1
      echoOn: false,
      echoLevel: 0.3,
    };

    // a few reverb taps (delay in seconds, gain) — diffuse-ish tail
    this.revTaps = [
      [0.013, 0.6], [0.021, 0.45], [0.031, 0.35],
      [0.043, 0.27], [0.057, 0.2], [0.071, 0.15],
    ];

    // array acoustic model + per-source/per-mic sphere FIRs (built lazily)
    this.arrayModel = 'free';                 // 'free' | 'bd' | 'exact'
    this.radius = Math.hypot(mics[0].x, mics[0].y) || 0.05;
    const L = 64;
    this.firRing = { L, pos: 0, target: new Float32Array(L), interf: new Float32Array(L) };
    this.fir = null; this._sig = '';
  }

  setGeometry(mics) { this.mics = mics; this.radius = Math.hypot(mics[0].x, mics[0].y) || 0.05; this._sig = ''; }
  setArrayModel(mode) { this.arrayModel = mode; this._sig = ''; }
  _sigOf() { const p = this.params; return `${this.arrayModel}|${p.targetAngle}|${p.interfAngle}|${this.radius}`; }

  // Build L-tap impulse responses that turn each clean source into the per-mic
  // sphere-diffracted signal (one FIR per source per mic). Rebuilt when the model,
  // a source angle, or the radius changes. A common modeling delay (L/2 samples)
  // keeps them causal; it cancels across mics so DOA is unaffected.
  buildFIRs() {
    const Fs = this.Fs, c = this.c, a = this.radius, mode = this.arrayModel, M = this.mics.length;
    const Nf = 256, Kf = (Nf >> 1) + 1, L = this.firRing.L, tau0 = L / 2;
    const micU = this.mics.map((m) => { const r = Math.hypot(m.x, m.y) || 1; return { x: m.x / r, y: m.y / r }; });
    this.fir = { target: [], interf: [] };
    const sources = [['target', this.params.targetAngle], ['interf', this.params.interfAngle]];
    for (const [name, angle] of sources) {
      const dir = { x: Math.cos((angle * Math.PI) / 180), y: Math.sin((angle * Math.PI) / 180) };
      const re = Array.from({ length: M }, () => new Float32Array(Nf));
      const im = Array.from({ length: M }, () => new Float32Array(Nf));
      for (let k = 0; k < Kf; k++) {
        const w = (2 * Math.PI * k * Fs) / Nf, ka = (w * a) / c;
        const pre = mode === 'exact' ? spherePrecompute(Math.max(ka, 1e-3)) : null;
        const ph0 = -w * (tau0 / Fs), cr0 = Math.cos(ph0), ci0 = Math.sin(ph0); // modeling delay
        for (let m = 0; m < M; m++) {
          const cosG = micU[m].x * dir.x + micU[m].y * dir.y;
          const am = manifoldAt(mode, cosG, ka, w, a, c, pre);
          re[m][k] = am.re * cr0 - am.im * ci0;
          im[m][k] = am.re * ci0 + am.im * cr0;
        }
      }
      for (let m = 0; m < M; m++) {
        for (let k = 1; k < Kf - 1; k++) { re[m][Nf - k] = re[m][k]; im[m][Nf - k] = -im[m][k]; }
        im[m][0] = 0; im[m][Nf >> 1] = 0;
        ifft(re[m], im[m]);
        const h = new Float32Array(L);
        for (let l = 0; l < L; l++) h[l] = re[m][l]; // impulse sits near tau0, inside [0,L)
        this.fir[name].push(h);
      }
    }
  }

  // Far-end reference signal (what a "speaker" plays) — a simple two-tone so it is
  // clearly distinct from speech; the AEC block receives this as ground truth.
  refSample() {
    this.refPhase += 1 / this.Fs;
    return 0.5 * (Math.sin(2 * Math.PI * 330 * this.refPhase) +
                  0.6 * Math.sin(2 * Math.PI * 550 * this.refPhase));
  }

  // Generate `len` samples. Returns { mics: Float32Array[4], ref: Float32Array }.
  generate(len) {
    const p = this.params;
    const M = this.mics.length;
    const out = Array.from({ length: M }, () => new Float32Array(len));
    const ref = new Float32Array(len);
    const c = this.c, Fs = this.Fs;

    const sphere = this.arrayModel !== 'free';
    if (sphere) { const sig = this._sigOf(); if (sig !== this._sig) { this.buildFIRs(); this._sig = sig; } }

    // free-field direct-path delays (used only when sphere model is off)
    const tauT = arrivalTau(this.mics, (p.targetAngle * Math.PI) / 180, c);
    const tauI = arrivalTau(this.mics, (p.interfAngle * Math.PI) / 180, c);
    const ring = this.firRing, L = ring.L;
    const dOff = this.delayOffset * Fs;

    for (let k = 0; k < len; k++) {
      // advance clean sources and store in history
      this.targetHist.push(this.target.sample() * p.targetLevel);
      this.interfHist.push((p.interfOn ? this.interf.sample() : 0) * p.interfLevel);
      const r = this.refSample();
      this.refHist.push(r);
      ref[k] = r;
      const nAbs = this.n + k;

      // ---- direct path ----
      if (sphere) {
        // push common-delayed clean samples, then convolve with each mic's sphere FIR
        const pos = ring.pos;
        ring.target[pos] = this.targetHist.read(nAbs - dOff);
        ring.interf[pos] = this.interfHist.read(nAbs - dOff);
        for (let m = 0; m < M; m++) {
          const ft = this.fir.target[m], fi = this.fir.interf[m];
          let v = 0;
          for (let l = 0; l < L; l++) { const idx = (pos - l + L) % L; v += ft[l] * ring.target[idx] + fi[l] * ring.interf[idx]; }
          out[m][k] = v;
        }
        ring.pos = (pos + 1) % L;
      } else {
        for (let m = 0; m < M; m++) {
          const dT = (this.delayOffset - tauT[m]) * Fs;
          const dI = (this.delayOffset - tauI[m]) * Fs;
          out[m][k] = this.targetHist.read(nAbs - dT) + this.interfHist.read(nAbs - dI);
        }
      }

      // ---- reverb / echo / noise (same for both models) ----
      for (let m = 0; m < M; m++) {
        let v = out[m][k];
        if (p.reverb > 0) {
          for (const [td, g] of this.revTaps) {
            const idx = nAbs - dOff - td * Fs;
            v += p.reverb * g * (this.targetHist.read(idx) + this.interfHist.read(idx));
          }
        }
        if (p.echoOn) v += p.echoLevel * this.refHist.read(nAbs - 0.004 * Fs);
        v += p.noiseLevel * (Math.random() * 2 - 1);
        out[m][k] = v;
      }
    }
    this.n += len;
    return { mics: out, ref };
  }
}
