// Rigid-sphere acoustic scattering — the diffraction that makes a mic flush on a
// head-sized sphere directional (bright spot facing the source, shadow behind).
// Used in two places:
//   1. sim.js   — to filter the simulated mic signals (realistic head-mounted array)
//   2. dsp.js   — to build the array manifold for sphere-aware DOA / beamforming
//
// Two fidelities:
//   'bd'    Brown & Duda (1998) structural model — 1st-order shelf + sphere delay
//   'exact' rigid-sphere scattering series (spherical Hankel functions)
// plus 'free' (free field) = pure inter-mic delay, magnitude 1.

export const HEAD_RADIUS = 0.0875; // m, typical human head

// Legendre polynomials P_0..P_M at x.
function legendre(M, x) {
  const P = new Float64Array(M + 1);
  P[0] = 1; if (M >= 1) P[1] = x;
  for (let m = 1; m < M; m++) P[m + 1] = ((2 * m + 1) * x * P[m] - m * P[m - 1]) / (m + 1);
  return P;
}

// Spherical Bessel j_m, y_m for m=0..M at x>0.
// y_m: stable upward recurrence. j_m: downward (Miller) recurrence then normalise.
function sphBesselJY(M, x) {
  const j = new Float64Array(M + 1), y = new Float64Array(M + 1);
  y[0] = -Math.cos(x) / x;
  if (M >= 1) y[1] = -Math.cos(x) / (x * x) - Math.sin(x) / x;
  for (let m = 1; m < M; m++) y[m + 1] = ((2 * m + 1) / x) * y[m] - y[m - 1];

  const start = M + Math.max(15, Math.ceil(Math.sqrt(40 * (M + 1))));
  const jh = new Float64Array(start + 2);
  jh[start + 1] = 0; jh[start] = 1e-30;
  for (let m = start; m >= 1; m--) jh[m - 1] = ((2 * m + 1) / x) * jh[m] - jh[m + 1];
  const scale = (Math.sin(x) / x) / jh[0];
  for (let m = 0; m <= M; m++) j[m] = jh[m] * scale;
  return { j, y };
}

// Precompute the per-frequency (per ka) data the exact series reuses across all
// angles/mics: the derivative h'_m(ka) of the spherical Hankel function.
export function spherePrecompute(ka) {
  const M = Math.max(1, Math.ceil(ka) + 12);
  const { j, y } = sphBesselJY(M + 1, ka);
  const hpRe = new Float64Array(M + 1), hpIm = new Float64Array(M + 1);
  for (let m = 0; m <= M; m++) {
    if (m === 0) { hpRe[0] = -j[1]; hpIm[0] = -y[1]; }          // h'_0 = -h_1
    else { hpRe[m] = j[m - 1] - ((m + 1) / ka) * j[m]; hpIm[m] = y[m - 1] - ((m + 1) / ka) * y[m]; }
  }
  return { M, hpRe, hpIm, ka };
}

// Exact surface pressure, relative to the free-field plane wave at the sphere centre:
//   p = (i/(ka)^2) * sum_m (-i)^m (2m+1) P_m(cos g) / h'_m(ka)
// cosG = cos(angle between mic outward normal and the source direction); 1 = facing source.
export function sphereSeriesPre(cosG, pre) {
  if (pre.ka < 1e-3) return { re: 1, im: 0 };
  const P = legendre(pre.M, cosG);
  let sumRe = 0, sumIm = 0;
  for (let m = 0; m <= pre.M; m++) {
    let cr, ci; const r = m & 3;            // (-i)^m
    if (r === 0) { cr = 1; ci = 0; } else if (r === 1) { cr = 0; ci = -1; }
    else if (r === 2) { cr = -1; ci = 0; } else { cr = 0; ci = 1; }
    const coef = (2 * m + 1) * P[m];
    const numRe = cr * coef, numIm = ci * coef;
    const hr = pre.hpRe[m], hi = pre.hpIm[m], den = hr * hr + hi * hi;
    sumRe += (numRe * hr + numIm * hi) / den; // (num)/(h') complex divide
    sumIm += (numIm * hr - numRe * hi) / den;
  }
  const f = 1 / (pre.ka * pre.ka);            // multiply by i/ka^2
  return { re: -sumIm * f, im: sumRe * f };
}

export function sphereSeries(cosG, ka) { return sphereSeriesPre(cosG, spherePrecompute(ka)); }

// Brown & Duda 1st-order shelf: DC gain 1, HF gain alpha(theta), corner at w0 = c/a
// (so w/w0 = ka). alpha: ~+6 dB facing source, down to ~-20 dB in the shadow.
export function sphereBD(cosG, ka) {
  const aMin = 0.1, thetaMin = 150; // degrees
  const thetaDeg = (Math.acos(Math.max(-1, Math.min(1, cosG))) * 180) / Math.PI;
  const alpha = (1 + aMin / 2) + (1 - aMin / 2) * Math.cos((thetaDeg * 1.2 * Math.PI) / 180);
  const nRe = 1, nIm = alpha * ka, dRe = 1, dIm = ka, den = dRe * dRe + dIm * dIm;
  return { re: (nRe * dRe + nIm * dIm) / den, im: (nIm * dRe - nRe * dIm) / den };
}

// Around-the-sphere arrival "advance" (seconds): positive = wave reaches this point
// earlier than the centre. Illuminated side = geometric; shadow side = creeping wave.
export function sphereAdvance(gamma, a, c) {
  if (gamma <= Math.PI / 2) return (a / c) * Math.cos(gamma);
  return -(a / c) * (gamma - Math.PI / 2);
}

// Unified array-manifold element a_m for a mic whose outward normal makes angle
// gamma with the source (cosG = cos gamma), at radian frequency omega (ka = omega*a/c).
// 'free'/'bd' = magnitude * exp(+j*omega*advance); 'exact' = scattering series (its
// phase already contains the propagation/diffraction delay). `pre` only for 'exact'.
export function manifoldAt(mode, cosG, ka, omega, a, c, pre) {
  if (mode === 'exact') return sphereSeriesPre(cosG, pre);
  const g = Math.acos(Math.max(-1, Math.min(1, cosG)));
  const ph = omega * sphereAdvance(g, a, c);
  const cr = Math.cos(ph), ci = Math.sin(ph);
  if (mode === 'bd') { const H = sphereBD(cosG, ka); return { re: H.re * cr - H.im * ci, im: H.re * ci + H.im * cr }; }
  return { re: cr, im: ci }; // free field
}
