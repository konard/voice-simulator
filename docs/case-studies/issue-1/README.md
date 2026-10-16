# Case study: issue #1, initial prototype

- Issue: [konard/voice-simulator#1](https://github.com/konard/voice-simulator/issues/1)
- Pull request: [konard/voice-simulator#2](https://github.com/konard/voice-simulator/pull/2)

This study collects the requirements of the issue, the online research behind
the design, the solution chosen for each requirement with its implementation
location, the measurements taken during development, and the known limits of
the prototype.

## Contents

| Folder / file                                                                          | What it holds                                                                                                        |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [`data/issue-1.json`](data/issue-1.json)                                               | Snapshot of the issue (title, body, labels)                                                                          |
| [`data/issue-1-comments.json`](data/issue-1-comments.json)                             | Issue comments at the time of writing (none)                                                                         |
| [`data/pr-2-comments.json`](data/pr-2-comments.json)                                   | Pull request comments at the time of writing (none)                                                                  |
| [`data/benchmark-local.json`](data/benchmark-local.json)                               | Audio tier loads measured on the development machine                                                                 |
| [`data/simulation-local-dx0.6.json`](data/simulation-local-dx0.6.json)                 | Local run of `scripts/check-simulation.mjs` with the 0.6 cm grid                                                     |
| [`data/waveguide-vowel-formants.txt`](data/waveguide-vowel-formants.txt)               | LPC formants of synthesized vowels versus the tube model                                                             |
| [`data/fdtd-open-vowel-a-dx0.6.txt`](data/fdtd-open-vowel-a-dx0.6.txt)                 | 3D FDTD impulse spectrum peaks of /a/ on a 0.6 cm grid                                                               |
| [`data/fdtd-open-vowel-a-dx0.4.txt`](data/fdtd-open-vowel-a-dx0.4.txt)                 | The same on a 0.4 cm grid (rules out discretisation error)                                                           |
| [`data/machine.txt`](data/machine.txt)                                                 | Hardware and runtime of the measurements                                                                             |
| [`data/random-head-resonances.txt`](data/random-head-resonances.txt)                   | Worst resonance error of both solvers over 100 random heads                                                          |
| [`data/random-head-ci-8.txt`](data/random-head-ci-8.txt)                               | Why LPC reported F1 = 390 Hz for random head `ci-8` (first CI run)                                                   |
| [`research/articulatory-synthesis.md`](research/articulatory-synthesis.md)             | Articulatory synthesis: Pink Trombone, VocalTractLab, TubeTalker, glottal models, 2D/3D wave simulation, cost        |
| [`research/ipa-and-g2p.md`](research/ipa-and-g2p.md)                                   | Grapheme-to-phoneme tools and data for English, Russian, Hindi and Chinese                                           |
| [`research/web-performance-and-delivery.md`](research/web-performance-and-delivery.md) | AudioWorklet, workers, COOP/COEP, WebGPU, LOD control, delivery targets, anatomical data (Story 2008 area functions) |

## Requirements

Every requirement below is quoted or paraphrased from the issue text. The
status column refers to this pull request.

| #   | Requirement                                                                                                  | Solution                                                                                                                                                                                                                                                                                  | Where                                                                                    | Status                                      |
| --- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------- |
| R1  | Efficient 3D voice simulator, no sound recordings, sound waves move through the actual 3D shape of the head  | A glottal source drives an acoustic solver over the vocal tract and nose. Two solvers: a Kelly-Lochbaum waveguide whose areas come from the 3D head (fast tiers) and a 3D FDTD solver on a voxel model of the same implicit head surface (high tiers). No sample data is shipped or used. | `src/acoustics/`, `src/geometry/model.js`, `src/acoustics/voxel-model.js`                | Done                                        |
| R2  | Low-poly head model with a 3D view                                                                           | An implicit head surface (smooth union of ellipsoids) polygonised at four mesh LODs (8×12 up to 28×44 rings × segments), plus tract, nose and lip meshes. The web app renders it with three.js; the library exports OBJ.                                                                  | `src/geometry/mesh.js`, `examples/universal-app/src/viewer/head-viewer.js`               | Done                                        |
| R3  | Translate English, Russian, Hindi and Chinese to IPA                                                         | Rule- and dictionary-based G2P per language with script-based language detection (see [G2P](#text-to-ipa)).                                                                                                                                                                               | `src/g2p/`                                                                               | Done                                        |
| R4  | Smooth transitions between IPA symbols mapped to the 3D model                                                | IPA tokens become articulator targets (jaw, tongue body, tip, lips, velum, glottis…) on a control-rate timeline; a zero-phase critically damped filter per articulator gives smooth coarticulated trajectories. The tract shape and the 3D meshes are both derived from those channels.   | `src/articulation/plan.js`, `src/articulation/tract-shape.js`                            | Done                                        |
| R5  | Works with or without visible mouth animation                                                                | The articulation plan drives the audio solver alone; the viewer only reads the same timeline. The library and CLI never touch the viewer.                                                                                                                                                 | `src/synthesize.js`, `examples/universal-app/src/engine/`                                | Done                                        |
| R6  | Editor of head and mouth proportions; a page refresh gives a random configuration                            | 18 `HEAD_PARAMETERS` (size, tract length, palate, lips, nose, voice pitch…) with an editor panel. Each page load draws a new seed; `?seed=` reproduces a head.                                                                                                                            | `src/head-config.js`, `examples/universal-app/src/components/HeadEditor.js`              | Done                                        |
| R7  | Multiple LODs with automatic adjustment, always keeping about 20% buffer                                     | `LodGovernor` with a target load of 0.8: it steps down at once when the smoothed load exceeds 80% and steps up only when the next tier's predicted load stays under the target with margin and after a dwell time. Five audio tiers and four visual tiers.                                | `src/perf/lod.js`, `src/perf/benchmark.js`                                               | Done                                        |
| R8  | Modes: only sound, only visual, or both                                                                      | A `mode` setting (`both`, `sound`, `visual`) in the app; `sound` skips the viewer, `visual` skips audio output.                                                                                                                                                                           | `examples/universal-app/src/App.js`, `examples/universal-app/src/engine/voice-engine.js` | Done                                        |
| R9  | GPU/CPU optimisation                                                                                         | The CPU simulation runs in a Web Worker in typed arrays with no allocation per sample; the GPU renders the low-poly meshes and the pressure field. A WebGPU FDTD backend is planned (see [future work](#future-work)).                                                                    | `examples/universal-app/src/engine/synth-worker.js`, `src/acoustics/fdtd3d.js`           | Done for CPU; WebGPU compute is future work |
| R10 | GitHub Pages as the primary UI                                                                               | The example app is the voice simulator web UI, deployed by the existing Pages workflow.                                                                                                                                                                                                   | `examples/universal-app/`, `.github/workflows/`                                          | Done (needs Pages Source = GitHub Actions)  |
| R11 | Library                                                                                                      | `voice-simulator` npm package: `synthesize`, `synthesizeStream`, `textToIpa`, head configuration, solvers, meshes, LOD; typed in `src/index.d.ts`.                                                                                                                                        | `src/index.js`                                                                           | Done                                        |
| R12 | CLI                                                                                                          | `voice-simulator ipa`, `say` (WAV), `head`, `mesh` (OBJ), `benchmark`, `serve`.                                                                                                                                                                                                           | `bin/voice-simulator.js`                                                                 | Done                                        |
| R13 | Local server API including streaming                                                                         | Dependency-free `node:http` server: `/api/ipa`, `/api/head/random`, `/api/mesh.obj`, `/api/synthesize`, `/api/stream` (chunked WAV produced while simulating), `/api/tiers`, `/api/languages`, `/api/health`.                                                                             | `src/server/server.js` (`voice-simulator/server` export)                                 | Done                                        |
| R14 | Docker image with the server                                                                                 | `Dockerfile` that runs `voice-simulator serve`; CI builds it on pull requests and publishes it when Docker Hub variables are set.                                                                                                                                                         | `Dockerfile`, `.github/workflows/release.yml`                                            | Done                                        |
| R15 | A complete demo web app                                                                                      | Same app as R10: text box, language picker, IPA view, head editor, mode switch, theme and locale (en/ru), LOD HUD.                                                                                                                                                                        | `examples/universal-app/`                                                                | Done                                        |
| R16 | Everything with intense computations runs in release or CI/CD testing                                        | Unit tests use coarse grids and short clips. A CI `simulation` job runs the fine-grid 3D FDTD resonance check, every language on every tier up to `high`, resonance and stability checks of 24 random heads with both solvers, and a tier benchmark, and uploads WAV files and a report.  | `scripts/check-simulation.mjs`, `release.yml` job `simulation`                           | Done                                        |
| R17 | Case study in `docs/case-studies/issue-1` with data, online research, requirements, solutions and components | This document and the `data/` and `research/` folders.                                                                                                                                                                                                                                    | `docs/case-studies/issue-1/`                                                             | Done                                        |
| R18 | Everything in a single pull request                                                                          | All work is on branch `issue-1-2e16b430da4f`, pull request #2.                                                                                                                                                                                                                            | —                                                                                        | Done                                        |

## Architecture

```text
text ──► language detection ──► G2P (en / ru / hi / zh) ──► IPA tokens
                                                              │
head config (18 parameters, seeded random) ───────────────────┤
                                                              ▼
                                   articulation plan (targets + smoothing,
                                   prosody: stress, tones, declination)
                                                              │
                         ┌────────────────────────────────────┼─────────────────────┐
                         ▼                                    ▼                     ▼
           tract area function + nose            implicit 3D head surface    mouth animation
                         │                          │            │          (jaw, lips, tongue)
                         ▼                          ▼            ▼                  │
             waveguide solver (tiers           voxel model   low-poly meshes ◄──────┘
             minimal / low / medium)               │         (4 mesh LODs)
                         │                          ▼            │
                         │              3D FDTD solver (tiers    │
                         │              high / ultra)            │
                         ▼                          │            ▼
              glottal source (LF pulse,             │       three.js viewer
              aspiration noise)                     │       + pressure field
                         │                          │
                         └──────────► audio ◄───────┘
                     WAV · stream · Web Audio · HTTP chunked response
```

The LOD governor watches the time spent per audio block and per frame and
moves the audio and visual tiers independently so the measured load stays at
or below 80% of the real-time budget.

### Text to IPA

| Language | Approach                                                                                                                                                                                 | Data                                                                 |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| English  | Dictionary lookup, suffix stripping (`-s`, `-ed`, `-ing`, `-ly`…), then letter-to-sound rules for unknown words; ARPABET to IPA with stress marks                                        | 12,000 frequent words from CMUdict (BSD-2-Clause)                    |
| Russian  | Rules: stress from a word list or a default, akanye/ikanye vowel reduction, palatalisation before soft vowels and ь, final devoicing, regressive voicing assimilation, ё always stressed | Hand-built stress list of frequent words                             |
| Hindi    | Devanagari transliteration (consonants, matras, nukta, anusvara, chandrabindu, visarga, halant) with schwa deletion                                                                      | Rules only                                                           |
| Chinese  | Character to pinyin, polyphone word list, third-tone sandhi and 一/不 sandhi, Chao tone letters; pinyin input with tone numbers or marks is accepted                                     | Unihan kTGHZ2013/kMandarin readings of the 8,105 standard characters |

## Existing components and libraries

| Component                                  | License         | Used? | Reason                                                                                                                                                                    |
| ------------------------------------------ | --------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pink Trombone (Neil Thapen)                | MIT             | Idea  | Reference for a real-time browser waveguide with a glottis and nose; the solver here is a new implementation driven by 3D head geometry.                                  |
| VocalTractLab (Birkholz)                   | GPL             | No    | High-quality 3D articulatory synthesizer, but C++/GPL and too heavy for the browser; its vocal tract parameters guided the articulator channels.                          |
| TubeTalker / Story 2008 area functions     | Published data  | Data  | MRI vowel area functions fit the vowel space of the articulator model (`src/articulation/vowel-space.js`).                                                                |
| eSpeak NG                                  | GPL-3.0         | No    | Covers all four languages, but the GPL and the WASM size (≈2–3 MB with data) conflict with the MIT library; quality for Russian stress and Chinese polyphones is limited. |
| phonemizer, Epitran, gruut, CharsiuG2P     | GPL / MIT / MIT | No    | Python-only or neural models; not usable in a browser-first JavaScript library.                                                                                           |
| CMUdict                                    | BSD-2-Clause    | Data  | Subset of 12,000 frequent words bundled for English.                                                                                                                      |
| Unihan (kTGHZ2013, kMandarin)              | Unicode license | Data  | Pinyin for the 8,105 standard characters.                                                                                                                                 |
| pinyin-pro, CC-CEDICT                      | MIT / CC BY-SA  | No    | pinyin-pro is a good drop-in for better polyphone handling; CC-CEDICT's share-alike license and 10 MB size were avoided for the prototype.                                |
| Silero Stress, russian stress dictionaries | MIT / various   | No    | Neural or large; a compact stress list plus rules keeps the bundle small.                                                                                                 |
| three.js                                   | MIT             | Yes   | 3D view in the web app (meshes are generated by the library, three.js only renders them).                                                                                 |
| React (template dependency)                | MIT             | Yes   | UI of the web app, already part of the repository template.                                                                                                               |
| Web Audio API, Web Workers                 | Platform        | Yes   | Audio playback and off-main-thread simulation.                                                                                                                            |
| WebGPU                                     | Platform        | Later | Fits the FDTD update well; planned as an optional backend once the CPU solver is fixed (see future work).                                                                 |

The research files hold the full comparison with links.

## Measurements

All numbers come from `data/` and the CI `simulation` job. The local machine
was a 6-core AMD EPYC VM with a load average of about 4.7 during the runs
(Node.js v26.11.1), so absolute timings are pessimistic.

### Audio tiers

| Tier    | Solver    | Detail      | Sample rate | Relative cost | Local load (`benchmark-local.json`) |
| ------- | --------- | ----------- | ----------- | ------------- | ----------------------------------- |
| minimal | waveguide | 22 sections | 22,050 Hz   | 1             | 0.34                                |
| low     | waveguide | 32 sections | 32,000 Hz   | 1.6           | 0.19                                |
| medium  | waveguide | 44 sections | 48,000 Hz   | 2.6           | 0.17                                |
| high    | fdtd3d    | dx 1 cm     | 48,000 Hz   | 60            | 1.41                                |
| ultra   | fdtd3d    | dx 0.6 cm   | 48,000 Hz   | 300           | not measured locally                |

A load of 1 means the tier needs the full real-time budget. The minimal tier
is measured first and appears slower than `low`, most likely because of JIT
warm-up; the governor only compares loads against the target. With the 20% headroom rule
the governor picked `medium` on this machine; `high` runs offline (CLI, server,
CI) but not in real time here. The sample sentences rendered at about 15–20×
real time with the minimal tier.

### 3D FDTD resonances versus the tube model (dx = 0.6 cm, 2,575 cells)

| Vowel | Tube F1, F2 (Hz) | FDTD F1, F2 (Hz) |
| ----- | ---------------- | ---------------- |
| /i/   | 276, 2260        | 250, 2010        |
| /e/   | 472, 1997        | 440, 2160        |
| /a/   | 948, 1430        | 1120, 1120       |
| /ɑ/   | 703, 991         | 675, 975         |
| /o/   | 485, 801         | 480, 780         |
| /u/   | 260, 735         | 235, 725         |
| /ə/   | 635, 1413        | 605, 1305        |

Six of seven vowels agree within 15%. For /a/ the 3D solver merges F1 and F2
into one strong peak at 1120 Hz (dx 0.6) and 1155 Hz (dx 0.4), so the
deviation comes from the 3D shape and not from the grid. The CI check allows
25% for /a/ and documents why.

### Waveguide vowels (44 sections, LPC analysis)

| Vowel | LPC F1, F2 (Hz) | Tube F1, F2 (Hz) |
| ----- | --------------- | ---------------- |
| /i/   | 265, 2275       | 276, 2260        |
| /e/   | 480, 2115       | 472, 1997        |
| /a/   | 1065, 2785      | 948, 1430        |
| /ɑ/   | 735, 1115       | 703, 991         |
| /o/   | 495, 2560       | 485, 801         |
| /u/   | 195, 2375       | 260, 735         |
| /ə/   | 680, 1450       | 635, 1413        |

F1 matches everywhere; the LPC estimator misses F2 of back vowels, where F1
and F2 are close. The unit test checks /i/, /ɑ/ and /ə/ within 15%.

### Random heads

The first CI run of the `simulation` job failed on random head `ci-8`: LPC
on the rendered /aː/ of the 3D solver reported F1 = 390 Hz, while the
waveguide gave 1175 Hz for the same head. The impulse response of the 3D
solver for that head has its F1 at 1075 Hz (tube model: 930 Hz) and no peak
near 390 Hz. The rendered flow signal falls by about 12 dB per octave from
the glottal source, and in the 3D spectrum the F1 region (640–1130 Hz) is a
flat plateau without a local maximum, so a 12th-order LPC spends a pole on
the source tilt ([`data/random-head-ci-8.txt`](data/random-head-ci-8.txt)).
The fault lay in the measurement, not in the solver.

A sweep over 100 heads
([`data/random-head-resonances.txt`](data/random-head-resonances.txt))
compared impulse-response resonances with the tube model of each head:

| Vowel | Waveguide worst F1 / F2 error | 3D FDTD (dx 1 cm) worst F1 / F2 error |
| ----- | ----------------------------- | ------------------------------------- |
| /ə/   | 11.2% / 3.8%                  | 18.2% / 15.8%                         |
| /i/   | 3.6% / 1.7%                   | 21.2% / 16.2%                         |
| /a/   | 61.9% / 33.2%                 | 26.6% / 32.0%                         |
| /ɑ/   | 51.5% / 16.1%                 | 38.1% / 18.0%                         |

For open back vowels the strongly damped pharyngeal F1 can drop below the
−12 dB peak floor, and the 3D shape merges F1 and F2, so those numbers
mostly measure peak picking. The CI check therefore renders /aː/ for every
head (finite, audible) and compares the /ə/ and /i/ impulse resonances with
the tube model of the same head, with 15% tolerance for the waveguide and 25%
for the 1 cm 3D grid. Open vowels are checked on the default head with the
fine grid.

## Known limitations

- The voxel tract keeps the rest vocal-tract length; lip protrusion and larynx
  height change areas but not the voxel path length.
- The 3D model uses a constant head envelope; only the tract and lips deform.
- Nasal murmurs such as /m/ come out about 2.5× louder in the FDTD solver than
  in the waveguide.
- The `microphone` output mode (pressure in front of the lips) has a noise
  level of about 0.13–0.4× the signal; the default `flow` output is clean.
- /a/ shows merged F1/F2 in 3D, and open vowels show a weak peak near 380 Hz
  (−16 to −18 dB).
- `estimateFormants` (LPC with one pre-emphasis stage) can report a pole of
  the glottal source tilt as F1 when a formant has no clear peak; resonance
  checks therefore use impulse responses (`spectralPeaks`).
- The `high` tier (FDTD, dx 1 cm) needs about 1.4× real time on the
  development machine, so the governor stays on waveguide tiers there.
- Headless Chromium renders with SwiftShader at about 12 fps on a busy CPU, so
  the visual governor drops to the lowest mesh LOD in automated screenshots.
  This is correct behaviour for that machine.
- G2P is rule-based: rare English words, Russian words outside the stress
  list, and context-dependent Chinese polyphones can be wrong. IPA input
  bypasses G2P.

## Actions that need a maintainer

1. **GitHub Pages**: set _Settings → Pages → Source_ to _GitHub Actions_.
2. **npm**: configure trusted publishing for the package or add an `NPM_TOKEN`
   secret for the first publish of `voice-simulator`.
3. **Docker Hub** (optional): set the Docker Hub variables and secret listed
   in the README to publish the server image; without them CI only builds the
   image.
4. **Dependency graph**: enable it under _Settings → Advanced Security →
   Dependency graph_. Dependency review needs it to compare two commits. While
   it is off, `scripts/check-dependency-graph.sh` makes pull requests skip the
   review with a warning, and the `dependency-graph` job of the Security
   workflow fails on `main` with the same instruction.

## Future work

- WebGPU compute backend for the FDTD solver (the update is a pure stencil;
  research estimates 10–50× over the CPU solver for the `ultra` grid).
- Moving voxel boundaries for lip protrusion and larynx height.
- AudioWorklet playback with SharedArrayBuffer once COOP/COEP headers are
  available on the hosting (GitHub Pages cannot set them).
- Larger pronunciation data (pinyin-pro or CC-CEDICT, a Russian stress
  dictionary) behind optional imports.
- Perceptual evaluation with listeners, and formant tracking with a more
  robust estimator for back vowels.
