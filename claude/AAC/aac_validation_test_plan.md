# AAC Audio Front-End — Block-by-Block Validation Test Plan ‖ AAC オーディオ・フロントエンド — ブロック別 検証テスト計画書

**Reference:** `aac_blockdiagram.jpg` (Signal Flow) ‖ **参照:** `aac_blockdiagram.jpg`（シグナルフロー）

**Document status:** Vendor validation release ‖ **文書ステータス:** ベンダー検証用リリース

**Confidential** — © 2024 AAC Technologies. All Rights Reserved. ‖ **機密** — © 2024 AAC Technologies. All Rights Reserved.

---

## 0. Purpose & Scope ‖ 目的と範囲

This document defines a thorough, per-block validation procedure for the AAC 6-channel audio front-end. The vendor shall execute every test, record measured values against the pass/fail criteria, and deliver a completed results matrix (§13) plus raw recordings/logs. Each processing block is validated **in isolation** (where a bypass/tap is available) and **in-chain** (end-to-end), so that a regression in any single block can be localized. ‖ 本書は、AAC 6チャンネル・オーディオ・フロントエンドのブロック単位での網羅的な検証手順を定義する。ベンダーは全テストを実施し、合否基準に対する測定値を記録し、完成した結果マトリクス（§13）と生録音・ログを納品すること。各処理ブロックは、**単体**（バイパス／タップが利用可能な場合）および**チェーン全体**（エンドツーエンド）の両方で検証し、いずれかのブロックの劣化を切り分けられるようにする。

### Signal flow under test ‖ 検証対象シグナルフロー

```
6CH Input → VAD → NN-based AEC & ANR → Dereverberation → AGC → BF → Voice Filter(on/off) → Gain → Output
                                                            │                   ▲
                                                            ▼ (tap)             │ Voice ID
                                                           DOA ──Angle──▶ BF    │
                                                                       BF ─(tap)─▶ Voice Recognition(on/off)
3A = AEC (Active Echo Cancellation) + ANR (Active Noise Reduction) + AGC (Automatic Gain Control)
```

---

## 1. Test Environment & Equipment ‖ テスト環境と機材

| Item ‖ 項目 | Requirement ‖ 要件 |
|---|---|
| Room ‖ 試験室 | Acoustically treated / semi-anechoic, background noise ≤ 30 dBA, RT60 ≤ 0.3 s (unless test specifies otherwise) ‖ 音響処理済み・半無響、暗騒音 ≤ 30 dBA、RT60 ≤ 0.3秒（別途指定を除く） |
| Reverberant room ‖ 残響室 | Adjustable RT60 0.3–0.9 s for dereverberation tests ‖ 残響除去テスト用に RT60 0.3〜0.9秒で可変 |
| Reference loudspeaker(s) ‖ 基準スピーカ | Calibrated, flat ±2 dB 100 Hz–8 kHz; ≥1 for talker, ≥1 for echo/interferer ‖ 校正済み、平坦 ±2 dB 100 Hz–8 kHz；話者用 ≥1台、エコー／妨害音用 ≥1台 |
| Reference microphone ‖ 基準マイク | Class 1, calibrated (e.g., B&K / GRAS) ‖ クラス1校正済み（例 B&K／GRAS） |
| Rotary positioner ‖ 回転ステージ | ≤1° resolution for DOA/BF angular sweeps ‖ DOA・BF角度掃引用、分解能 ≤1° |
| Mouth simulator ‖ 模擬口 | ITU-T P.51 / IEC 60318-7 for speech tests ‖ 音声テスト用（ITU-T P.51／IEC 60318-7） |
| Sound level meter ‖ 騒音計 | Class 1, calibrated ‖ クラス1校正済み |
| Analysis tools ‖ 解析ツール | POLQA (ITU-T P.863) or PESQ (P.862), STOI/ESTOI, ERLE meter, spectrogram, ASR engine for WER ‖ POLQA（P.863）または PESQ（P.862）、STOI／ESTOI、ERLEメータ、スペクトログラム、WER用ASRエンジン |
| Calibration ‖ 校正 | All acoustic equipment calibrated ≤12 months; record cal certs ‖ 全音響機材は12ヶ月以内に校正、証明書を記録 |

**Test signals:** swept sine, MLS/log-sweep, pink/white noise, ITU-T P.50 / P.501 speech (EN + JA talkers, ≥4 male + ≥4 female), babble noise, car/office/cafe noise, single-tone interferers. ‖ **テスト信号:** 掃引正弦波、MLS／対数スイープ、ピンク／白色雑音、ITU-T P.50／P.501 音声（英語＋日本語話者、男性 ≥4・女性 ≥4）、バブル雑音、車内／オフィス／カフェ雑音、単一トーン妨害音。

**Vendor hooks required:** per-block bypass switches, internal tap points (post-AGC, post-BF), DOA angle readout, Voice ID / Voice Recognition state readout, sample-accurate timestamps/logging. If a hook is unavailable, note it and validate the block in-chain only. ‖ **ベンダーが用意すべきフック:** ブロック単位のバイパススイッチ、内部タップ点（AGC後、BF後）、DOA角度の読み出し、Voice ID／音声認識状態の読み出し、サンプル精度のタイムスタンプ／ロギング。フックが無い場合はその旨を記し、チェーン内検証のみ実施する。

---

## 2. Block: 6CH Input ‖ ブロック：6チャンネル入力

**Function:** Capture from the 6-element microphone array — the raw input to the entire chain. ‖ **機能:** 6素子マイクアレイからの収録 — チェーン全体への生入力。

**Why it matters:** Channel-mapping errors, dead mics, gain/phase mismatch, or DC offset corrupt every downstream block (especially DOA/BF). ‖ **重要性:** チャンネルマッピング誤り、不動マイク、ゲイン／位相不整合、DCオフセットは下流の全ブロック（特にDOA／BF）を破壊する。

| # | Test ‖ テスト | Procedure ‖ 手順 | Pass criteria ‖ 合格基準 |
|---|---|---|---|
| 1.1 | Channel mapping ‖ チャンネル割当 | Excite each mic individually (near-field source over each port). ‖ 各マイクを個別に励起（各ポート至近に音源）。 | Logical channel index matches physical mic position; no swaps. ‖ 論理ch番号が物理マイク位置と一致、入れ替わり無し。 |
| 1.2 | Dead/stuck channel ‖ 不動・固着ch | Play pink noise to whole array. ‖ アレイ全体にピンク雑音。 | All 6 channels show signal; per-ch RMS within ±3 dB of mean. ‖ 全6chに信号、ch毎RMSが平均±3 dB以内。 |
| 1.3 | Inter-channel gain match ‖ ch間ゲイン整合 | Diffuse/equidistant pink noise. ‖ 拡散・等距離ピンク雑音。 | Channel-to-channel level spread ≤ 1.5 dB. ‖ ch間レベル差 ≤ 1.5 dB。 |
| 1.4 | Inter-channel phase match ‖ ch間位相整合 | Broadside reference tone sweep. ‖ 正面基準トーン掃引。 | Phase deviation ≤ 5° across 200 Hz–4 kHz. ‖ 位相偏差 ≤ 5°（200 Hz〜4 kHz）。 |
| 1.5 | Frequency response ‖ 周波数応答 | Log-sweep, per channel. ‖ 対数スイープ、ch毎。 | Within vendor mask (e.g., ±3 dB 100 Hz–8 kHz). ‖ ベンダー規定マスク内（例 ±3 dB 100 Hz〜8 kHz）。 |
| 1.6 | Per-channel SNR ‖ ch毎SNR | 94 dB SPL @1 kHz vs silence. ‖ 94 dB SPL @1 kHz と無音比較。 | ≥ vendor spec (e.g., ≥ 60 dB(A)). ‖ ベンダー仕様以上（例 ≥ 60 dB(A)）。 |
| 1.7 | THD & clipping ‖ 歪・クリップ | 1 kHz sweep up to max SPL. ‖ 1 kHz を最大SPLまで掃引。 | THD ≤ 1% below clip point; clip point ≥ spec SPL. ‖ クリップ点以下でTHD ≤ 1%、クリップ点 ≥ 規定SPL。 |
| 1.8 | Sample-rate accuracy ‖ サンプルレート精度 | Long capture vs reference clock. ‖ 基準クロックと長時間収録比較。 | Drift ≤ ±100 ppm; no dropped samples over 1 h. ‖ ドリフト ≤ ±100 ppm、1時間でサンプル欠落無し。 |
| 1.9 | DC offset ‖ DCオフセット | Silent capture. ‖ 無音収録。 | \|DC\| ≤ vendor limit (e.g., −60 dBFS). ‖ \|DC\| ≤ ベンダー上限（例 −60 dBFS）。 |

---

## 3. Block: VAD (Voice Activity Detection) ‖ ブロック：音声区間検出（VAD）

**Function:** Flags speech-present vs speech-absent frames; gates/controls downstream behavior. ‖ **機能:** 音声有無のフレーム判定。下流動作のゲート／制御。

| # | Test ‖ テスト | Procedure ‖ 手順 | Pass criteria ‖ 合格基準 |
|---|---|---|---|
| 3.1 | Detection accuracy (clean) ‖ 検出精度（クリーン） | Labeled speech+silence corpus, quiet room. ‖ ラベル付き音声＋無音コーパス、静室。 | TPR ≥ 98%, FPR ≤ 2%. ‖ 検出率 ≥ 98%、誤検出率 ≤ 2%。 |
| 3.2 | Accuracy vs SNR ‖ SNR依存精度 | Add babble/car noise at +20, +10, +5, 0 dB SNR. ‖ バブル・車内雑音を +20/+10/+5/0 dB SNR で付加。 | TPR ≥ 90% @ 5 dB SNR; report ROC/AUC per condition. ‖ 5 dB SNRで検出率 ≥ 90%、条件毎にROC／AUC報告。 |
| 3.3 | Onset/offset latency ‖ 立上り・立下り遅延 | Compare flag edges to ground-truth boundaries. ‖ フラグ端を正解境界と比較。 | Onset ≤ 30 ms; offset hangover within spec. ‖ 立上り ≤ 30 ms、立下りハングオーバは仕様内。 |
| 3.4 | Non-speech rejection ‖ 非音声棄却 | Music, keyboard, door slam, HVAC. ‖ 音楽・キーボード・ドア音・空調。 | FPR ≤ 5% on transient non-speech. ‖ 過渡非音声で誤検出率 ≤ 5%。 |
| 3.5 | EN/JA robustness ‖ 日英頑健性 | Equal split EN & JA talkers. ‖ 英語・日本語話者を均等。 | No language-dependent accuracy gap > 3%. ‖ 言語依存の精度差 > 3% 無し。 |

---

## 4. Block: NN-based AEC & ANR (part of 3A) ‖ ブロック：NN型エコー消去＆雑音抑制（3Aの一部）

### 4A. AEC — Active Echo Cancellation ‖ 4A. エコー消去（AEC）

**Function:** Remove loudspeaker echo (device playback / far-end) from the mic signal. ‖ **機能:** マイク信号からスピーカ由来エコー（自己再生／遠端）を除去。

| # | Test ‖ テスト | Procedure ‖ 手順 | Pass criteria ‖ 合格基準 |
|---|---|---|---|
| 4.1 | ERLE (single-talk) ‖ ERLE（単独通話） | Play far-end speech, no near-end; measure echo attenuation. ‖ 遠端音声のみ再生、近端無し、エコー減衰測定。 | ERLE ≥ 35 dB steady-state. ‖ 定常 ERLE ≥ 35 dB。 |
| 4.2 | Convergence time ‖ 収束時間 | Cold start, measure time to 90% of final ERLE. ‖ コールドスタート、最終ERLEの90%到達時間。 | ≤ 1 s. ‖ ≤ 1秒。 |
| 4.3 | Double-talk ‖ ダブルトーク | Simultaneous near+far speech. ‖ 近端・遠端同時。 | Near-end PESQ/POLQA degradation ≤ 0.3 MOS; no divergence. ‖ 近端 PESQ／POLQA 劣化 ≤ 0.3 MOS、発散無し。 |
| 4.4 | Echo-path change ‖ エコー経路変化 | Move device/reflector mid-call. ‖ 通話中に機器・反射物を移動。 | Re-converge ≤ 1 s, no audible echo burst > 300 ms. ‖ 再収束 ≤ 1秒、可聴エコーバースト > 300 ms 無し。 |
| 4.5 | Residual echo audibility ‖ 残留エコー可聴性 | Listening panel + spectrogram. ‖ 試聴パネル＋スペクトログラム。 | No audible residual; no nonlinear echo leakage. ‖ 可聴残留・非線形漏れ無し。 |
| 4.6 | Nonlinear echo (loud playback) ‖ 非線形エコー（大音量再生） | Drive speaker near clipping. ‖ スピーカをクリップ近傍駆動。 | ERLE ≥ 25 dB; NN handles distortion. ‖ ERLE ≥ 25 dB、NNが歪に対応。 |

### 4B. ANR — Active Noise Reduction ‖ 4B. 雑音抑制（ANR）

**Function:** Suppress stationary & non-stationary background noise while preserving speech. ‖ **機能:** 定常・非定常雑音を抑圧し音声を保持。

| # | Test ‖ テスト | Procedure ‖ 手順 | Pass criteria ‖ 合格基準 |
|---|---|---|---|
| 4.7 | Noise reduction (stationary) ‖ 雑音抑圧（定常） | Pink/HVAC noise, measure NR. ‖ ピンク・空調雑音でNR測定。 | NR ≥ 15 dB. ‖ NR ≥ 15 dB。 |
| 4.8 | Noise reduction (non-stationary) ‖ 雑音抑圧（非定常） | Babble, traffic, cafe. ‖ バブル・交通・カフェ。 | NR ≥ 10 dB. ‖ NR ≥ 10 dB。 |
| 4.9 | Speech quality preservation ‖ 音声品質保持 | POLQA/PESQ noisy-in vs processed-out. ‖ 雑音入力 vs 処理出力で POLQA／PESQ。 | ΔMOS improvement ≥ +0.4; processed ≥ 3.0 MOS @10 dB SNR. ‖ ΔMOS ≥ +0.4、10 dB SNRで処理後 ≥ 3.0 MOS。 |
| 4.10 | Intelligibility ‖ 明瞭度 | STOI/ESTOI noisy vs processed. ‖ STOI／ESTOI 雑音 vs 処理。 | STOI not reduced; ASR WER improved vs unprocessed. ‖ STOI低下無し、ASR WER改善。 |
| 4.11 | Musical noise ‖ ミュージカルノイズ | Spectrogram + listening. ‖ スペクトログラム＋試聴。 | No audible musical/tonal artifacts. ‖ 可聴なミュージカル／トーン性アーチファクト無し。 |
| 4.12 | Speech distortion ‖ 音声歪 | Clean speech in, measure self-distortion. ‖ クリーン音声入力で自己歪測定。 | Log-spectral distortion ≤ vendor limit; no clipped onsets. ‖ 対数スペクトル歪 ≤ 上限、語頭欠落無し。 |

---

## 5. Block: Dereverberation ‖ ブロック：残響除去

**Function:** Reduce late reverberation, raise direct-to-reverberant ratio. ‖ **機能:** 後部残響を低減、直接音／残響音比を改善。

| # | Test ‖ テスト | Procedure ‖ 手順 | Pass criteria ‖ 合格基準 |
|---|---|---|---|
| 5.1 | DRR / C50 improvement ‖ DRR・C50改善 | Reverberant room RT60 = 0.6 s; measure in vs out. ‖ 残響室 RT60=0.6秒、入出力比較。 | DRR ↑ ≥ 6 dB or C50 ↑ ≥ 4 dB. ‖ DRR ↑ ≥ 6 dB または C50 ↑ ≥ 4 dB。 |
| 5.2 | Performance vs RT60 ‖ RT60依存性 | Sweep RT60 0.3 / 0.6 / 0.9 s. ‖ RT60 を 0.3／0.6／0.9秒で掃引。 | Monotonic improvement; no failure at high RT60. ‖ 単調改善、高RT60で破綻無し。 |
| 5.3 | Speech quality ‖ 音声品質 | POLQA/PESQ reverberant vs processed. ‖ 残響 vs 処理で POLQA／PESQ。 | ΔMOS ≥ +0.3; no over-suppression of direct path. ‖ ΔMOS ≥ +0.3、直接音の過剰抑圧無し。 |
| 5.4 | Low-reverb safety ‖ 低残響安全性 | Dry room (RT60 ≤ 0.2 s). ‖ 乾いた室（RT60 ≤ 0.2秒）。 | No artifacts/degradation when little reverb present. ‖ 残響が少ない時にアーチファクト・劣化無し。 |
| 5.5 | Transient/onset preservation ‖ 過渡・語頭保持 | Plosives, percussive speech. ‖ 破裂音・打撃的音声。 | Onsets preserved; no smearing/pre-echo. ‖ 語頭保持、滲み・プリエコー無し。 |

---

## 6. Block: AGC (Automatic Gain Control, part of 3A) ‖ ブロック：自動利得制御（AGC、3Aの一部）

**Function:** Normalize level toward a target regardless of talker distance/loudness. ‖ **機能:** 話者距離・声量に依らず目標レベルへ正規化。

| # | Test ‖ テスト | Procedure ‖ 手順 | Pass criteria ‖ 合格基準 |
|---|---|---|---|
| 6.1 | Target level convergence ‖ 目標レベル収束 | Inputs at −40 to −10 dBFS. ‖ 入力 −40〜−10 dBFS。 | Output within ±2 dB of target across range. ‖ 全域で出力が目標±2 dB以内。 |
| 6.2 | Attack time ‖ アタック時間 | Step level +20 dB. ‖ +20 dBステップ。 | Settles within spec (e.g., ≤ 50 ms) without overshoot clip. ‖ 仕様内に整定（例 ≤ 50 ms）、オーバーシュートでクリップ無し。 |
| 6.3 | Release time ‖ リリース時間 | Step level −20 dB. ‖ −20 dBステップ。 | Smooth recovery per spec; no pumping. ‖ 仕様通り平滑回復、ポンピング無し。 |
| 6.4 | Quiet-input behavior ‖ 小信号動作 | Speech at −45 dBFS in noise. ‖ 雑音中の −45 dBFS音声。 | No excessive noise gain-up during pauses. ‖ 無音区間で雑音の過剰増幅無し。 |
| 6.5 | Distortion ‖ 歪 | Loud transient input. ‖ 大音量過渡入力。 | No clipping; THD within spec. ‖ クリップ無し、THD仕様内。 |
| 6.6 | Gain stability ‖ ゲイン安定性 | Steady talker 2 min. ‖ 一定話者2分。 | Gain ripple ≤ 2 dB; no audible breathing. ‖ ゲインリップル ≤ 2 dB、可聴ブリージング無し。 |

---

## 7. Block: DOA (Direction of Arrival) — message: Angle → BF ‖ ブロック：到来方向推定（DOA）— メッセージ：角度→BF

**Function:** Estimate dominant source angle from post-AGC multichannel signal; sends **Angle** to BF. ‖ **機能:** AGC後の多chから主音源角度を推定し **角度** を BF へ送信。

| # | Test ‖ テスト | Procedure ‖ 手順 | Pass criteria ‖ 合格基準 |
|---|---|---|---|
| 7.1 | Angular accuracy ‖ 角度精度 | Source on turntable, 0°–360° in 30° steps, 1 m. ‖ 回転ステージ上音源、0〜360°を30°刻み、1 m。 | Mean abs error ≤ 5° (quiet). ‖ 平均絶対誤差 ≤ 5°（静室）。 |
| 7.2 | Resolution ‖ 分解能 | Two sources 30° / 15° apart. ‖ 2音源を30°／15°離隔。 | Resolve correct dominant angle. ‖ 正しい主角度を分離。 |
| 7.3 | Accuracy vs SNR ‖ SNR依存精度 | +20 / +10 / 0 dB SNR. ‖ +20／+10／0 dB SNR。 | Error ≤ 10° @ 10 dB SNR. ‖ 10 dB SNRで誤差 ≤ 10°。 |
| 7.4 | Accuracy vs distance ‖ 距離依存性 | 0.5 / 1 / 3 m. ‖ 0.5／1／3 m。 | Error ≤ 8° at 3 m. ‖ 3 mで誤差 ≤ 8°。 |
| 7.5 | Tracking moving source ‖ 移動音源追従 | Source rotating ~30°/s. ‖ 約30°/秒で回転。 | Lag ≤ 200 ms; continuous track. ‖ 遅延 ≤ 200 ms、連続追従。 |
| 7.6 | Front-back / mirror ambiguity ‖ 前後・鏡像曖昧性 | Sources at θ vs 180°−θ. ‖ θ と 180°−θ。 | No systematic mirror errors (array-geometry dependent — report). ‖ 系統的鏡像誤り無し（アレイ形状依存、要報告）。 |
| 7.7 | Message integrity ‖ メッセージ整合 | Log Angle vs BF steering. ‖ 角度ログと BF 操舵を照合。 | Angle delivered to BF within latency budget; values consistent. ‖ 角度が遅延予算内でBFへ到達、値が一致。 |

---

## 8. Block: BF (Beamforming) ‖ ブロック：ビームフォーミング（BF）

**Function:** Spatially filter toward the DOA angle; suppress off-axis noise/interferers. ‖ **機能:** DOA角度方向へ空間フィルタ、軸外雑音・妨害を抑圧。

| # | Test ‖ テスト | Procedure ‖ 手順 | Pass criteria ‖ 合格基準 |
|---|---|---|---|
| 8.1 | On-axis gain ‖ 軸上利得 | Target at steered angle. ‖ 操舵角に目標。 | Target passed with ≤ 1 dB loss & flat response. ‖ 目標を ≤ 1 dB損失・平坦で通過。 |
| 8.2 | Off-axis suppression ‖ 軸外抑圧 | Interferer 60°/90° off target. ‖ 妨害を目標から60°／90°。 | Suppression ≥ 10 dB @60°, ≥ 12 dB @90°. ‖ 抑圧 ≥ 10 dB（60°）、≥ 12 dB（90°）。 |
| 8.3 | Directivity / beam pattern ‖ 指向性・ビームパターン | Measure polar pattern per band. ‖ 帯域毎にポーラパターン測定。 | Directivity index ≥ vendor spec; main-lobe toward target. ‖ 指向性指数 ≥ 仕様、主ローブが目標方向。 |
| 8.4 | Array gain (SNR improvement) ‖ アレイ利得（SNR改善） | Diffuse noise + target. ‖ 拡散雑音＋目標。 | SNR improvement ≥ 6 dB vs single mic. ‖ 単一マイク比 SNR改善 ≥ 6 dB。 |
| 8.5 | Steering tracking ‖ 操舵追従 | Target moves; DOA feeds BF. ‖ 目標移動、DOAがBFを供給。 | Beam follows within 250 ms; no target dropout. ‖ ビームが250 ms以内に追従、目標欠落無し。 |
| 8.6 | Robustness to DOA error ‖ DOA誤差耐性 | Inject ±10° angle error. ‖ ±10°の角度誤差注入。 | Target loss ≤ 3 dB at ±10° mis-steer. ‖ ±10°誤操舵で目標損失 ≤ 3 dB。 |
| 8.7 | Speech quality / artifacts ‖ 音声品質・アーチファクト | POLQA/PESQ + listening. ‖ POLQA／PESQ＋試聴。 | No spatial artifacts, no target coloration. ‖ 空間アーチファクト・着色無し。 |

---

## 9. Block: Voice Recognition (on/off) — message: Voice ID ‖ ブロック：音声認識（オン／オフ）— メッセージ：Voice ID

**Function:** Speaker recognition/verification on the BF output; emits **Voice ID** to control Voice Filter. ‖ **機能:** BF出力に対する話者認識／照合。**Voice ID** を発行し Voice Filter を制御。

| # | Test ‖ テスト | Procedure ‖ 手順 | Pass criteria ‖ 合格基準 |
|---|---|---|---|
| 9.1 | Enrollment ‖ 登録 | Enroll N target speakers per spec. ‖ 仕様通りN名の目標話者を登録。 | Successful enrollment; stored ID retrievable. ‖ 登録成功、ID取得可能。 |
| 9.2 | Verification accuracy ‖ 照合精度 | Target vs impostor utterances. ‖ 目標 vs 詐称発話。 | FAR ≤ 3%, FRR ≤ 5% (report EER). ‖ FAR ≤ 3%、FRR ≤ 5%（EER報告）。 |
| 9.3 | Accuracy vs SNR/reverb ‖ SNR・残響依存 | 10 dB SNR, RT60 0.6 s. ‖ 10 dB SNR、RT60 0.6秒。 | EER degradation ≤ 5 pts vs clean. ‖ クリーン比 EER劣化 ≤ 5pt。 |
| 9.4 | On/OFF gating ‖ オンオフ動作 | Toggle block off. ‖ ブロックをオフ。 | When OFF, no Voice ID emitted; Voice Filter passes all. ‖ オフ時 Voice ID 非発行、Voice Filter全通過。 |
| 9.5 | EN/JA parity ‖ 日英同等性 | Equal EN/JA test sets. ‖ 日英均等テストセット。 | Accuracy gap ≤ 3 pts between languages. ‖ 言語間精度差 ≤ 3pt。 |
| 9.6 | Latency ‖ 遅延 | Time from utterance to Voice ID. ‖ 発話から Voice ID まで。 | Within control-loop budget (report). ‖ 制御ループ予算内（要報告）。 |

---

## 10. Block: Voice Filter (on/off) — controlled by Voice ID ‖ ブロック：ボイスフィルタ（オン／オフ）— Voice ID制御

**Function:** When ON, keep only the recognized target voice (per Voice ID), suppress other talkers. ‖ **機能:** オン時、認識された目標音声（Voice ID）のみ保持し他話者を抑圧。

| # | Test ‖ テスト | Procedure ‖ 手順 | Pass criteria ‖ 合格基準 |
|---|---|---|---|
| 10.1 | Target retention ‖ 目標保持 | Target only, filter ON. ‖ 目標のみ、フィルタON。 | Target loss ≤ 1 dB; POLQA degradation ≤ 0.3 MOS. ‖ 目標損失 ≤ 1 dB、POLQA劣化 ≤ 0.3 MOS。 |
| 10.2 | Interferer suppression ‖ 妨害抑圧 | Target + 1 competing talker. ‖ 目標＋競合話者1名。 | Non-target suppression ≥ 12 dB. ‖ 非目標抑圧 ≥ 12 dB。 |
| 10.3 | Multi-interferer ‖ 複数妨害 | Target + 2–3 talkers + babble. ‖ 目標＋2〜3話者＋バブル。 | Target intelligible (STOI maintained); WER improved. ‖ 目標明瞭（STOI維持）、WER改善。 |
| 10.4 | Bypass when OFF ‖ オフ時バイパス | Filter OFF. ‖ フィルタOFF。 | Transparent — all voices pass, no processing artifacts. ‖ 透過 — 全音声通過、処理アーチファクト無し。 |
| 10.5 | Wrong-ID rejection ‖ 誤ID棄却 | Feed impostor as if target. ‖ 詐称を目標として入力。 | Non-enrolled voice correctly suppressed. ‖ 未登録音声を正しく抑圧。 |
| 10.6 | On↔Off transition ‖ オンオフ遷移 | Toggle during speech. ‖ 発話中に切替。 | No clicks/pops/dropouts; smooth crossfade. ‖ クリック・ポップ・欠落無し、平滑クロスフェード。 |

---

## 11. Block: Gain & Output ‖ ブロック：ゲイン・出力

**Function:** Final output leveling to the delivery target. ‖ **機能:** 配信目標への最終レベル調整・出力。

| # | Test ‖ テスト | Procedure ‖ 手順 | Pass criteria ‖ 合格基準 |
|---|---|---|---|
| 11.1 | Output level accuracy ‖ 出力レベル精度 | Reference input, measure output. ‖ 基準入力で出力測定。 | Within ±1 dB of target. ‖ 目標±1 dB以内。 |
| 11.2 | Linearity ‖ 直線性 | Sweep input level. ‖ 入力レベル掃引。 | Linear within operating range; gain error ≤ 1 dB. ‖ 動作域で直線、ゲイン誤差 ≤ 1 dB。 |
| 11.3 | No clipping ‖ 非クリップ | Max-level chain output. ‖ 最大レベルチェーン出力。 | No clip; true-peak ≤ −1 dBTP. ‖ クリップ無し、トゥルーピーク ≤ −1 dBTP。 |
| 11.4 | Output integrity ‖ 出力整合 | Channel count, format, SR. ‖ ch数・形式・サンプルレート。 | Matches spec; no dropouts over 1 h. ‖ 仕様一致、1時間で欠落無し。 |

---

## 12. End-to-End / System Validation ‖ エンドツーエンド・システム検証

With all blocks active and all bypasses OFF, validate the full chain under realistic scenarios. ‖ 全ブロック有効・全バイパスOFFで、現実的シナリオ下のチェーン全体を検証。

| # | Scenario ‖ シナリオ | Procedure ‖ 手順 | Pass criteria ‖ 合格基準 |
|---|---|---|---|
| 12.1 | Quiet single talker ‖ 静室・単独話者 | Talker at 1 m, quiet room. ‖ 1 m、静室。 | End-to-end POLQA ≥ 3.8 MOS. ‖ E2E POLQA ≥ 3.8 MOS。 |
| 12.2 | Noisy far talker ‖ 雑音・遠距離話者 | 3 m, 10 dB SNR babble. ‖ 3 m、10 dB SNRバブル。 | ΔMOS ≥ +0.5 vs raw mic; ASR WER ↓ ≥ 30% rel. ‖ 生マイク比 ΔMOS ≥ +0.5、ASR WER相対 ↓ ≥ 30%。 |
| 12.3 | Echo + near talker ‖ エコー＋近端話者 | Device playback + talker. ‖ 機器再生＋話者。 | No audible echo; double-talk intelligible. ‖ 可聴エコー無し、ダブルトーク明瞭。 |
| 12.4 | Reverberant room ‖ 残響室 | RT60 0.6 s, moving talker. ‖ RT60 0.6秒、移動話者。 | DOA tracks, BF follows, intelligible output. ‖ DOA追従・BF追従・明瞭出力。 |
| 12.5 | Competing talkers + Voice Filter ‖ 競合話者＋ボイスフィルタ | Target + 2 interferers, filter ON. ‖ 目標＋妨害2名、フィルタON。 | Only target audible; interferers ≥ 12 dB down. ‖ 目標のみ可聴、妨害 ≥ 12 dB低減。 |
| 12.6 | End-to-end latency ‖ E2E遅延 | Input→Output timestamp. ‖ 入出力タイムスタンプ。 | Within system latency budget (report ms). ‖ システム遅延予算内（ms報告）。 |
| 12.7 | Long-run stability ‖ 長時間安定性 | 8 h continuous run. ‖ 8時間連続。 | No crash, drift, memory growth, or quality drift. ‖ クラッシュ・ドリフト・メモリ増加・品質劣化無し。 |
| 12.8 | A/B per-block regression ‖ ブロック別A/B回帰 | Bypass one block at a time. ‖ ブロックを1つずつバイパス。 | Each block shows expected positive contribution. ‖ 各ブロックが期待通りの寄与。 |

---

## 13. Results Matrix (Template) ‖ 結果マトリクス（テンプレート）

| Block ‖ ブロック | Test ID | Metric ‖ 指標 | Target ‖ 目標 | Measured ‖ 測定値 | Pass/Fail ‖ 合否 | Notes ‖ 備考 |
|---|---|---|---|---|---|---|
| 6CH Input | 1.1–1.9 | | | | | |
| VAD | 3.1–3.5 | | | | | |
| AEC | 4.1–4.6 | | | | | |
| ANR | 4.7–4.12 | | | | | |
| Dereverberation | 5.1–5.5 | | | | | |
| AGC | 6.1–6.6 | | | | | |
| DOA | 7.1–7.7 | | | | | |
| BF | 8.1–8.7 | | | | | |
| Voice Recognition | 9.1–9.6 | | | | | |
| Voice Filter | 10.1–10.6 | | | | | |
| Gain/Output | 11.1–11.4 | | | | | |
| End-to-End | 12.1–12.8 | | | | | |

**Deliverables:** completed matrix, raw multichannel recordings (.wav, all tap points), analysis exports (POLQA/PESQ/STOI/ERLE), DOA & Voice-ID logs, calibration certificates, test photos/room sketch, environment & firmware/version record. ‖ **納品物:** 記入済みマトリクス、生多ch録音（.wav、全タップ点）、解析出力（POLQA／PESQ／STOI／ERLE）、DOA・Voice IDログ、校正証明書、試験写真・室図、環境＆ファーム／バージョン記録。

---

## 14. General Acceptance ‖ 総合合格条件

A block **passes** when all its mandatory tests meet criteria across the full EN+JA corpus and all SNR/reverb conditions specified. The **system passes** when all blocks pass and all §12 end-to-end scenarios pass. Any failure must be logged with raw evidence and a root-cause note. Criteria values in brackets are reference targets — confirm exact thresholds against the agreed product specification before testing. ‖ あるブロックは、日英コーパス全体および指定の全SNR／残響条件で必須テスト全てが基準を満たした場合に**合格**とする。全ブロック合格かつ §12 のE2Eシナリオ全てが合格した場合に**システム合格**とする。不合格は生データと原因メモを添えて記録すること。括弧内の基準値は参考目標であり、テスト前に合意済み製品仕様で正確な閾値を確認すること。
