// Canvas visualisations: scrolling waveform, scrolling spectrogram, DOA polar plot.

export class Scope {
  constructor(canvas, color = '#5cd6c0') {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.color = color;
    this.buf = new Float32Array(canvas.width); this.w = 0;
  }
  push(samples) {
    // store one peak value per pixel column as samples stream in
    const step = Math.max(1, Math.floor(samples.length / 4));
    for (let i = 0; i < samples.length; i += step) {
      let peak = 0;
      for (let j = i; j < Math.min(i + step, samples.length); j++) peak = Math.max(peak, Math.abs(samples[j]));
      this.buf[this.w] = peak * Math.sign(samples[i]);
      this.w = (this.w + 1) % this.buf.length;
    }
  }
  draw() {
    const { ctx, cv } = this, W = cv.width, Hh = cv.height, mid = Hh / 2;
    ctx.fillStyle = '#0d1117'; ctx.fillRect(0, 0, W, Hh);
    ctx.strokeStyle = '#222b36'; ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke();
    ctx.strokeStyle = this.color; ctx.beginPath();
    for (let x = 0; x < W; x++) {
      const v = this.buf[(this.w + x) % this.buf.length];
      const y = mid - v * mid * 0.95;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

export class Spectrogram {
  constructor(canvas, Fs, N) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.Fs = Fs; this.N = N; this.K = (N >> 1) + 1;
  }
  push(ymag) {
    const { ctx, cv } = this, W = cv.width, H = cv.height;
    const img = ctx.getImageData(1, 0, W - 1, H);
    ctx.putImageData(img, 0, 0); // scroll left by 1px
    for (let y = 0; y < H; y++) {
      const k = Math.floor((1 - y / H) * (this.K - 1));
      const db = 20 * Math.log10(ymag[k] + 1e-6);
      const t = Math.max(0, Math.min(1, (db + 70) / 70)); // -70..0 dB
      const [r, g, b] = magma(t);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(W - 1, y, 1, 1);
    }
  }
}

// quick magma-ish colormap
function magma(t) {
  const r = Math.min(255, 255 * Math.pow(t, 0.7));
  const g = Math.min(255, 255 * Math.pow(Math.max(0, t - 0.25) / 0.75, 1.4));
  const b = Math.min(255, 255 * (0.3 + 0.7 * Math.sin(Math.PI * t)));
  return [r | 0, g | 0, b | 0];
}

export class PolarDOA {
  constructor(canvas) { this.cv = canvas; this.ctx = canvas.getContext('2d'); }
  // est, target, interf in degrees (interf may be null); srp/angles arrays
  draw({ est, target, interf, srp, angles, gateOpen }) {
    const { ctx, cv } = this, W = cv.width, H = cv.height;
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 16;
    ctx.fillStyle = '#0d1117'; ctx.fillRect(0, 0, W, H);

    // rings + cardinal labels (0deg = right, 90deg = front/up)
    ctx.strokeStyle = '#1d2530'; ctx.fillStyle = '#5b6b7d'; ctx.font = '11px system-ui';
    for (const rr of [0.33, 0.66, 1]) { ctx.beginPath(); ctx.arc(cx, cy, R * rr, 0, 2 * Math.PI); ctx.stroke(); }
    ctx.fillText('90° front', cx - 24, cy - R - 2);
    ctx.fillText('270°', cx - 12, cy + R + 12);
    ctx.fillText('0°', cx + R + 2, cy + 4);
    ctx.fillText('180°', cx - R - 26, cy + 4);

    // SRP-PHAT response curve
    if (srp && angles) {
      let mx = 1e-9; for (const v of srp) mx = Math.max(mx, v);
      ctx.beginPath(); ctx.strokeStyle = '#2e4a6b';
      for (let i = 0; i <= angles.length; i++) {
        const idx = i % angles.length;
        const a = (angles[idx] * Math.PI) / 180;
        const rad = R * (0.15 + 0.85 * (srp[idx] / mx));
        const x = cx + rad * Math.cos(a), y = cy - rad * Math.sin(a);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    const ray = (deg, color, label, len = 1) => {
      const a = (deg * Math.PI) / 180;
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(cx, cy); ctx.lineTo(cx + R * len * Math.cos(a), cy - R * len * Math.sin(a)); ctx.stroke();
      ctx.lineWidth = 1; ctx.fillStyle = color;
      ctx.fillText(label, cx + (R * len + 6) * Math.cos(a) - 6, cy - (R * len + 6) * Math.sin(a));
    };
    if (target != null) ray(target, '#3a7d44', 'target', 0.9);
    if (interf != null) ray(interf, '#8a5a2b', 'interf', 0.7);
    ray(est, gateOpen ? '#5cd6c0' : '#54606e', 'DOA', 1);

    ctx.fillStyle = '#c9d4e0'; ctx.font = '13px system-ui';
    ctx.fillText(`estimated: ${est.toFixed(0)}°`, 10, 18);
  }
}

// Polar beam-pattern: filled main lobe (dB), steer/target/interferer rays, and the
// instantaneous interferer rejection. floorDb sets the radial dynamic range.
export class BeamPattern {
  constructor(canvas, floorDb = -30) { this.cv = canvas; this.ctx = canvas.getContext('2d'); this.floor = floorDb; }
  draw({ angles, mag, steer, target, interf, interfRejDb }) {
    const { ctx, cv } = this, W = cv.width, H = cv.height;
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 16, floor = this.floor;
    ctx.fillStyle = '#0d1117'; ctx.fillRect(0, 0, W, H);
    const radOf = (db) => R * Math.max(0, Math.min(1, (db - floor) / -floor));

    // dB rings
    ctx.strokeStyle = '#1d2530'; ctx.fillStyle = '#3d4a5a'; ctx.font = '10px system-ui';
    for (let db = 0; db >= floor; db -= 10) {
      const rr = radOf(db);
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 2 * Math.PI); ctx.stroke();
      ctx.fillText(`${db}`, cx + 2, cy - rr + 10);
    }

    // filled beam lobe
    if (angles && mag) {
      ctx.beginPath();
      for (let i = 0; i <= angles.length; i++) {
        const idx = i % angles.length;
        const a = (angles[idx] * Math.PI) / 180;
        const db = 20 * Math.log10(mag[idx] + 1e-6);
        const rr = radOf(db);
        const x = cx + rr * Math.cos(a), y = cy - rr * Math.sin(a);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(92,214,192,0.18)'; ctx.fill();
      ctx.strokeStyle = '#5cd6c0'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.lineWidth = 1;
    }

    const ray = (deg, color, label) => {
      const a = (deg * Math.PI) / 180;
      ctx.strokeStyle = color; ctx.beginPath();
      ctx.moveTo(cx, cy); ctx.lineTo(cx + R * Math.cos(a), cy - R * Math.sin(a)); ctx.stroke();
      ctx.fillStyle = color; ctx.fillText(label, cx + (R + 6) * Math.cos(a) - 6, cy - (R + 6) * Math.sin(a));
    };
    if (target != null) ray(target, '#3a7d44', 'target');
    if (interf != null) ray(interf, '#c97b4a', 'interf');
    ray(steer, '#5cd6c0', 'steer');

    ctx.fillStyle = '#c9d4e0'; ctx.font = '13px system-ui';
    ctx.fillText('steer: ' + steer.toFixed(0) + '°', 10, 18);
    if (interfRejDb != null) {
      ctx.fillStyle = interfRejDb > 6 ? '#5cd6c0' : '#c97b4a';
      ctx.fillText('interf reject: ' + interfRejDb.toFixed(1) + ' dB', 10, H - 10);
    }
  }
}
