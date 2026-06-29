// The AAC signal-flow pipeline, implemented as a single overlap-add STFT processor.
// Block order mirrors aac_blockdiagram.jpg (adapted to a 4-mic array):
//
//   4ch in -> VAD -> AEC & ANR -> Dereverb -> AGC -> [DOA] -> BF -> Voice Filter -> Gain -> out
//                                                       |__angle__^         ^__Voice ID
//
// Design notes:
//  * Spectral cleaners (ANR, Dereverb) apply ONE shared real gain mask to all four
//    channels, so inter-channel phase is preserved and DOA/BF still work afterwards.
//  * DOA uses SRP-PHAT (steered response power, phase transform) over the live
//    spectra — robust on a small circular array and reuses the per-channel FFTs.
//  * BF is a delay-and-sum beamformer steered to the estimated (or manual) angle.
//  * Voice Filter / Voice Recognition (Voice ID) are intentionally a controllable
//    mock (see params.targetPresent) — real speaker-ID needs an enrolled model.

import { fft, ifft, hann } from './fft.js';
import { SPEED_OF_SOUND } from './geometry.js';
import { manifoldAt, spherePrecompute } from './sphere.js';

export class Pipeline {
  constructor(Fs, mics, N = 512, H = 256) {
    this.N = N; this.H = H;
    this.K = (N >> 1) + 1;
    this.win = hann(N);
    this.cola = 0.75; // Hann^2 overlap-add normalisation at 50% hop

    // tunable pipeline state (driven by the UI)
    this.params = {
      vad: true, aec: false, anr: true, dereverb: true, agc: true,
      beamform: true, autoDoa: true, manualAngle: 90,
      voiceFilter: false, targetPresent: true,
      gainDb: 0,
    };

    // outputs exposed for visualisation each hop (filled/sized in setConfig)
    this.meta = {
      vadFlag: false, vadProb: 0, estAngle: 90, srp: null, angles: null,
      inRms: 0, outRms: 0, agcGain: 1, gateOpen: true, ymag: null,
    };

    // array acoustic model: 'free' | 'bd' | 'exact' (sphere-aware steering)
    this.arrayModel = 'free';

    this.setConfig(Fs, mics);
  }

  setConfig(Fs, mics) {
    this.Fs = Fs;
    this.mics = mics;
    const N = this.N, K = this.K, M = mics.length;
    this.M = M;
    this.a = Math.hypot(mics[0].x, mics[0].y) || 0.05; // sphere/array radius (m)
    this.micUnit = mics.map((m) => { const r = Math.hypot(m.x, m.y) || 1; return { x: m.x / r, y: m.y / r }; });

    // per-channel ring buffers + scratch FFT buffers
    this.inbuf = Array.from({ length: M }, () => new Float32Array(N));
    this.refbuf = new Float32Array(N);
    this.re = Array.from({ length: M }, () => new Float32Array(N));
    this.im = Array.from({ length: M }, () => new Float32Array(N));
    this.refRe = new Float32Array(N); this.refIm = new Float32Array(N);
    this.outOverlap = new Float32Array(N);

    // spectral state
    this.noisePsd = new Float32Array(K).fill(1e-6);
    this.priori = new Float32Array(K).fill(1);
    this.prevPow = new Float32Array(K);
    this.noiseFloor = 1e-6;
    this.agcGain = 1; this.vadHang = 0;
    this.aecW = Array.from({ length: M }, () => ({ re: new Float32Array(K), im: new Float32Array(K) }));

    // bin frequencies (rad/sec)
    this.omega = new Float32Array(K);
    for (let k = 0; k < K; k++) this.omega[k] = (2 * Math.PI * k * Fs) / N;

    // SRP-PHAT band (use 300..min(4000, Nyquist) Hz to dodge low rumble & aliasing)
    this.kLo = Math.max(1, Math.round((300 * N) / Fs));
    this.kHi = Math.min(K - 1, Math.round((4000 * N) / Fs));

    // representative bins for the (broadband-averaged) beam-pattern plot
    this.bpBins = [];
    const nb = 16;
    for (let i = 0; i < nb; i++) this.bpBins.push(Math.round(this.kLo + ((this.kHi - this.kLo) * i) / (nb - 1)));

    this.buildManifold();
    this.meta.angles = this.srpAngles;
    this.meta.srp = new Float32Array(this.srpAngles.length);
    this.meta.ymag = new Float32Array(K);
  }

  setArrayModel(mode) { this.arrayModel = mode; this.buildManifold(); }

  // Build the array manifold a_m(theta,k) for the current model over a 3-degree
  // angle grid and ALL bins, plus the matched-filter steering weights:
  //   w_m = conj(a_m) / sqrt(sum_m |a_m|^2)   (SRP-PHAT / delay-and-sum, generalised)
  // Free field reduces a_m to exp(+j w tau_m); the sphere models add diffraction.
  buildManifold() {
    const c = SPEED_OF_SOUND, K = this.K, M = this.M, a = this.a, mode = this.arrayModel;
    const angles = []; for (let d = 0; d < 360; d += 3) angles.push(d);
    this.srpAngles = angles;
    const A = angles.length;
    const mk = () => Array.from({ length: A }, () => Array.from({ length: M }, () => new Float32Array(K)));
    this.aRe = mk(); this.aIm = mk(); this.wRe = mk(); this.wIm = mk();
    this.bfNorm = Array.from({ length: A }, () => new Float32Array(K));
    const dir = angles.map((d) => ({ x: Math.cos((d * Math.PI) / 180), y: Math.sin((d * Math.PI) / 180) }));

    for (let k = 0; k < K; k++) {
      const ka = (this.omega[k] * a) / c;
      const pre = mode === 'exact' ? spherePrecompute(Math.max(ka, 1e-3)) : null;
      for (let ai = 0; ai < A; ai++) {
        let norm = 0;
        for (let m = 0; m < M; m++) {
          const cosG = this.micUnit[m].x * dir[ai].x + this.micUnit[m].y * dir[ai].y;
          const am = manifoldAt(mode, cosG, ka, this.omega[k], a, c, pre);
          this.aRe[ai][m][k] = am.re; this.aIm[ai][m][k] = am.im;
          norm += am.re * am.re + am.im * am.im;
        }
        this.bfNorm[ai][k] = norm;
        const inv = 1 / Math.sqrt(norm + 1e-20);
        for (let m = 0; m < M; m++) { // w = conj(a)/sqrt(norm)
          this.wRe[ai][m][k] = this.aRe[ai][m][k] * inv;
          this.wIm[ai][m][k] = -this.aIm[ai][m][k] * inv;
        }
      }
    }
  }

  angleIndex(deg) { return ((Math.round(((deg % 360) + 360) % 360 / 3)) % this.srpAngles.length); }

  // Array response |B| at grid angle `ai` when steered to grid angle `si`, RMS over
  // the beam-pattern band:  B = sum_m conj(a_m(si)) a_m(ai) / sum_m |a_m(si)|^2
  bResponseGrid(si, ai) {
    const M = this.M;
    let acc = 0;
    for (const k of this.bpBins) {
      let sr = 0, sii = 0;
      for (let m = 0; m < M; m++) {
        const sr0 = this.aRe[si][m][k], si0 = this.aIm[si][m][k];   // a_m(steer)
        const ar = this.aRe[ai][m][k], ai0 = this.aIm[ai][m][k];     // a_m(theta)
        sr += sr0 * ar + si0 * ai0;        // Re{ conj(a_steer) a_theta }
        sii += sr0 * ai0 - si0 * ar;       // Im{ ... }
      }
      const n = this.bfNorm[si][k] + 1e-20;
      acc += (sr * sr + sii * sii) / (n * n);
    }
    return Math.sqrt(acc / this.bpBins.length);
  }

  beamGainAt(angleDeg, steerDeg) { return this.bResponseGrid(this.angleIndex(steerDeg), this.angleIndex(angleDeg)); }

  beamPattern(steerDeg) {
    const si = this.angleIndex(steerDeg);
    const angles = this.srpAngles, A = angles.length;
    const mag = new Float32Array(A);
    for (let ai = 0; ai < A; ai++) mag[ai] = this.bResponseGrid(si, ai);
    return { angles, mag };
  }

  // Process one hop. inCh: Float32Array[M] of length H. ref: Float32Array(H) or null.
  // Returns the mono output hop (Float32Array length H); fills this.meta.
  processHop(inCh, ref) {
    const { N, H, K, M, win } = this;
    const p = this.params;

    // ---- shift hops into the analysis buffers ----
    let inEnergy = 0;
    for (let m = 0; m < M; m++) {
      this.inbuf[m].copyWithin(0, H);
      this.inbuf[m].set(inCh[m], N - H);
      for (let i = 0; i < H; i++) inEnergy += inCh[m][i] * inCh[m][i];
    }
    this.meta.inRms = Math.sqrt(inEnergy / (H * M));
    if (ref) { this.refbuf.copyWithin(0, H); this.refbuf.set(ref, N - H); }

    // ---- analysis FFT per channel ----
    for (let m = 0; m < M; m++) {
      const re = this.re[m], im = this.im[m], buf = this.inbuf[m];
      for (let n = 0; n < N; n++) { re[n] = buf[n] * win[n]; im[n] = 0; }
      fft(re, im);
    }
    if (p.aec && ref) {
      for (let n = 0; n < N; n++) { this.refRe[n] = this.refbuf[n] * win[n]; this.refIm[n] = 0; }
      fft(this.refRe, this.refIm);
    }

    // ---- average power spectrum across channels ----
    const Xpow = this.prevScratch || (this.prevScratch = new Float32Array(K));
    for (let k = 0; k < K; k++) {
      let s = 0;
      for (let m = 0; m < M; m++) s += this.re[m][k] * this.re[m][k] + this.im[m][k] * this.im[m][k];
      Xpow[k] = s / M;
    }

    // ---- VAD (band SNR vs tracked noise floor, with hangover) ----
    let band = 0;
    for (let k = this.kLo; k <= this.kHi; k++) band += Xpow[k];
    if (band < this.noiseFloor) this.noiseFloor = band; else this.noiseFloor *= 1.0008;
    const snr = band / (this.noiseFloor + 1e-9);
    let speech = snr > 3.5;
    if (p.vad) {
      if (speech) this.vadHang = 8; else if (this.vadHang > 0) { this.vadHang--; speech = true; }
    } else speech = true;
    this.meta.vadFlag = speech;
    this.meta.vadProb = Math.max(0, Math.min(1, Math.log10(snr + 1e-9) / Math.log10(20)));

    // ---- AEC: per-channel frequency-domain NLMS using the far-end reference ----
    if (p.aec && ref) {
      for (let m = 0; m < M; m++) {
        const W = this.aecW[m], re = this.re[m], im = this.im[m];
        for (let k = 0; k < K; k++) {
          const Rr = this.refRe[k], Ri = this.refIm[k];
          const er = W.re[k] * Rr - W.im[k] * Ri;   // estimated echo
          const ei = W.re[k] * Ri + W.im[k] * Rr;
          const yr = re[k] - er, yi = im[k] - ei;   // error = cleaned signal
          const norm = Rr * Rr + Ri * Ri + 1e-3;
          const mu = 0.4 / norm;
          W.re[k] += mu * (Rr * yr + Ri * yi);       // mu * conj(R) * err
          W.im[k] += mu * (Rr * yi - Ri * yr);
          re[k] = yr; im[k] = yi;
        }
      }
    }

    // ---- ANR (spectral cleaner) + Dereverb -> ONE shared gain mask ----
    const G = this.maskScratch || (this.maskScratch = new Float32Array(K));
    G.fill(1);
    if (p.anr) {
      if (!speech) for (let k = 0; k < K; k++) this.noisePsd[k] = 0.95 * this.noisePsd[k] + 0.05 * Xpow[k];
      for (let k = 0; k < K; k++) {
        const post = Xpow[k] / (this.noisePsd[k] + 1e-9);
        // decision-directed a priori SNR
        this.priori[k] = 0.92 * this.priori[k] + 0.08 * Math.max(post - 1, 0);
        const g = this.priori[k] / (1 + this.priori[k]); // Wiener
        G[k] *= Math.max(0.08, g);
      }
    }
    if (p.dereverb) {
      for (let k = 0; k < K; k++) {
        const lateEst = 0.5 * this.prevPow[k];       // crude late-reverb estimate
        const g = (Xpow[k] - lateEst) / (Xpow[k] + 1e-9);
        G[k] *= Math.max(0.15, g);
      }
    }
    for (let k = 0; k < K; k++) this.prevPow[k] = Xpow[k];
    // apply shared mask to all channels (preserves inter-channel phase)
    if (p.anr || p.dereverb) {
      for (let m = 0; m < M; m++) {
        const re = this.re[m], im = this.im[m];
        for (let k = 0; k < K; k++) { re[k] *= G[k]; im[k] *= G[k]; }
      }
    }

    // ---- AGC: broadband scalar toward a target level (freeze during silence) ----
    if (p.agc) {
      let pw = 0; for (let k = this.kLo; k <= this.kHi; k++) pw += Xpow[k];
      const level = Math.sqrt(pw / (this.kHi - this.kLo + 1)) + 1e-6;
      if (speech) {
        const want = Math.min(8, 0.05 / level); // target level ~0.05, max +18 dB
        this.agcGain += (want - this.agcGain) * (want > this.agcGain ? 0.02 : 0.2);
      }
    } else this.agcGain = 1;
    const ag = this.agcGain;
    this.meta.agcGain = ag;

    // ---- DOA: SRP-PHAT over the (phase-preserving) spectra ----
    // PHAT-weighted, unit-magnitude spectra
    const hr = this._hr || (this._hr = Array.from({ length: M }, () => new Float32Array(K)));
    const hi = this._hi || (this._hi = Array.from({ length: M }, () => new Float32Array(K)));
    for (let m = 0; m < M; m++) {
      const re = this.re[m], im = this.im[m];
      for (let k = this.kLo; k <= this.kHi; k++) {
        const mag = Math.hypot(re[k], im[k]) + 1e-9;
        hr[m][k] = re[k] / mag; hi[m][k] = im[k] / mag;
      }
    }
    const A = this.srpAngles.length;
    let best = 0, bestVal = -1;
    for (let ai = 0; ai < A; ai++) {
      let pwr = 0;
      for (let k = this.kLo; k <= this.kHi; k++) {
        let ar = 0, aii = 0;
        for (let m = 0; m < M; m++) {
          const wr = this.wRe[ai][m][k], wi = this.wIm[ai][m][k];
          ar += hr[m][k] * wr - hi[m][k] * wi;
          aii += hr[m][k] * wi + hi[m][k] * wr;
        }
        pwr += ar * ar + aii * aii;
      }
      this.meta.srp[ai] = pwr;
      if (pwr > bestVal) { bestVal = pwr; best = ai; }
    }
    // parabolic interpolation around the peak for sub-grid resolution
    const a0 = this.meta.srp[(best - 1 + A) % A], a1 = this.meta.srp[best], a2 = this.meta.srp[(best + 1) % A];
    const denom = a0 - 2 * a1 + a2;
    const frac = denom !== 0 ? 0.5 * (a0 - a2) / denom : 0;
    let estAngle = (this.srpAngles[best] + 3 * frac + 360) % 360;
    if (speech) this.meta.estAngle = estAngle; else estAngle = this.meta.estAngle;

    // ---- BF: matched-filter (delay-and-sum) steered via the array manifold ----
    //   Y = sum_m conj(a_m(steer)) X_m / sum_m |a_m(steer)|^2
    // Free field => (1/M) sum_m exp(-j w tau_m) X_m; sphere models use diffraction.
    const steer = p.autoDoa ? this.meta.estAngle : p.manualAngle;
    const si = this.angleIndex(steer);
    const Yre = this.Yre || (this.Yre = new Float32Array(N));
    const Yim = this.Yim || (this.Yim = new Float32Array(N));
    Yre.fill(0); Yim.fill(0);
    for (let k = 0; k < K; k++) {
      let sr = 0, sii = 0;
      if (p.beamform) {
        for (let m = 0; m < M; m++) {
          const ar = this.aRe[si][m][k], aim = this.aIm[si][m][k]; // a_m(steer)
          const xr = this.re[m][k], xi = this.im[m][k];
          sr += ar * xr + aim * xi;     // Re{ conj(a) X }
          sii += ar * xi - aim * xr;    // Im{ conj(a) X }
        }
        const n = this.bfNorm[si][k] + 1e-20;
        sr /= n; sii /= n;
      } else { sr = this.re[0][k]; sii = this.im[0][k]; } // bypass -> mic 0
      Yre[k] = sr * ag; Yim[k] = sii * ag;
    }

    // ---- Voice Filter (gated by Voice ID + VAD) and output Gain ----
    let gate = 1;
    if (p.voiceFilter) gate *= p.targetPresent && speech ? 1 : 0.05;
    this.meta.gateOpen = gate > 0.5;
    const outGain = gate * Math.pow(10, p.gainDb / 20);
    for (let k = 0; k < K; k++) { Yre[k] *= outGain; Yim[k] *= outGain; this.meta.ymag[k] = Math.hypot(Yre[k], Yim[k]); }

    // ---- Hermitian-symmetric IFFT -> synthesis window -> overlap-add ----
    for (let k = 1; k < K - 1; k++) { Yre[N - k] = Yre[k]; Yim[N - k] = -Yim[k]; }
    Yim[0] = 0; Yim[N >> 1] = 0;
    ifft(Yre, Yim);
    const out = new Float32Array(H);
    const norm = 1 / this.cola;
    for (let n = 0; n < N; n++) this.outOverlap[n] += Yre[n] * win[n] * norm;
    let oe = 0;
    for (let n = 0; n < H; n++) {
      let v = this.outOverlap[n];
      if (v > 1) v = 1; else if (v < -1) v = -1;
      out[n] = v; oe += v * v;
    }
    this.meta.outRms = Math.sqrt(oe / H);
    this.outOverlap.copyWithin(0, H);
    this.outOverlap.fill(0, N - H);

    return out;
  }
}
