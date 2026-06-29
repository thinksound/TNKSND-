# AAC 4-Mic Array — Signal-Flow Demo

A browser-based simulator + real-time demo of the AAC Technologies voice-processing
signal flow (`aac_blockdiagram.jpg`), adapted to a **4-microphone** array. Build a
virtual acoustic scene, watch the DSP pipeline work on it, then connect the real
**Seeed ReSpeaker XVF3800** USB array and run the exact same pipeline on live audio.

> The diagram shows a 6-channel chain. This app targets the 4-mic hardware, so the
> pipeline runs on 4 channels; the geometry and channel count are configurable.

## Run it

No build step. Serve the folder over HTTP (mic access and ES modules need a real origin):

```bash
cd aac-array-demo
python3 -m http.server 8000
# open http://localhost:8000 in Chrome
```

Click **▶ Start**. Tick **🔊 Play output** to hear the processed mono result.

## The pipeline (matches the block diagram)

```
4ch in → VAD → AEC & ANR → Dereverb → AGC → [DOA] → BF → Voice Filter → Gain → out
                                              └─angle─┘            ↑ Voice ID
```

| Block | What it actually does here |
|-------|----------------------------|
| **VAD** | Band-SNR vs a tracked noise floor, with hangover |
| **AEC** | Per-channel frequency-domain NLMS using the far-end reference (enable *Echo* in the scene) |
| **ANR** | Wiener gain from a decision-directed a-priori SNR estimate |
| **Dereverb** | Crude late-reverb spectral suppression |
| **AGC** | Broadband gain toward a target level, frozen during silence |
| **DOA** | **SRP-PHAT** scan over 0–360° (real estimation; polar plot shows the response curve) |
| **BF** | Delay-and-sum beamformer steered to the DOA (or a manual angle) |
| **Voice Filter / Voice ID** | **Mock** — gated by VAD + a "target speaker present" toggle. Real speaker-ID needs an enrolled model. |
| **Gain** | Final output gain |

ANR and Dereverb apply a **single shared gain mask to all channels**, so inter-channel
phase is preserved and DOA/beamforming still work downstream.

## Architecture

```
sim.js  ─┐
         ├─►  dsp.js  (Pipeline.processHop)  ─►  viz.js + audio out
live    ─┘
```

- `dsp.js` — the whole STFT overlap-add pipeline. Source-agnostic.
- `sim.js` — virtual scene: speech-like talker(s), diffuse noise, reverb, echo, with
  real per-mic propagation delays from `geometry.js`.
- `engine.js` — real-time clock; feeds hops from **either** the simulator **or** the
  live capture worklet into the same `processHop()`. Swapping the source is the only
  difference between Sim and Live.
- `viz.js` — scope, spectrogram, polar DOA. `main.js` — UI.

## Going live with the ReSpeaker XVF3800

1. Plug the board in over USB. macOS sees it as a multichannel **USB Audio Class 2.0**
   input — no driver needed.
2. Set **Array radius (mm)** to match the real board so DOA/BF geometry is correct.
3. Click **🎤 Go Live**, grant mic permission, and pick the ReSpeaker as the input.

The app requests `channelCount: 4` with `echoCancellation/noiseSuppression/autoGainControl: false`
so the OS doesn't pre-process the raw mics, and adopts the device's native sample rate
for the DOA/BF math.

**Caveats / next steps for the hardware demo**
- The XVF3800 already does on-chip beamforming/AEC and may, depending on firmware
  config, expose *processed* output rather than the 4 raw mics. To exercise *this*
  app's DSP you want the raw/multichannel mic stream; otherwise treat the on-chip
  output as the source and use this app for DOA visualisation + Voice Filter.
- Confirm the real mic coordinates from Seeed's docs and put them in
  `geometry.js` (replace `circularArray` with explicit positions) for best DOA accuracy.
- Browser multichannel (>2ch) input capture is best in Chrome; if the OS collapses it
  to stereo, capture per-channel via the device's ASIO/CoreAudio path in a small
  native helper and feed it to the page over WebSocket.
```
