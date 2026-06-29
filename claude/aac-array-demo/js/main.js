// UI wiring: builds the control panel, the pipeline-block lamp strip, and the
// meters, then runs the render loop off the engine's per-hop callback.

import { Engine, FS_SIM, N } from './engine.js';
import { Scope, Spectrogram, PolarDOA, BeamPattern } from './viz.js';

// ---- on-page diagnostics so nothing ever fails silently ----
function banner(msg, kind = 'err') {
  let b = document.getElementById('diag');
  if (!b) { b = document.createElement('div'); b.id = 'diag'; document.body.prepend(b); }
  b.textContent = msg;
  b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;padding:8px 14px;font:13px system-ui;' +
    (kind === 'err' ? 'background:#5a1d1d;color:#ffd9d9;border-bottom:1px solid #a33;'
                    : 'background:#3a2e10;color:#ffe9b0;border-bottom:1px solid #6a5;');
}
window.addEventListener('error', (e) => banner('JS error: ' + (e.message || e.error)));
window.addEventListener('unhandledrejection', (e) => banner('Promise error: ' + ((e.reason && e.reason.message) || e.reason)));
if (location.protocol === 'file:') {
  banner('You opened this file directly (file://), which blocks ES modules. Serve it: run "python3 -m http.server 8000" in the aac-array-demo folder, then open http://localhost:8000', 'warn');
}

const engine = new Engine();
const sp = engine.sim.params;
const pp = engine.pipeline.params;

// ---------- control definitions ----------
const $ = (id) => document.getElementById(id);
const controls = $('controls');

function slider(group, label, obj, key, min, max, step, fmt = (v) => v) {
  const row = document.createElement('div'); row.className = 'row';
  const val = document.createElement('span'); val.className = 'val'; val.textContent = fmt(obj[key]);
  const inp = document.createElement('input');
  inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = obj[key];
  inp.oninput = () => { obj[key] = parseFloat(inp.value); val.textContent = fmt(obj[key]); onParamChange(key); };
  const lab = document.createElement('label'); lab.textContent = label;
  row.append(lab, inp, val); group.appendChild(row);
  return inp;
}
function toggle(group, label, obj, key) {
  const wrap = document.createElement('label'); wrap.className = 'toggle';
  const inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = obj[key];
  inp.onchange = () => { obj[key] = inp.checked; onParamChange(key); };
  wrap.append(inp, document.createTextNode(label)); group.appendChild(wrap);
  return inp;
}
function select(group, label, options, initial, onChange) {
  const row = document.createElement('div'); row.className = 'row';
  const lab = document.createElement('label'); lab.textContent = label;
  const sel = document.createElement('select'); sel.className = 'sel';
  for (const o of options) {
    const opt = document.createElement('option'); opt.value = o.value; opt.textContent = o.label;
    if (o.value === initial) opt.selected = true; sel.appendChild(opt);
  }
  sel.onchange = () => onChange(sel.value);
  row.append(lab, sel); group.appendChild(row); return sel;
}
function makeGroup(title) {
  const g = document.createElement('div'); g.className = 'group';
  const h = document.createElement('h4'); h.textContent = title; g.appendChild(h);
  controls.appendChild(g); return g;
}

function onParamChange(key) {
  if (key === 'radius') engine.setRadius(sp.radius / 1000);
}

// ----- Scene group -----
const scene = makeGroup('Acoustic scene');
slider(scene, 'Target angle', sp, 'targetAngle', 0, 359, 1, (v) => v + '°');
slider(scene, 'Target level', sp, 'targetLevel', 0, 2, 0.01);
toggle(scene, 'Interferer', sp, 'interfOn');
slider(scene, 'Interferer angle', sp, 'interfAngle', 0, 359, 1, (v) => v + '°');
slider(scene, 'Interferer level', sp, 'interfLevel', 0, 2, 0.01);
slider(scene, 'Diffuse noise', sp, 'noiseLevel', 0, 0.2, 0.001);
slider(scene, 'Reverb', sp, 'reverb', 0, 1, 0.01);
toggle(scene, 'Echo (far-end)', sp, 'echoOn');
sp.radius = 50; // mm, for the geometry slider
slider(scene, 'Array radius (mm)', sp, 'radius', 15, 120, 1);

// ----- Array acoustics: mics on a rigid sphere (head) -----
const arr = makeGroup('Array model · sphere');
select(arr, 'Acoustics', [
  { value: 'free', label: 'Free field (ideal points)' },
  { value: 'bd', label: 'Sphere — Brown–Duda' },
  { value: 'exact', label: 'Sphere — exact series' },
], 'free', (v) => engine.setArrayModel(v));
const hint = document.createElement('div');
hint.style.cssText = 'font-size:11px;color:var(--dim);margin-top:4px;line-height:1.4';
hint.textContent = 'Mics sit on a rigid sphere of the chosen radius. Set radius ≈ 87 mm for a human head; shadow/bright-spot start ~620 Hz.';
arr.appendChild(hint);

// ----- Pipeline group (matches the block diagram) -----
const pipe = makeGroup('Pipeline · 3A + BF');
toggle(pipe, 'VAD', pp, 'vad');
toggle(pipe, 'AEC (needs echo on)', pp, 'aec');
toggle(pipe, 'ANR (noise reduction)', pp, 'anr');
toggle(pipe, 'Dereverberation', pp, 'dereverb');
toggle(pipe, 'AGC', pp, 'agc');
toggle(pipe, 'Beamformer (BF)', pp, 'beamform');
toggle(pipe, 'Steer from DOA (auto)', pp, 'autoDoa');
slider(pipe, 'Manual steer', pp, 'manualAngle', 0, 359, 1, (v) => v + '°');
slider(pipe, 'Output gain (dB)', pp, 'gainDb', -12, 24, 1);

// ----- Voice ID group -----
const vid = makeGroup('Voice filter · Voice ID');
toggle(vid, 'Voice Filter on', pp, 'voiceFilter');
toggle(vid, 'Target speaker present (mock Voice ID)', pp, 'targetPresent');

// ---------- pipeline lamp strip ----------
const flow = $('flow');
const blocks = [
  ['VAD', 'vad'], ['AEC', 'aec'], ['ANR', 'anr'], ['Dereverb', 'dereverb'],
  ['AGC', 'agc'], ['DOA', null], ['BF', 'beamform'], ['Voice Filter', 'voiceFilter'], ['Gain', null],
];
const blkEls = {};
for (const [name, key] of blocks) {
  const el = document.createElement('div'); el.className = 'blk';
  el.innerHTML = `<span class="dot"></span>${name}`;
  flow.appendChild(el); blkEls[name] = { el, key };
}

// ---------- meters ----------
const meters = $('meters');
function meter(lbl, kind) {
  const m = document.createElement('div'); m.className = 'meter';
  const l = document.createElement('div'); l.className = 'lbl'; l.textContent = lbl;
  m.appendChild(l);
  let node;
  if (kind === 'lamp') { node = document.createElement('span'); node.className = 'lamp'; }
  else if (kind === 'bar') { node = document.createElement('div'); node.className = 'bar'; node.innerHTML = '<div></div>'; }
  else { node = document.createElement('div'); node.className = 'num'; node.textContent = '–'; }
  m.appendChild(node); meters.appendChild(m); return node;
}
const mVad = meter('Voice (VAD)', 'lamp');
const mGate = meter('Voice ID gate', 'lamp');
const mDoa = meter('DOA', 'num');
const mErr = meter('DOA error', 'num');
const mIn = meter('Input level', 'bar');
const mOut = meter('Output level', 'bar');
const mAgc = meter('AGC gain', 'num');
const mRej = meter('Interf reject', 'num');

// ---------- visualisers ----------
const polar = new PolarDOA($('polar'));
const beam = new BeamPattern($('beam'));
const spec = new Spectrogram($('spec'), FS_SIM, N);
const outScope = new Scope($('outscope'), '#5cd6c0');
const inScope = new Scope($('inscope'), '#3a7d44');

let lastMeta = null, lastMicHop = null;
engine.onHop = (out, meta) => { outScope.push(out); spec.push(meta.ymag); lastMeta = meta; };
// peek at mic-1 for the input scope (sim only)
const origGen = engine.sim.generate.bind(engine.sim);
engine.sim.generate = (len) => { const r = origGen(len); lastMicHop = r.mics[0]; return r; };

// ---------- render loop (UI at screen rate) ----------
function render() {
  if (lastMicHop) inScope.push(lastMicHop);
  outScope.draw(); inScope.draw();
  if (lastMeta) {
    const m = lastMeta;
    polar.draw({
      est: m.estAngle, target: sp.targetAngle, interf: sp.interfOn ? sp.interfAngle : null,
      srp: m.srp, angles: m.angles, gateOpen: m.gateOpen,
    });
    mVad.classList.toggle('on', m.vadFlag);
    mGate.classList.toggle('on', m.gateOpen);
    mDoa.textContent = m.estAngle.toFixed(0) + '°';
    let err = Math.abs(((m.estAngle - sp.targetAngle + 540) % 360) - 180);
    mErr.textContent = err.toFixed(0) + '°';
    mAgc.textContent = (20 * Math.log10(m.agcGain + 1e-6)).toFixed(1) + ' dB';
    mIn.firstChild.style.width = Math.min(100, m.inRms * 400) + '%';
    mOut.firstChild.style.width = Math.min(100, m.outRms * 200) + '%';

    // ---- beam pattern for the current steer direction ----
    const steer = pp.beamform ? (pp.autoDoa ? m.estAngle : pp.manualAngle) : null;
    if (steer != null) {
      const bp = engine.pipeline.beamPattern(steer);
      let rej = null;
      if (sp.interfOn) {
        const g = engine.pipeline.beamGainAt(sp.interfAngle, steer);
        rej = -20 * Math.log10(g + 1e-6); // attenuation relative to the on-axis (0 dB) look direction
      }
      beam.draw({ angles: bp.angles, mag: bp.mag, steer, target: sp.targetAngle,
        interf: sp.interfOn ? sp.interfAngle : null, interfRejDb: rej });
      mRej.textContent = rej == null ? '–' : rej.toFixed(1) + ' dB';
    } else {
      mRej.textContent = 'BF off';
    }
  }
  // block lamps: on = enabled, active flash = currently passing voice
  for (const [name, { el, key }] of Object.entries(blkEls)) {
    const enabled = key ? pp[key] : true;
    el.classList.toggle('on', !!enabled);
    el.classList.toggle('active', !!enabled && lastMeta && lastMeta.vadFlag);
  }
  requestAnimationFrame(render);
}
render();

// ---------- transport ----------
let started = false;
$('startBtn').onclick = async () => {
  started = !started;
  if (started) {
    if ($('playChk').checked) { await engine.enableAudio(); engine.playing = true; }
    engine.start(); $('startBtn').textContent = '⏸ Pause';
  } else { engine.stop(); $('startBtn').textContent = '▶ Start'; }
};
$('playChk').onchange = async (e) => {
  engine.playing = e.target.checked;
  if (engine.playing) await engine.enableAudio();
};
$('vol').oninput = (e) => engine.setVolume(parseFloat(e.target.value));
$('liveBtn').onclick = async () => {
  try {
    $('status').textContent = 'connecting…';
    const info = await engine.startLive();
    if (!engine.running) engine.start();
    $('status').textContent = `live · ${info.channels}ch @ ${(info.sampleRate / 1000).toFixed(1)}kHz`;
    $('liveBtn').disabled = true;
  } catch (err) {
    $('status').textContent = 'mic error';
    alert('Could not open the array: ' + err.message +
      '\n\nTips: serve over http://localhost or https, allow mic access, and select the ReSpeaker as input.');
  }
};
