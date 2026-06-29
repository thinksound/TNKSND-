// Microphone-array geometry and the steering math used by the beamformer (BF) and
// direction-of-arrival (DOA / SRP-PHAT) blocks.
//
// Conventions (kept consistent everywhere):
//   - Azimuth angle is measured CCW from +x. 0deg = right, 90deg = "front" (+y).
//   - Source direction unit vector  s = (cos a, sin a).
//   - arrivalTau_i = (p_i . s) / c   [seconds].
//     A mic on the source side (p.s > 0) hears the wave earlier, so in the sim its
//     spectrum carries a +j*w*tau phase; the beamformer aligns by multiplying by
//     exp(-j*w*tau). The same tau drives SRP-PHAT scanning. See dsp.js.

export const SPEED_OF_SOUND = 343; // m/s

// 4-mic circular array by default. radius in metres. The ReSpeaker XVF3800 is a
// circular array; set the real radius here (or in the UI) to match the kit for live.
export function circularArray(numMics = 4, radius = 0.05) {
  const mics = [];
  for (let i = 0; i < numMics; i++) {
    // offset by 45deg so 4 mics form an axis-aligned square
    const a = (2 * Math.PI * i) / numMics + Math.PI / 4;
    mics.push({ x: radius * Math.cos(a), y: radius * Math.sin(a) });
  }
  return mics;
}

// tau_i = (p_i . s)/c for each mic, given a look direction (radians).
export function arrivalTau(mics, angleRad, c = SPEED_OF_SOUND) {
  const sx = Math.cos(angleRad), sy = Math.sin(angleRad);
  return mics.map((m) => (m.x * sx + m.y * sy) / c);
}
