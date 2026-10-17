# Case study: issue #5, increase precision where possible

- Issue: [konard/voice-simulator#5](https://github.com/konard/voice-simulator/issues/5)
- Pull request: [konard/voice-simulator#6](https://github.com/konard/voice-simulator/pull/6)

This study lists every requirement of the issue, the online research behind
each design decision, the solution chosen with its implementation location,
the measurements taken during development, the existing libraries that were
considered, and what remains open.

## Contents

| Folder / file                                                                          | What it holds                                                                                                                             |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [`data/issue-5.json`](data/issue-5.json)                                               | Snapshot of the issue (title, body, labels)                                                                                               |
| [`data/issue-5-comments.json`](data/issue-5-comments.json)                             | Issue comments at the time of writing (none)                                                                                              |
| [`data/pr-6.json`](data/pr-6.json)                                                     | Snapshot of the pull request                                                                                                              |
| [`data/pr-6-comments.json`](data/pr-6-comments.json)                                   | Pull request conversation comments at the time of writing (none)                                                                          |
| [`data/pr-6-review-comments.json`](data/pr-6-review-comments.json)                     | Pull request inline review comments at the time of writing (none)                                                                         |
| [`data/perf-baseline-main.json`](data/perf-baseline-main.json)                         | Render time and waveform hash of every audio tier on `main` (`experiments/issue-5-perf-baseline.mjs`)                                     |
| [`data/perf-after-optimisation.json`](data/perf-after-optimisation.json)               | The same after the FDTD speed-up: identical hashes, less time                                                                             |
| [`data/machine.txt`](data/machine.txt)                                                 | Hardware and runtime of the measurements                                                                                                  |
| [`research/competitors.md`](research/competitors.md)                                   | Pink Trombone and forks, VocalTractLab, Praat, Gnuspeech, Maeda, TubeTalker, eSpeak NG, Klatt, MBROLA, Piper, XTTS, RVC                   |
| [`research/anatomy-and-acoustics.md`](research/anatomy-and-acoustics.md)               | Male, female and child vocal tract data, teeth and tongue anatomy, side branches, room and microphone acoustics                           |
| [`research/voice-matching-and-formats.md`](research/voice-matching-and-formats.md)     | F0, formant, VTL and voice quality estimation, analysis-by-synthesis fitting, audio file formats and encoders                             |
| [`research/linguistics-and-highlighting.md`](research/linguistics-and-highlighting.md) | Text normalisation, punctuation prosody, accents (GA, RP, Australian, Indian), syllabification, word and syllable timing for highlighting |
| [`research/video-and-science.md`](research/video-and-science.md)                       | The video named in the issue (Sawada's talking robot), key papers, FDTD numerics and the limits of the speed-up                           |

## Requirements

Every requirement below is quoted or paraphrased from the issue text. The
status column refers to this pull request.

| #   | Requirement (issue text)                                         | Solution                                                                                                                                                                                                                                                                                                                                                           | Where                                                                                                                                                                                         | Verification                                                                                                            | Status |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------ |
| R1  | Keep the previous version available at `/v1`                     | The Pages build checks out the commit before this work (`a1129cb`, released by pull request #4) in a temporary worktree, builds its app with a relative base and copies it to `dist/v1/`. More versions are added in `previous-versions.json`.                                                                                                                     | `scripts/build-previous-versions.mjs`, `examples/universal-app/previous-versions.json`                                                                                                        | `tests/universal-app.test.js`; the Example app workflow builds both                                                     | Done   |
| R2  | Detect sooner that the hardware cannot keep up                   | Predict a tier's load from the cheaper tier before measuring it, stop a measurement early, detect overload in the first 40-300 ms of an utterance and restart on a fitting tier, cache the benchmark per device.                                                                                                                                                   | `src/perf/lod.js`, `src/perf/benchmark.js`, `examples/universal-app/src/engine/`                                                                                                              | `tests/library.test.js`, `tests/universal-app-engine.test.js` (slow-clock worker run)                                   | Done   |
| R3  | The same waveform in less time                                   | WebAssembly FDTD kernel with the same `f64` operations in the same order, incremental articulation updates. Hashes identical, 1.5-1.7× faster on the 3D tiers.                                                                                                                                                                                                     | `src/acoustics/fdtd-kernel.js`, `src/acoustics/fdtd3d.js`, `experiments/wasm/`                                                                                                                | `tests/fdtd3d.test.js` (wasm = JS bit for bit), `data/perf-*.json`                                                      | Done   |
| R4  | A more anatomically realistic 3D model, with 3D levels of detail | Dental arches with individual teeth, a tongue body with blade and tip, a hard and soft palate, and four mesh LODs for each of them that follow the visual tier.                                                                                                                                                                                                    | `src/geometry/anatomy.js` (`ANATOMY_LODS`), `examples/universal-app/src/viewer/head-viewer.js`                                                                                                | `tests/anatomy.test.js`                                                                                                 | Done   |
| R5  | Configurable microphone position                                 | Microphone distance, azimuth and elevation with a directivity, distance and delay model on the waveguide tiers, and a real probe position in the 3D grid.                                                                                                                                                                                                          | `src/acoustics/microphone.js`, `src/acoustics/fdtd3d.js`, CLI `--mic-*`, HTTP `microphone`, app Acoustics panel                                                                               | `tests/listening.test.js`, `tests/listening-flags.test.js`, `tests/universal-app-listening.test.js`                     | Done   |
| R6  | A box around the head for reverb                                 | Room presets (image sources + feedback delay network) for every tier, and on the 3D tiers a simulated box of air around the head with absorbing walls.                                                                                                                                                                                                             | `src/acoustics/room.js`, `src/acoustics/voxel-model.js`, CLI `--room` / `--box`                                                                                                               | `tests/listening.test.js`                                                                                               | Done   |
| R7  | Male and female presets                                          | `male`, `female` and `child` presets (plus `any`) that restrict the random head to the measured ranges of each group (Hillenbrand 1995, Fitch & Giedd 1999).                                                                                                                                                                                                       | `src/head-presets.js`, `src/head-config.js`, CLI `--preset`, HTTP `preset`, app preset selector                                                                                               | `tests/head-presets.test.js` (F0 and F2 ratio measured on rendered audio)                                               | Done   |
| R8  | WAV back in the settings, to copy a voice from it                | `matchVoice` measures F0, formants, vocal tract length, H1-H2 and rate from a recording and fits the head by analysis-by-synthesis. The app accepts an upload or a microphone recording.                                                                                                                                                                           | `src/analysis/voice-features.js`, `src/analysis/voice-match.js`, CLI `match`, `examples/universal-app/src/components/VoiceMatch.js`                                                           | `tests/voice-match.test.js`                                                                                             | Done   |
| R9  | Everything that affects how speech sounds is configurable        | 14 constants that were hard-coded became head parameters (jitter, shimmer, vibrato, aspiration, declination, accent strength, lengthening, pauses, speed, wall loss, nasal coupling, frication, gain); teeth and piriform fossae can be switched off.                                                                                                              | `src/head-config.js` (`HEAD_PARAMETERS`), `src/synthesize.js`                                                                                                                                 | `tests/head-parameters.test.js` (default keeps the sound, any other value changes it)                                   | Done   |
| R10 | Linguistics: accents                                             | English accents (General American, British RP, Australian, Indian) as rule sets over the G2P output.                                                                                                                                                                                                                                                               | `src/g2p/accents.js`, `lang: 'en-GB'` etc.                                                                                                                                                    | `tests/accents.test.js`                                                                                                 | Done   |
| R11 | Linguistics: punctuation                                         | Each punctuation mark has its own pause length and clause tune (statement, question, continuation, exclamation, parenthesis, quotation); numbers, dates, money, units and abbreviations are normalised per language.                                                                                                                                               | `src/articulation/prosody.js`, `src/g2p/normalize.js`, `src/g2p/verbalize-*.js`                                                                                                               | `tests/prosody.test.js`, `tests/text-normalization.test.js`                                                             | Done   |
| R12 | Study the state of the art, competitors and the video            | Five research notes with sources; the video (Sawada's talking robot) and the competitors are compared with this project.                                                                                                                                                                                                                                           | `research/*.md`                                                                                                                                                                               | Links checked by the link checker                                                                                       | Done   |
| R13 | Teeth and tongue, visually and acoustically                      | The incisors are carved into the area function (gap 1.5-15 mm with the jaw) and voxelised as solid cells for the 3D solver; sibilant noise starts just past them. The tongue, teeth, palate and velum meshes are built from the same tract shape, so the drawn tongue dorsum is the wall the solvers use. The piriform fossae add their side-branch antiresonance. | `src/articulation/teeth.js`, `src/articulation/tract-shape.js`, `src/acoustics/waveguide.js`, `src/acoustics/voxel-model.js`, `anatomy.js`                                                    | `tests/teeth.test.js`, `tests/piriform.test.js`, `tests/anatomy.test.js`                                                | Done   |
| R14 | Several audio formats                                            | WAV (8/16/24/32-bit PCM, 32/64-bit float, extensible headers; reads G.711 too), AIFF / AIFF-C, Sun AU, FLAC (8/16/24-bit, pure JS) and raw PCM, written and read, with resampling. The app downloads in any of them.                                                                                                                                               | `src/audio/`, CLI `-o file.ext -b`, `convert`, HTTP `format`, `examples/universal-app/src/components/ExportControls.js`                                                                       | `tests/audio-formats.test.js`, `tests/wav-formats.test.js`, `tests/cli-audio.test.js`                                   | Done   |
| R15 | Highlight the current word and syllable                          | `utteranceTimeline` turns the plan into word and syllable start and end times (syllables by maximal onset and sonority, mapped back to letters, Hindi by akshara). In the app, `SpokenText` lights the current word and syllable in the text and in the IPA. It follows the same audio clock as the 3D view, or the wall clock when the sound is off.              | `src/articulation/timeline.js`, `src/ipa/syllables.js`, `src/g2p/orthography.js`, CLI `timeline`, HTTP `/api/timeline`, `examples/universal-app/src/components/SpokenText.js`, `highlight.js` | `tests/timeline.test.js`, `tests/syllables.test.js`, `tests/highlight.test.js`, `tests/universal-app-highlight.test.js` | Done   |
| R16 | A deep case study in `docs/case-studies/issue-5`                 | This document, its research notes and its data.                                                                                                                                                                                                                                                                                                                    | `docs/case-studies/issue-5/`                                                                                                                                                                  | -                                                                                                                       | Done   |

## Architecture

```text
text ──► normalisation (numbers, abbreviations, symbols) ──► G2P (en-US / en-GB / ru / hi / zh)
                                                                     │
                     punctuation classes ──► clause tunes, pauses    │  syllables, word spans
                                                                     ▼
head config (presets male / female / child, seeded random) ──► articulation plan
     ▲                                                               │
     │ matchVoice (F0, formants, VTL, tilt from a recording)         ├──► utterance timeline ──► word and
     │                                                               │                          syllable highlight
     │                                       ┌───────────────────────┼──────────────────────┐
     │                                       ▼                       ▼                      ▼
     │                         tract areas + teeth + nose     implicit 3D head        mouth animation
     │                                       │               (teeth, tongue, palate)  (jaw, lips, tongue)
     │                                       ▼                 │           │                 │
     │                        waveguide (minimal / low /    voxel model   meshes, 4 LODs ◄───┘
     │                        medium tiers)                    │           │
     │                                       │                 ▼           ▼
     │                                       │       3D FDTD (high / ultra, wasm kernel)   three.js
     │                                       ▼                 │
     │                                  microphone (distance, angle) ──► room (box, image sources + FDN)
     │                                                         │
     └──────────── recording (WAV, AIFF, AU, FLAC, raw) ◄──────┴──► audio encoders (WAV variants, AIFF, AU, FLAC, raw)
```

## Detecting slow hardware sooner

On `main` the app measured all five audio tiers at start-up (about 0.4 s of
audio each) and then adjusted the tier slowly during speech. A device that
could not run a tier in real time was noticed only after the benchmark had
spent seconds on the expensive tiers, or after audible gaps.

This pull request adds four mechanisms (`src/perf/lod.js`,
`src/perf/benchmark.js`, `examples/universal-app/src/engine/`):

1. **Predict before measuring.** `chooseTier` multiplies the load measured on
   the cheaper tier by the cost ratio and does not run a tier whose predicted
   load is above twice the target. On a slow device `ultra` (cost 65) is never
   measured.
2. **Stop a measurement early.** `measureAudioTier(tier, {limit})` renders in
   small blocks and returns as soon as the load is clearly above the limit.
3. **Detect overload while speaking.** `OverloadDetector` looks at the first
   40-300 ms of rendered audio. If the tier is slower than 1.2× real time, the
   worker restarts the utterance at once on the most detailed tier predicted
   to fit (`fallbackLevel`). This happens while the audio is still inside the
   player's lead, so the listener hears no gap. The HUD counts these early
   step-downs.
4. **Remember the result.** The app stores the benchmark per device in
   `localStorage`, so a later visit starts at the right tier immediately. The
   fresh measurement still runs and replaces the cached one.

The tests in `tests/library.test.js` and `tests/universal-app-engine.test.js`
cover each of these, including a worker run in which an artificial slow clock
makes it step down from `high` to `minimal` within one utterance.

## Same waveform in less time

The 3D FDTD tiers dominate the cost. The speed-up keeps every sample
bit-identical:

- A WebAssembly step kernel (source in `experiments/wasm/`, embedded in
  `src/acoustics/fdtd-kernel.js`) performs the same `f64` operations in the
  same order as the JavaScript loop. IEEE 754 arithmetic is deterministic for
  the same sequence of operations, so the output is identical. The JavaScript
  kernel remains as a fallback (`kernel: 'js'`).
- On an articulation change only tube links and cells are updated, link
  section spans are cached, and an unchanged shape skips the update.

`experiments/issue-5-perf-baseline.mjs` renders the same sentence on every
tier and hashes the samples:

| Tier    | Hash (main and this branch) | Load on `main` | Load after | Speed-up |
| ------- | --------------------------- | -------------- | ---------- | -------- |
| minimal | `cbb1ec33d2c8887d`          | 0.26           | 0.22       | ≈1×      |
| low     | `1502d7577fac47f4`          | 0.15           | 0.17       | ≈1×      |
| medium  | `910eec77f2de8e4d`          | 0.12           | 0.16       | ≈1×      |
| high    | `c34cabf3c20e3f32`          | 1.35           | 0.90       | 1.5×     |
| ultra   | `701a5296a816d2fd`          | 8.08           | 4.80       | 1.7×     |

The table compares `main` with commit `5c60525` (the speed-up alone). Later
commits change the sound on purpose (teeth, piriform fossae, new head
parameters), so their hashes differ from these; the speed-up itself never
changes a sample, which `tests/fdtd3d.test.js` checks on every run.

The machine was shared with other jobs (`data/machine.txt`), so the
waveguide rows vary by ±30% between runs; their code did not change. The
relative tier costs in `AUDIO_TIERS` were recalibrated with
`experiments/issue-5-tier-costs.mjs` (high 60 → 10, ultra 300 → 65), which
makes the predictions of the early detection accurate.

Further speed-ups that would keep the waveform identical, and why they were
not done here, are listed in [future work](#future-work).
`research/video-and-science.md` also explains why a coarser grid or a
different scheme would be faster but would change the waveform.

## Existing components and libraries

| Component                                     | Licence               | Used? | Reason                                                                                                                                                                                       |
| --------------------------------------------- | --------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pink Trombone (Neil Thapen)                   | MIT                   | Idea  | LF glottis with an Rd knob and a nose branch; our waveguide is a separate implementation driven by the 3D head.                                                                              |
| VocalTractLab 2.x / VocalTractLab3D           | GPL-3.0               | Idea  | Teeth, side cavities and speaker presets guided the anatomy work; the code is C++/GPL and is not used.                                                                                       |
| Praat (articulatory synthesis, analysis)      | GPL-2.0+              | Idea  | The Speaker/Artword split matches our head config/plan split; Praat's formant and pitch analysis is the reference for `matchVoice`.                                                          |
| Gnuspeech TRM, Maeda model                    | GPL / academic        | Idea  | Few control regions are enough to fit a voice, so the fit works on a small set of head parameters.                                                                                           |
| Story / TubeTalker area functions             | Published data        | Data  | Male and female area functions and vocal tract lengths for the presets.                                                                                                                      |
| Hillenbrand et al. 1995 vowel data            | Published data        | Data  | Male, female and child F0 and formant means used to set and check the presets.                                                                                                               |
| eSpeak NG                                     | GPL-3.0               | Idea  | Punctuation clause tunes and per-accent rules were reimplemented; the GPL code and data are not bundled.                                                                                     |
| Klatt / KLSYN88                               | Academic              | Idea  | Voice quality parameters (open quotient, spectral tilt, aspiration) are exposed as head parameters.                                                                                          |
| MBROLA, Festival                              | AGPL / X11            | Idea  | Phoneme + duration + pitch target timeline and utterance relations (word, syllable, segment) inform the timeline API.                                                                        |
| Piper, Coqui XTTS, RVC                        | MIT, GPL / CPML / MIT | No    | Neural models need recordings and large weights; this project synthesises from physics only. XTTS is non-commercial.                                                                         |
| lamejs (MP3), libflac.js                      | LGPL / MIT            | No    | Large or LGPL; FLAC is written and read by a small pure-JS codec here (`src/audio/flac.js`), checked against the reference decoder in `experiments/issue-5-flac-crosscheck.mjs`.             |
| Web Audio `decodeAudioData`, `MediaRecorder`  | Platform              | Yes   | The app reads WAV, FLAC, AIFF and AU with the library decoders and lets the browser decode anything else (MP3, Ogg, AAC…); the microphone recording for voice matching uses `MediaRecorder`. |
| Shoebox image-source method (Allen & Berkley) | Published method      | Yes   | Early reflections of the box around the head; a small feedback delay network adds the late tail.                                                                                             |
| three.js, React                               | MIT                   | Yes   | 3D view and UI of the app, as before.                                                                                                                                                        |

The research files hold the full comparison with links and licences.

## Measuring formants after adding the piriform fossae

The piriform fossae add a side-branch antiresonance near 4-5 kHz. With the
usual LPC order (2 + rate / 1000, 12 at 11 kHz) the extra zero takes up a
pole pair, and on a male /ə/ the analysis lost F2: it reported F2 = 2390 Hz
(really F3) and a female/male F2 ratio of 0.58
(`experiments/issue-5-preset-formants.mjs`,
[`data/preset-formants.txt`](data/preset-formants.txt)). Without the fossae
the ratio is 1.17, inside the 10-25% range expected from women's shorter
tracts. The presets test now measures with order 14, which keeps F2.

`analyzeVoice` (voice matching) keeps order 12: it estimates the vocal tract
length from the spacing of F1-F4, and over male, female and child heads
order 12 is closer to the true length than order 14, which overestimates
child tracts by up to 6 cm (`experiments/issue-5-vtl-order.mjs`,
[`data/vtl-order.txt`](data/vtl-order.txt)).

## Known limitations

- The waveguide tiers are 1D. They are accurate up to about 5 kHz; above
  that, only the 3D FDTD tiers model transverse modes, and those cost 10 to 65
  times more (`research/video-and-science.md`).
- `matchVoice` fits a small set of parameters by analysis-by-synthesis on
  sustained statistics (F0, formants, tilt). It copies the size and quality of
  a voice, not a speaker's accent, rhythm or idiolect.
- The video in the issue could not be watched from the build environment;
  it was identified from its title and from articles that embed it
  (`research/video-and-science.md`).
- The benchmark numbers come from a shared, loaded VM and vary between runs.
- The piriform fossae are a side branch of the 1D waveguide only; the 3D
  FDTD grid does not carve them yet.
- At the 1 cm voxels of the `high` tier the incisors are one cell thick, so
  the teeth change the 3D sibilant noise only slightly.
- The palate and velum meshes are schematic (a parabolic vault and a flap),
  not segmented from MRI.
- Voice matching has a breathiness control, but breathiness barely changes
  the measured harmonics-to-noise ratio (about 0.8 dB from 0 to 1), so in
  practice it is not matched. Without a transcript the fitted parameters are
  only accurate to about 10-15%, because the measured features depend on the
  words spoken. It was tested on synthetic recordings with known heads, not
  on recordings of real speakers.
- Accents are rule sets over the General American dictionary output, not
  separate dictionaries, so word-specific differences (for example the
  British "tomato") are only partly covered. General American now flaps an
  intervocalic t (water → ˈwɔɾɚ), which changes the IPA of existing input.
- Syllables are mapped back to English and Russian spelling heuristically.
  When no mapping fits, the word's letters are split in proportion to the
  syllables. Hindi is split into aksharas, so a coda consonant is shown with
  the next akshara (नमस्ते: न·म·स्ते for nə.məs.t̪eː).
- Expanded text such as a date or a number is highlighted as one word without
  syllables. If the text and IPA word counts differ, only the IPA line is
  highlighted.

## Future work

- WebGPU compute backend for the 3D FDTD step (same scheme, `f32`): faster,
  but not bit-identical to the `f64` CPU kernel, so it would be a new tier.
- WebAssembly SIMD for the FDTD kernel: requires reordering the additions,
  which changes the rounding and therefore the waveform by about 1 ulp.
- A muscle-driven tongue (ArtiSynth-style FEM) for the most detailed visual
  tier.
- Gradient-based voice matching through a differentiable waveguide
  (vocal-tract-grad) instead of the derivative-free fit.
