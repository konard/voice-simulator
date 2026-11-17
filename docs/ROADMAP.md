# Roadmap

This is the step-by-step plan that takes voice-simulator from what it is today
to the [vision](VISION.md): a physical model of the human voice that speaks and
listens, without neural networks, in the public domain.

Every step is a GitHub issue. Every issue is marked as a **Bug** or a
**Feature**, belongs to one milestone, and names the issues that block it. The
issues were planned in
[issue 11](https://github.com/konard/voice-simulator/issues/11); the analysis
behind them is the
[issue 11 case study](case-studies/issue-11/README.md).

## How to use the roadmap

1. Pick an open issue from the tables below whose "Blocked by" issues are all
   closed. Inside a milestone, take bugs before features.
2. Read the issue from top to bottom. Each one has the same sections: Goal,
   Why, Current state, What to do, Tests, Acceptance criteria, Out of scope and
   References. The issue names the files, the functions and the numbers, so no
   other document is needed to start.
3. Follow the [rules](#rules-for-every-roadmap-issue). Deliver one pull request
   per issue.
4. The issue is done when every box under "Acceptance criteria" is ticked and
   the checks pass. If a number in an acceptance criterion cannot be reached,
   do not lower it silently: report the measured value in the pull request and
   ask in the issue.

GitHub shows the same dependencies in the "Blocked by" and "Blocking" fields of
every issue, and the milestones show the progress of each stage.

## Stages

The milestones are stages of one plan. Later stages depend on earlier ones only
through the blockers listed per issue, so several stages can move at once.

| Stage                                         | What it delivers                                                                                                                                                          | Why it is at this place                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Foundations and measurement                | The manually triggered workflow for expensive checks, the policy check (no neural networks, permissive licences), public recordings, metrics and the first quality report | Nothing can be called better before it is measured, and the rules of the vision have to be enforced by a machine                                   |
| 1. Rust engine and adaptive quality           | The Rust core as WebAssembly in a background worker as the default engine, multicore with a single-core fallback, narrow-band tiers, quality that follows the device      | Performance is what keeps most devices away from the accurate tiers today                                                                          |
| 2. Voice physics and configuration            | Simulated vocal folds, source-tract coupling, physical noise, losses, articulator dynamics, durations and many more voice parameters                                      | Listening studies place the remaining gap to natural speech in the source, the noise and the movements, not in the detail of the tract (see below) |
| 3. Languages and modes of speech              | Fixes of wrong tones, stress and readings; lexicons; tone and intonation models; markup; loudness, whisper, voice qualities, emotions, accents                            | Every mode has to be spoken before it can be recognised                                                                                            |
| 4. Reverse simulation (listening)             | Audio → IPA → language → text by inverting the simulator, with syllable highlighting, in the library, the command line, the server and the app                            | Needs the metrics and recordings of stage 0, and the voice parameters of stage 2 to fit a speaker                                                  |
| 5. Voice copy and state-of-the-art validation | The multi-pass session that copies a voice while it recognises it, certification at the lowest settings, and the public evaluation against real speech                    | The last stage: it joins both directions and reports honestly where the system stands                                                              |

### What decides the order of quality work

Listening studies with a physical synthesiser decide it. Birkholz and Drechsel
(2021) added three anatomical details to the tract (piriform fossae, coupling
through the velum, sound radiated by the neck); listeners did not rate the
result as more natural, and the authors conclude that the voice source matters
more. Blandin, Didone and Birkholz (2024) compared 1D and 3D acoustics for seven
sounds and found no significant effect on rated naturalness. An earlier study
of the same group (Blandin and others 2023) did find that listeners prefer 3D
for the vowels /o/ and /u/, so 3D stays the reference tier, but it is not
where most of the gap to natural speech is.

The roadmap therefore improves, in this order: the vocal folds and their
coupling to the tract, turbulence and plosive bursts, articulator dynamics and
durations, then the losses in the 1D solver, and only then finer grids. Details
and sources are in
[the performance and physics research](case-studies/issue-11/research/5-performance-and-physics.md).

<!-- roadmap:begin -->

### Roadmap 0: Foundations and measurement

Clean up, policy checks, manually triggered heavy checks, public datasets, objective metrics and listening tests. Everything later is measured with these.

The first measurement of [#19](https://github.com/konard/voice-simulator/issues/19) is [reports/baseline-quality.md](reports/baseline-quality.md) (`scripts/quality-report.mjs`, suite `quality` of the heavy checks). An issue that claims an improvement runs the script with `--baseline docs/reports/baseline-quality.json` and puts the table into its pull request; the baseline files stay unchanged until [#83](https://github.com/konard/voice-simulator/issues/83).

| Issue                                                      | Type    | Title                                                                 | Blocked by                                                                                                                                                                         | Requirements |
| ---------------------------------------------------------- | ------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| [#13](https://github.com/konard/voice-simulator/issues/13) | Bug     | Template case studies occupy `docs/case-studies/issue-N` folders      | nothing                                                                                                                                                                            | R16, R21     |
| [#14](https://github.com/konard/voice-simulator/issues/14) | Feature | Manually triggered workflow for expensive checks                      | nothing                                                                                                                                                                            | R11          |
| [#15](https://github.com/konard/voice-simulator/issues/15) | Feature | Policy check: no neural networks, permissive licences only            | nothing                                                                                                                                                                            | R18, R19     |
| [#16](https://github.com/konard/voice-simulator/issues/16) | Feature | Speech dataset registry and fetcher with checksums and a licence gate | [#14](https://github.com/konard/voice-simulator/issues/14), [#15](https://github.com/konard/voice-simulator/issues/15)                                                             | R8, R18      |
| [#17](https://github.com/konard/voice-simulator/issues/17) | Feature | Golden set of public-domain recordings with transcripts and IPA       | [#16](https://github.com/konard/voice-simulator/issues/16)                                                                                                                         | R8, R13      |
| [#18](https://github.com/konard/voice-simulator/issues/18) | Feature | Objective speech metrics and a `compare` command                      | nothing                                                                                                                                                                            | R1, R8, R18  |
| [#19](https://github.com/konard/voice-simulator/issues/19) | Feature | Baseline quality report against real recordings                       | [#14](https://github.com/konard/voice-simulator/issues/14), [#17](https://github.com/konard/voice-simulator/issues/17), [#18](https://github.com/konard/voice-simulator/issues/18) | R1, R8, R11  |
| [#20](https://github.com/konard/voice-simulator/issues/20) | Feature | Listening-test harness: MUSHRA, ABX and intelligibility               | nothing                                                                                                                                                                            | R1, R19      |

### Roadmap 1: Rust engine and adaptive quality

Simulation core in Rust (WebAssembly and native), multicore with a single-core fallback, load-time benchmark, lowest-settings tiers and quality that adapts while streaming.

The workspace, the WebAssembly build, the loader, the CI job `rust` and the parity tests of [#21](https://github.com/konard/voice-simulator/issues/21) are described in [RUST-ENGINE.md](RUST-ENGINE.md); the ports below add their code to that pipeline.

The tiers `telephone` (8 kHz), `narrowband` (11.025 kHz) and `wideband` (16 kHz) of [#26](https://github.com/konard/voice-simulator/issues/26) are in `AUDIO_TIERS` below `minimal`, which stays the start level of automatic quality (`BASE_AUDIO_LEVEL`); the README section "Quality tiers" lists them and `experiments/issue-26-narrow-band.txt` holds their formant, aliasing and band-limit measurements.

The waveguide renderer of [#22](https://github.com/konard/voice-simulator/issues/22) runs in the Rust engine: `RustVoiceRenderer` and `renderPlanRust` (the default engine since [#25](https://github.com/konard/voice-simulator/issues/25)) give the same samples as `VoiceRenderer` (largest difference 1.7e-18) on every waveguide tier, including the `blockSize` and `bandLimit` of the narrow-band tiers, and `voice-simulator-cli render-job` renders the same jobs natively with the same SHA-256. The suite `performance` of the heavy checks measures it: [reports/performance-rust-waveguide.md](reports/performance-rust-waveguide.md) (1.5 to 2.0 times faster than JavaScript; 22 % to 51 % of the Rust render is the frame preparation in JavaScript, which [#82](https://github.com/konard/voice-simulator/issues/82) decides about). Layouts, deviations and measurements are in [RUST-ENGINE.md](RUST-ENGINE.md#waveguide-renderer-issue-22).

The 3D FDTD solver of [#23](https://github.com/konard/voice-simulator/issues/23) runs in the Rust engine too: `RustVoiceRenderer` and `renderPlanRust` take `solver: 'fdtd3d'` (the tiers `high` and above) with the voxel model built in JavaScript and handed over packed once, and give the same samples as `VoiceRenderer` (largest difference 0 on `'Hello.'` at `high`, 1.1e-19 with `teeth: false`); `voice-simulator-cli render-job` of a `high` job prints the same SHA-256 as the WebAssembly render. [reports/performance-rust-fdtd.md](reports/performance-rust-fdtd.md) measures the scalar build 1.43, 1.11 and 1.12 times faster than JavaScript on `high`, `ultra` and `studio`. The WebAssembly SIMD build is 1.06 times faster than the scalar one on `high`, below the 1.15 the issue requires, so it is built and tested but not shipped. Deviations and measurements are in [RUST-ENGINE.md](RUST-ENGINE.md#3d-fdtd-solver-issue-23).

The engine choice of [#25](https://github.com/konard/voice-simulator/issues/25) makes the Rust engine the default: `createEngine` and `getEngine` give an engine object (`engine: 'auto' | 'rust' | 'js'`, `threads`, `simd`) that `synthesize`, `renderPlan`, the benchmark, the CLI (`--engine`, `--threads`), the HTTP server and the worker use; `'auto'` falls back to JavaScript, with the reason, where the wasm does not load or a render needs what only JavaScript has (another solver, WebGPU, the vocal folds). The synthesis worker is the export `voice-simulator/worker`, and the example app's settings panel shows and chooses the engine. `'js'` keeps byte-stable output. The design and the worker messages are in [RUST-ENGINE.md](RUST-ENGINE.md#choosing-an-engine-issue-25).

The silent benchmark of [#28](https://github.com/konard/voice-simulator/issues/28) sets the app's precision without a note or a pause: `benchmarkDevice` (in `src/perf/device-benchmark.js`) walks the tiers like `chooseTier` within 1 s of CPU time in 20 ms slices, predicts the tiers it does not run from the cost ratio and chooses them only below 0.7 × the target. The worker runs it at the first idle moment of a visible page, stops it while speech waits or renders and resumes it 500 ms later, and answers the WebGPU tiers in a second message. The app starts at `startLevel` (`narrowband` with at most 2 cores or 2 GB, else `minimal`), caps Auto at `medium` on a low battery, caches the result for 30 days per `BENCHMARK_VERSION`, device and engine, measures again after three overloads in a row or on "Measure again", and keeps a chosen tier by name. `voice-simulator benchmark --quick` runs the same benchmark: on the development machine `node bin/voice-simulator.js benchmark --quick --json` spent 0.95 to 1.02 s of CPU with the Rust engine and 0.46 s with `--engine js`. A 3D tier's renderer setup (0.25 to 0.6 s for `high`) is one slice, longer than 20 ms; it runs in the worker, so the page's main thread stays free.

The 3D solver of [#24](https://github.com/konard/voice-simulator/issues/24) runs on several threads with a single-core fallback: `voice-simulator-cli render-job --threads <n|auto>` natively, and `createEngine({ threads })` and `loadEngineModule(undefined, { threads })` with the threads build `voice-simulator-threads.wasm` (a pinned nightly compiler, shared memory, a pool of workers) where the page is cross-origin isolated; one thread elsewhere and by default. Renders on 2 and 4 threads are the same bits as on one. The heavy test `performance-threads` ([reports/performance-threads.md](reports/performance-threads.md)) found no grid where 2 threads were 1.3 times faster than one (at best 1.16×, on a fully loaded machine), so `THREAD_MIN_LINKS` is `usize::MAX` and the code is kept: `threadMinLinks` and `--thread-min-links` start a team on request. The app can load `coi-serviceworker` behind `VITE_CROSS_ORIGIN_ISOLATION=1` for hosts such as GitHub Pages; the published app is built without it and stays on one thread, since no measured grid pays for threads. Design, deviations and measurements are in [RUST-ENGINE.md](RUST-ENGINE.md#3d-solver-on-several-threads-issue-24).

The WebGPU solver of [#30](https://github.com/konard/voice-simulator/issues/30) is compared with the CPU kernel in suite `gpu` of the heavy checks, on Linux through Mesa's software adapter: [reports/gpu-solver.md](reports/gpu-solver.md). The Deno jobs on macOS and Windows set `REQUIRE_GPU=1`, so a runner image without an adapter fails instead of skipping the GPU tests.

The AudioWorklet player of [#27](https://github.com/konard/voice-simulator/issues/27) is the export `voice-simulator/playback` (processor, ring buffer) with the stream resampler `createStreamResampler`; its latency and underrun measurements are in `experiments/issue-27-latency.txt`, and the resampler is ported to the Rust core with class B parity tests.

The change of quality in the middle of an utterance of [#29](https://github.com/konard/voice-simulator/issues/29) is `AdaptiveStream` (a second renderer of the new tier started at the switch time with the voice source state handed over, resampled to one stream rate and crossfaded with a matched level) and `StreamGovernor` (down within 0.1 s or at once on an underrun, up after 3 s, never back to a tier it left); the worker reports each switch with a `tier` message instead of restarting the utterance, and its level measurements are in `experiments/issue-29-switch-levels.txt`.

The performance tracking of [#31](https://github.com/konard/voice-simulator/issues/31) times every tier except `reference` on the JavaScript and the Rust engine in suite `performance` of the heavy checks, and compares the run with [reports/performance-baseline.json](reports/performance-baseline.json) through `scripts/performance.mjs`: a tier more than 2.0 times slower than its baseline (scaled by a calibration loop), a Rust tier more than 1.1 times slower than JavaScript, or a waveguide tier above half of real time fails the run. The trend of every measured commit is [reports/performance.md](reports/performance.md); `tests/performance-smoke.test.js` checks the cheapest tiers on every runtime in `npm test`. Five runs on one commit landed on four CPU models, and the worst spread of RTF / calibration was 1.64, hence the tolerance of 2.0. On the median run the waveguide tiers take 0.017 (`telephone`) to 0.06 (`medium`) of real time in JavaScript and Rust is 1.4 to 1.5 times faster; on the 3D tiers the two engines are within 3 % of each other (Rust 2 % to 3 % slower at `ultra` and `studio` on the AMD runners, 3 % to 5 % faster on the Intel ones).

| Issue                                                      | Type    | Title                                                                         | Blocked by                                                                                                             | Requirements  |
| ---------------------------------------------------------- | ------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------- |
| [#21](https://github.com/konard/voice-simulator/issues/21) | Feature | Rust workspace and WebAssembly build pipeline                                 | nothing                                                                                                                | R2, R12, R19  |
| [#22](https://github.com/konard/voice-simulator/issues/22) | Feature | Port the waveguide, the glottal source and the voice renderer to Rust         | [#21](https://github.com/konard/voice-simulator/issues/21), [#14](https://github.com/konard/voice-simulator/issues/14) | R2, R12, R13  |
| [#23](https://github.com/konard/voice-simulator/issues/23) | Feature | Port the 3D FDTD solver to Rust with WebAssembly SIMD                         | [#21](https://github.com/konard/voice-simulator/issues/21), [#22](https://github.com/konard/voice-simulator/issues/22) | R1, R2, R12   |
| [#24](https://github.com/konard/voice-simulator/issues/24) | Feature | Multicore 3D solver with a single-core fallback                               | [#23](https://github.com/konard/voice-simulator/issues/23)                                                             | R12           |
| [#25](https://github.com/konard/voice-simulator/issues/25) | Feature | Rust engine in a background worker as the default, JavaScript as the fallback | [#22](https://github.com/konard/voice-simulator/issues/22), [#23](https://github.com/konard/voice-simulator/issues/23) | R2, R12, R13  |
| [#26](https://github.com/konard/voice-simulator/issues/26) | Feature | Narrow-band tiers: 8, 11.025 and 16 kHz                                       | nothing                                                                                                                | R13, R3       |
| [#27](https://github.com/konard/voice-simulator/issues/27) | Feature | AudioWorklet playback with a ring buffer                                      | nothing                                                                                                                | R3, R13       |
| [#28](https://github.com/konard/voice-simulator/issues/28) | Feature | Silent load-time device benchmark that sets the precision                     | [#25](https://github.com/konard/voice-simulator/issues/25), [#26](https://github.com/konard/voice-simulator/issues/26) | R4, R3, R13   |
| [#29](https://github.com/konard/voice-simulator/issues/29) | Feature | Change quality in the middle of an utterance while streaming                  | [#25](https://github.com/konard/voice-simulator/issues/25), [#27](https://github.com/konard/voice-simulator/issues/27) | R3, R1        |
| [#30](https://github.com/konard/voice-simulator/issues/30) | Feature | Run the WebGPU solver in CI                                                   | [#14](https://github.com/konard/voice-simulator/issues/14)                                                             | R11, R1       |
| [#31](https://github.com/konard/voice-simulator/issues/31) | Feature | Performance tracking: real-time factor per tier in CI                         | [#14](https://github.com/konard/voice-simulator/issues/14), [#25](https://github.com/konard/voice-simulator/issues/25) | R11, R12, R13 |

### Roadmap 2: Voice physics and configuration

Physical vocal folds and lungs, noise sources, losses, articulation dynamics, durations and a much larger voice configuration.

The 2D solver of [#37](https://github.com/konard/voice-simulator/issues/37) (`fdtd2d`: `sheet-model.js`, `fdtd2d.js`, the nose and the pouches as 1D lines in `nose-line.js`) is registered and has its own vowel table (`VOWEL_CORRECTIONS_2D`), but no tier uses it: in `experiments/issue-11-fdtd2d-compare.txt` its mean log-spectral distance to `fdtd3d` at 4 to 8 kHz is 13.22 dB against 10.20 dB for the waveguide, although it renders in 0.43 times the time of `high`. Most of the difference comes from the 1D vallecula, whose dip near 5 kHz the 3D voxel pouch hardly shows (`experiments/issue-37-vallecula-zero.mjs`).

The two-mass vocal folds of [#33](https://github.com/konard/voice-simulator/issues/33) are the voice source `source: 'folds'` (`src/acoustics/folds.js`), driven by the plan channels `lungPressure`, `adduction` and `foldTension`; LF stays the default. The measurements are in [experiments/issue-11-folds.txt](../experiments/issue-11-folds.txt) and the section [Voice source](../README.md#voice-source) of the README. The later issues of this roadmap build on these channels and on `VocalFolds`.

The source-tract interaction of [#34](https://github.com/konard/voice-simulator/issues/34) is the option `interaction: true` (CLI `--interaction`, folds only): the glottal flow follows `interactiveFlow()` of Titze (2008) from the pressures above the glottis (`glottalLoad()` of the waveguide, the 2D sheet and the 3D grid) and below it (`Subglottal` in `src/acoustics/subglottal.js`, the windpipe with resonances at 626, 1485 and 2299 Hz). The checklist for flipping the defaults is in the section [Source-tract interaction](../README.md#source-tract-interaction) of the README: the ripple test holds only against the F1 of the open glottis (44 % above the closed-tract F1) and the child preset does not voice with the folds, so `DEFAULT_SOURCE` stays `'lf'` and `DEFAULT_INTERACTION` stays `false`. The Rust port is [#82](https://github.com/konard/voice-simulator/issues/82).

The turbulence noise of [#35](https://github.com/konard/voice-simulator/issues/35) comes from the air flow (`src/acoustics/aerodynamics.js`): the head parameter `lungPressure` drives the flow through the glottis and the constriction, the noise strength follows dp^1.5 A^0.5 above a critical Reynolds number, the frication band follows the Strouhal frequency and the flow derivative at a release adds the burst transient. The measurements are in `experiments/issue-11-turbulence.txt`; the Rust port of the source strengths and the mouth pressure is in [RUST-ENGINE.md](RUST-ENGINE.md). With `source: 'folds'` the glottal area of the aerodynamics is the mean area of the vocal folds (three one-pole stages of 5 ms, which keep the cycles of the folds out of the burst transient).

The articulator dynamics of [#38](https://github.com/konard/voice-simulator/issues/38) replace the zero-phase smoothing of the articulation channels: every channel is a list of targets (`channelTargets()`) that a critically damped system approaches forwards in time (`approachTargets()` in `src/articulation/dynamics.js`), with a time constant and a lead per channel in `ARTICULATORS`, early lip rounding and velum opening (`ROUNDING_LEAD`, `VELUM_LEAD`) and a coarticulation resistance per consonant (`COARTICULATION_RESISTANCE`). The fit to the golden set in [experiments/issue-11-fit-dynamics.txt](../experiments/issue-11-fit-dynamics.txt) lowered the held-out formant error by only 3.1 %, below the 5 % the issue asks for, so the starting values are kept; `experiments/issue-11-align.mjs` (`alignToRecording()`) and the `durations` option of `planUtterance()` are ready for the durations of [#39](https://github.com/konard/voice-simulator/issues/39).

The segment durations of [#39](https://github.com/konard/voice-simulator/issues/39) come from the rules of Klatt (1979) in `src/articulation/durations.js`: an inherent and a minimum duration per sound class in `DURATION_TABLES` (`en`, `ru`, `hi`, `zh`, `default`), the percentages of `DURATION_RULES` and the speech-rate exponents `RATE_MINIMUM`, `RATE_STRETCH` and `RATE_PAUSE`. The fit to the golden set in [experiments/issue-11-fit-durations.txt](../experiments/issue-11-fit-durations.txt) lowers the error per sound by 39 % for Hindi, but only by 0.9 % for English and 8.8 % for Russian, short of the 20 % the issue asks for: the alignment of `alignToRecording()` pulls the measured durations towards the plan that was rendered, so the fit compares against the median of three alignments, and on that reference neither the start values nor a refit move far from today's error. Mandarin has 173 aligned sounds, below the 200 of the criterion. The audit sentence is 3.723 s long (3.980 s before), and `matchVoice()` uses the speech-rate slopes measured under the new rules (`experiments/issue-39-rate-slopes.txt`).

The free articulators of [#40](https://github.com/konard/voice-simulator/issues/40) are four more channels of the plan: `jaw` (gap between the incisors), `lipProtrusion`, `larynxHeight` and `tongueRoot`, with the speaker habits `jawPosture`, `lipPosture`, `larynxPosture` and `tongueRootPosture` and the couplings `intrinsicPitch` and `larynxPitch` (off by default). At the values the planner writes they give the shape of the vowel and consonant channels; moved, they widen the mouth (`JAW_AREA` = 0.8 per cm, 9 % more F1 of `[ɛ]` for 0.5 cm; time constant 0.02 s, so that a short `[z]` still reaches its gap), lengthen the lips or the pharynx (`stretchSections()`, the velum, the teeth and the noise source keep their distance from the lips) and scale the pharynx ([experiments/issue-40-articulators.txt](../experiments/issue-40-articulators.txt)). In the 3D solver the voxel tract goes on below the glottis by `LARYNX_TRAVEL` = 0.25 of its length and the source plane moves in whole cells with the tract length, so the time step stretches by at most half a cell: `[u]` and `[æ]` differ by 3.6 % in step, 10.8 % before ([experiments/issue-40-fdtd3d.txt](../experiments/issue-40-fdtd3d.txt)). The ratio of nasal to vowel of `[ˈama]` becomes 0.99 and 1.08 at 1 and 0.6 cm cells, against 0.87 and 1.19 before, closer to the 1.09 of the waveguide ([experiments/issue-40-ama-3d.txt](../experiments/issue-40-ama-3d.txt)). `matchVoice` reads the tract length from F1 to F3, which rises with the length where the reading with F4 reverses ([experiments/issue-40-length-feature.txt](../experiments/issue-40-length-feature.txt)). The nose line and the side branches of the 1D solvers still get longer with the tract.

The voice configuration of [#41](https://github.com/konard/voice-simulator/issues/41) is one flat head of 137 values in six groups (`HEAD_GROUPS`: `anatomy` 28, `folds` 14, `breathing` 13, `articulation` 67, `expression` 7, `microphone` 8; the tables are in `src/parameters/`). Every entry has a unit, a range, a default, a source and an `effect`: the measure of `ˈmama ˈsasa` (or a named utterance, tier, options or head) that rises or falls from its minimum to its maximum. `tests/head-parameters.test.js` renders all 137 effects in 29 s on Node.js ([experiments/issue-41-effects.txt](../experiments/issue-41-effects.txt)); [docs/VOICE-PARAMETERS.md](VOICE-PARAMETERS.md) and `schemas/voice.schema.json` are generated from the tables by `node scripts/voice-parameters.mjs`. Four values keep sign 0 because the model does not use them yet: `speedLarynxHeight` and `speedTongueRoot` (no sound sets a target of these channels; the postures are added after the smoothing), `durationEmphasis` (no input marks a token as emphasised) and `durationTone1` (the factor of the first tone is 1). Voice files (`loadVoice`, `saveVoice`, CLI `--voice`, `head --voice-file` and `voice check`) write one object per group and only the values that differ from their preset; the presets add `child5`, the teenagers, the elderly and six singing voices (`bass` renders "Hello." at 98 Hz by `voice-simulator match`). The app editor shows the groups as sections with the basic values, "Show all parameters", "Import voice" and "Export voice".

| Issue                                                      | Type    | Title                                                                    | Blocked by                                                                                                                                                                         | Requirements     |
| ---------------------------------------------------------- | ------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [#32](https://github.com/konard/voice-simulator/issues/32) | Bug     | `breathiness` hardly changes the measured noise level                    | nothing                                                                                                                                                                            | R5, R9, R18      |
| [#33](https://github.com/konard/voice-simulator/issues/33) | Feature | Physical vocal-fold model driven by lung pressure                        | nothing                                                                                                                                                                            | R1, R5, R9, R18  |
| [#34](https://github.com/konard/voice-simulator/issues/34) | Feature | Source-tract interaction and the subglottal tract                        | [#33](https://github.com/konard/voice-simulator/issues/33)                                                                                                                         | R1, R5, R9, R18  |
| [#35](https://github.com/konard/voice-simulator/issues/35) | Feature | Physically based turbulence noise: frication, aspiration and bursts      | nothing                                                                                                                                                                            | R1, R5, R9, R18  |
| [#36](https://github.com/konard/voice-simulator/issues/36) | Feature | Frequency-dependent losses in the 1D solver                              | nothing                                                                                                                                                                            | R1, R5, R9, R18  |
| [#37](https://github.com/konard/voice-simulator/issues/37) | Feature | 2D acoustic tier between the waveguide and 3D                            | nothing                                                                                                                                                                            | R1, R3, R12, R18 |
| [#38](https://github.com/konard/voice-simulator/issues/38) | Feature | Articulator dynamics and coarticulation calibrated on real data          | [#18](https://github.com/konard/voice-simulator/issues/18), [#17](https://github.com/konard/voice-simulator/issues/17)                                                             | R1, R9, R17, R18 |
| [#39](https://github.com/konard/voice-simulator/issues/39) | Feature | Rule-based segment duration model per language                           | [#17](https://github.com/konard/voice-simulator/issues/17), [#18](https://github.com/konard/voice-simulator/issues/18)                                                             | R1, R9, R17, R18 |
| [#40](https://github.com/konard/voice-simulator/issues/40) | Feature | Explicit jaw, larynx height and lip protrusion articulators              | nothing                                                                                                                                                                            | R1, R5, R17, R18 |
| [#41](https://github.com/konard/voice-simulator/issues/41) | Feature | Expanded voice configuration: voice files, groups, presets and an editor | [#33](https://github.com/konard/voice-simulator/issues/33), [#35](https://github.com/konard/voice-simulator/issues/35), [#36](https://github.com/konard/voice-simulator/issues/36) | R5, R9, R17, R18 |
| [#84](https://github.com/konard/voice-simulator/issues/84) | Bug     | Nasal consonants are about four times louder in the 3D solver            | nothing                                                                                                                                                                            | R1, R18          |

### Roadmap 3: Languages and modes of speech

Pronunciation bugs, lexicons, tones, intonation, markup, loudness, whisper, voice qualities, emotions, paralinguistic sounds and accents for speaking.

The tone model of [#49](https://github.com/konard/voice-simulator/issues/49) makes every tone a pitch target, a line in semitones over the syllable, that `approachToneTargets()` approaches as a critically damped third-order system (Prom-on, Xu and Thipakorn 2009) once per tonal phrase, so each syllable starts where the one before it ended. The interval of a syllable runs from the end of the vowel before it to the end of its own vowel; `TONE_RATES` are 40 for rises and falls, 35 for low targets, 25 for level and neutral ones. `ma˥` after `ma˥˩` is 2.8 st below `ma˥` after `ma˥` at 10 % of its vowel and 0.01 st at 95 %; the largest f0 step between frames is 0.23 st in Thai `pʰaː˧ maː˥˩ kʰaː˩˩˦` ([experiments/issue-49-tone-model.txt](../experiments/issue-49-tone-model.txt)). The neutral tone takes level 2, 3, 4 or 1 after a high, rising, low or falling tone (`NEUTRAL_LEVELS`) and lasts `NEUTRAL_DURATION` = 0.6 of a full syllable: the second syllable of 妈妈 ends at 101 Hz after 127 ms, that of 爸爸 at 86 Hz ([experiments/issue-11-audit-m3a.txt](../experiments/issue-11-audit-m3a.txt)). 一 and 不 between two equal characters are neutral, 一 keeps its first tone in ordinals, numbers and fixed words, and Chinese words separated by spaces get sandhi as one run (`joinChineseRuns()`), so `我 很 好` and `wǒ hěn hǎo` read like `我很好` ([experiments/issue-11-audit-m3c.txt](../experiments/issue-11-audit-m3c.txt)). The Rust crates hold no planner, so the model is JavaScript only.

The accents of [#57](https://github.com/konard/voice-simulator/issues/57) are 25 codes ([docs/accents.md](accents.md)): the four English accents of the dictionary, regional accents of every language (`en-CA`, `ru-x-north` with okanye, `ru-x-south` with a fricative г, `hi-x-east`, `zh-TW` without erhua and with a low third tone, `zh-x-south`) and the 12 foreign accents `<target>-x-<first>` of English, Russian, Hindi and Mandarin, built from a profile of the first language (`src/accent/profiles/`). An accent is a JSON file (`voice-simulator/accent`, version 1: g2p switches, at most 500 rules of `map` or `match` + `add`/`remove` with `before`, `after`, `stress` and `min`, phonotactics, prosody and articulation; `loadAccent`), with a strength from 0 to 1 that scales the rules, factors and offsets; `explainAccent` ranks the accents that explain a heard transcription. Measured on tier medium, seed 1 (`node experiments/issue-57-acoustics.mjs`): the first consonant of `город` is 79.5 dB below the vowel in `ru-RU` and 7.7 dB in `ru-x-south`; the burst-to-voicing time of `pit` falls from 60.0 to 12.5 ms in `en-x-ru`, which devoices the final d of `bad` (voiced share 0.00, plain 0.14); the initials of `是` and `四` differ by 0.0 % in spectral centroid in `zh-TW` and by 29.1 % in `zh-CN` (5426 against 7654 Hz, after the retroflex place moved behind the postalveolar one; it was 0.4 %); the vowel nPVI of `The tiger is the biggest animal of the family.` falls from 48.1 to 20.9 in `en-x-zh`.

The pronunciation lexicons of [#47](https://github.com/konard/voice-simulator/issues/47) come only from sources whose licence is written down in `data/lexicon/sources.json` and checked by `scripts/check-policy.mjs`: 20 042 English words of CMUdict (BSD-2-Clause) with every variant, ranked by Common Voice word counts (CC0-1.0); readings of 8 105 Chinese characters from Unihan (Unicode-3.0) and 2 000 words mined from AISHELL-3 (Apache-2.0) or written by hand; 230 Hindi words that schwa deletion reads wrongly and the 304 Russian stress words, in the block-coded `vslex` container (`src/g2p/vslex.js`). English words that `src/g2p/english-morphology.js` derives from known words are read by morphology and left out of the shipped list. User lexicons (`lexicon` option, `addLexicon()`, CLI `--lexicon`) win over the shipped ones. Running words of the FLEURS English text not read by the letter rules went from 93.99 % to 98.14 %; reading errors on the held-out AISHELL-3 lines went from 3050 to 2437 (96.62 % of syllables read as written), short of the halving (1525) that #47 asks for, and the package grew by 87.8 kB instead of at most 60 kB (`npm run test:heavy -- --suite lexicon`, `node experiments/issue-47-measure.mjs`).

The Russian stress of [#48](https://github.com/konard/voice-simulator/issues/48) (`findRussianStress()` in `src/g2p/russian.js`) takes, in this order, a typed mark (`+` or U+0301), a typed `ё`, one of the 67 homograph spellings of `src/g2p/russian-homographs.js` chosen by cue words around it (Yarowsky 1997: `near`, `before`, `after`, `infinitive`, and `case` for genitive singular against nominative plural, `из города` ˈɡorədə, `большие города` ɡərɐˈda), one of 3 691 whole forms, a form with `е` read as `ё` when only that one is known (`еще` jɪˈɕːo), the longer of a stem of 6 639 with an ending (`раб+от|а`, `стол|+`) as written or with `ё`, and a guess by the word ending. The stems and forms in `data/lexicon/ru-stress.txt` are written by hand for the most frequent words of Common Voice Russian text (CC0-1.0); `ru.js` grew from 3 541 to 58 979 bytes, with the letters of the words stored as ASCII (`letters` field of `vslex`). The guess table counts endings of 2 to 6 letters shared by at least 5 lexicon words with at least 60 % agreeing on the stress (the issue asked for 2 to 4 letters, 10 words and 75 %, which gave 62.3 %; `node experiments/issue-48-guess-params.mjs`) and is right for 74.0 % of the held-out fifth. On the 222 hand-marked sentences of `tests/fixtures/russian-stress.txt` (three stories by Chekhov, public domain) the share of words with the marked stress went from 52.6 % on main to 97.9 %, of homograph words from 36.0 % to 96.0 % (`node experiments/issue-48-fixture-share.mjs`, [before](../experiments/issue-48/fixture-share-before.txt), [after](../experiments/issue-48/fixture-share-after.txt)); 108 lexicon items and 3 homographs were added after measuring the fixture, without them it is 87.6 %. The remaining misses are mostly names (Очумелов, Хрюкин) and homographs whose cue is far away (`письма`, `пасти`, `узнает`).

The speech markup of [#50](https://github.com/konard/voice-simulator/issues/50) reads an SSML subset (any text that starts with `<speak`), inline tags such as `[whisper]…[/whisper]` (with `markup: true` or `--markup`) and the ExtIPA/VoQS marks of IPA (`{W … W}`, `{f … f}`, `{allegro … allegro}`, `(.)`, `(1.2)`, `⸨laugh⸩`, `ˈˈ`). All three become mode spans with every field of `MODE_DEFAULTS` (effort, gain, rate, pitch, range, emphasis, phonation, emotion, tune, lang), and `textToIpa` writes the marks of every change that has a symbol, so a marked-up text and its IPA give the same `plan.modes` (spans in seconds, `modeAt(plan, time)`) and `plan.sounds`. Rate, pitch, range, gain and effort are heard now, timed pauses last exactly their length and sounds are made by the voice since [#56](https://github.com/konard/voice-simulator/issues/56); emphasis and tune are heard since [#51](https://github.com/konard/voice-simulator/issues/51); phonation types are heard since [#54](https://github.com/konard/voice-simulator/issues/54), whisper since [#53](https://github.com/konard/voice-simulator/issues/53) and emotion since [#55](https://github.com/konard/voice-simulator/issues/55). The SSML reader is written by hand, fetches nothing and expands no entities; DOCTYPE, CDATA, processing instructions and inputs over `MARKUP_LIMITS` (20 000 characters, depth 32, 2000 elements, breaks of 10 s) throw `MarkupError`, which the server answers with 400. Text without markup gives the same IPA and samples as before. The tables, with one example per row, are in [docs/markup.md](markup.md).

The intonation of [#51](https://github.com/konard/voice-simulator/issues/51) (`src/articulation/intonation.js`) splits every intonation phrase into pre-nucleus, nucleus and tail and puts the pitch at `register + declination + range * tune` semitones, with the targets of `TUNES` per language approached at `INTONATION_RATE` = 60: English statement, yes/no, wh, alternative, tag, echo, continuation, list and exclamation tunes; the Russian constructions IK1 to IK7 (IK3 for yes/no questions, IK2 with the centre on the wh-word, IK4 for short `а`-questions and IK5 for `какой … !`, both detected in g2p and written as `{IK4 … IK4}`); Hindi accent phrases (every word of two or more syllables before the last word, low on its first vowel and high on its last, each one 1 st lower; a sketch not yet fitted to recordings); and for Mandarin a raise that grows to +3 st over a question without a particle (+1 after 吗, none with a wh-word), so tones are never replaced. Focus (`*word*`, `<emphasis>`, `ˈˈ`, `FOCUS`) raises the nucleus by 2.9 st, lengthens it 1.2× and adds 3 dB, and compresses what follows. g2p writes `↘ ?`, `↗ ?`, `↗ |` before `or`/`или`, and a `|` break with a continuation in stretches over 14 syllables; `|` is a continuation (Russian IK3 × 0.7), and the tune names can be set by `[tune name]`, `<vs:tune name="…">` or the IPA marks, which win over the punctuation ([docs/markup.md](markup.md#intonation)). Measured with a 150 Hz head (`node experiments/issue-51-measure.mjs`, [experiments/issue-51-measure.txt](../experiments/issue-51-measure.txt), 23/23 pass): `You are coming.` falls 5.13 st, `Are you coming?` rises 7.71 st from the nucleus, `Tea or coffee?` (`ˈti ↗ | ˈɔɹ ˈkɑfi ↘ ?`) rises 5.83 st on `tea` and ends 10.99 st below it, the IK3 centre of `Это мама?` rises 8.82 st, `你来？` is 2.59 st above `你来。` on the last syllable while 去 still falls 4.46 st, and the focused `Anna` peaks 3.10 st higher. In [experiments/issue-11-audit.txt](../experiments/issue-11-audit.txt) the last f0 of `Tea or coffee?` went from 143 to 84 Hz and that of `You are coming.` from 95 to 90 Hz; in [experiments/issue-11-audit-m3b.txt](../experiments/issue-11-audit-m3b.txt) the mean of `你来？` went from 119 to 135 Hz, against 119 for `你来。`.

The vocal effort of [#52](https://github.com/konard/voice-simulator/issues/52) is more than a level: at `E = (effort - 0.5) * 40` dB the level changes by `E`, the lung pressure by `2^(E/9)`, the pitch by +5 Hz per dB (-4 … +12 st), F1 by +3.5 Hz per dB (the jaw of open vowels), the tilt above 1 kHz by `0.2 E` dB, vowels last 1.1 and 1.3 times as long at +10 and +20 dB and the noise sources change by `0.5 E` dB (`EFFORT_RULES`, `effortChanges()`). The planner fills `effort` and `tension` channels; the LF source realises level and tilt with a gain and a shelf, the fold source of [#33](https://github.com/konard/voice-simulator/issues/33) takes them from the raised lung pressure and sets its tension for the pitch less its own rise (`FOLD_PITCH_RISE`), and the Rust engine (interface version 3) does the same. Against plain speech `[soft]`, `[loud]` and `[shout]` measure -10.60, +11.25 and +21.55 dB and -4.00, +6.05 and +10.50 st (`node experiments/issue-52-effort-tuning.mjs`, with the tunes of #51), and -2.80, +2.98 and +3.16 dB of alpha ratio on the spectrum pooled over seven speaker pitches, since one rendering moves by several dB with half a semitone of pitch (`node experiments/issue-51-effort-alpha.mjs`; #52 measured -1.97, +2.00 and +4.52 dB on one rendering, and the tunes of #51 re-measured `FOLD_PITCH_RISE`). `[crescendo]`/`[diminuendo]` ramp linearly in dB between the first and the last vowel (a warning above 40 dB/s), `[lombard]` lengthens only stressed vowels, and the output is lowered by the loudest span (`levelOffsetDb`, `headroom`, `--headroom`) so that a shout does not clip. `effortToSpl()` puts effort 0.5 at 60 dB SPL; `integratedLoudness()` measures ITU-R BS.1770 loudness and `loudnessTarget` (`--loudness`) normalises to it with a peak of at most 0.98. The tables are in [docs/markup.md](markup.md#vocal-effort).

The phonation types of [#54](https://github.com/konard/voice-simulator/issues/54) give the plan `breath`, `creak`, `falsetto` and `harsh` channels (τ 0.03 s) next to `tension`, filled from the mode's phonation by the `PHONATION` table (breathy Rd 2.5 + breath 1, lax 1.8, pressed 0.4, creaky 0.5 + creak 1, falsetto 2.3 + falsetto 1 + breath 0.3, harsh 0.4 + harsh 1; `phonationChannels()`), with the Rd clamp of the LF source lowered to 0.3. The glottis adds aspiration noise with `breath` and `harsh`, lowers the pitch by up to 12 st with `creak` and pulses it in pairs (alternating periods and amplitudes) with extra jitter, raises it by 12 st with `falsetto` at -6 dB with a low-pass on the pulse, and adds jitter, shimmer and noise with `harsh`. `a̤` and `a̰` set one vowel to breathy or creaky voice of degree 0.67, the breathy-voiced stops of Hindi (`bʱ dʱ ɖʱ d͡ʒʱ ɡʱ`) get a breathy voiced release of 80 ms, and the head's `finalCreak` creaks the low end of a statement. Against plain speech on tier medium, seed 1 (`node experiments/issue-54-measures.mjs`): H1-H2 4.72 dB modal, 11.72 breathy, 9.66 lax, -4.55 pressed, 13.11 falsetto, -4.40 harsh; HNR 20.41 against 4.74 breathy and 8.02 harsh; CPP 28.01 against 15.83 breathy; creaky pulses -12.52 st with 7.06 % jitter and falsetto +11.78 st. New measures `cpp()`, `jitterPercent()`, `pulseF0()` and `pulseH1H2()`. The fold source of [#33](https://github.com/konard/voice-simulator/issues/33) is driven by the same channels (adduction and fold tension) but does not reach these targets on its own (`node experiments/issue-54-folds.mjs`), so the LF rules stay. The Rust engine does the same (interface version 4: frames carry the four channels). The tables are in [docs/markup.md](markup.md#phonation-types).

The whisper of [#53](https://github.com/konard/voice-simulator/issues/53) (`[whisper]`, `{W … W}`, `<vs:phonation name="whisper">`, `ạ`, `ḁ`) is a plan channel `whisper` (0 … 1) that turns the voice source into the turbulence of [#35](https://github.com/konard/voice-simulator/issues/35) at a half-open glottis of 40 mm²: no pulses, no pulse modulation, a glottal reflection lowered by `WHISPER_OPENING` (F1 +175 Hz on average at tier high), segments 1.3 times as long, a level 25 dB below the voice (30 dB soft, 20 dB for a stage whisper of 20 mm²), a level cue of the intended pitch, and the voiced and voiceless consonants kept apart by their closure, burst and frication; values between 0 and 1 give a whispery voice. `voicedShare()`, `energyRatio()` and `centreOfGravity()` measure it: "Please call Stella." whispered has no voiced frames (plain 0.83), +15.8 dB of energy ratio and a centre of gravity of 1214 Hz against 416 Hz ([docs/markup.md](markup.md#whisper)). The Rust engine renders a whisper in JavaScript until [#82](https://github.com/konard/voice-simulator/issues/82).

The emotions of [#55](https://github.com/konard/voice-simulator/issues/55) (`[angry]`, `[sad 0.5]`, `<vs:emotion name="happy" intensity="0.8">`, `<vs:emotion arousal="0.5" valence="-0.3">`) are rows of rules, not a sound source: `EMOTION_PRESETS` has twelve presets (neutral, angry, happy, sad, afraid and bored from the formant-synthesis profiles of Burkhardt and Sendlmeier 2000, `verified: true`; surprised and disgusted after Pell et al. 2009 and tender, sarcastic, confident and hesitant as own choices, `verified: false`) that set pitch, range, rate, effort, phonation, pauses, the length of stressed vowels, a glide in stressed vowels, a final rise, vowel precision and a smile, scaled by an intensity (semitones × i, factors f^i); a neutral emotion with arousal, valence or dominance uses the rules of Schröder et al. (2001) instead (`emotionChanges()`). The planner composes the changes with every span as an outer span, so `[angry][soft]…` stays soft (`realiseEmotion()`). Against plain "The train leaves at seven." (tier medium, seed 1, headroom 20; `node experiments/issue-55-emotion-measure.mjs`): `[angry]` +14.13 st (7 st plus its effort), range × 2.85, duration × 0.80, H1-H2 -7.39 dB; `[happy]` +9.79 st, range × 3.48; `[sad]` -3.85 st, range × 0.84, duration × 1.83, H1-H2 +6.32 dB, -7.5 dB; `[afraid]` +22.08 st with a final rise of 2.83 st; `[bored]` -3.64 st, range × 0.52, stressed vowels × 1.75; `[happy]` raises F2 of `ˈa` by 5.8 % (`node experiments/issue-55-smile.mjs`). Text without an emotion gives the same samples as before (`node experiments/issue-55-plain-identity.mjs`), and the Rust engine renders the same samples, since emotions only change the plan. The listening harness of [#20](https://github.com/konard/voice-simulator/issues/20) gets choice trials, a confusion matrix and `binomialTailP()`, and `examples/listening-test/emotions.sentences.json` builds 48 trials in four languages; the test itself has not been run with listeners ([docs/listening-tests/emotions.md](listening-tests/emotions.md)). The tables are in [docs/markup.md](markup.md#emotions-and-attitudes).

The paralinguistic sounds of [#56](https://github.com/konard/voice-simulator/issues/56) (`src/articulation/sounds.js`) are made by the glottis and the tract like speech, from the recipes of `SOUNDS`: `inhale` and `exhale` (glottal noise at an open glottis, tract of `ə`, 30 dB below the vowels), `sigh` (an inhale, then a breathy `ɐ` falling 6 st and 12 dB), `laugh` (calls of `h` + breathy `ə`, 5 per second, the first at 1.66 times the voice's pitch, each 1 st and 1.5 dB lower), `filler` and the new `um` (the vowels of `FILLERS` per language, 2 st below the syllable before), `cough` (`ʔ` and a burst of glottal noise as loud as a vowel, twice), `throat` (two creaky parts near 64 Hz) and `click` (a closure and a burst without lung air; also the click letters `ǀ ǃ ǁ ʘ`). A written length stretches a sound and sets the calls of a laugh or a cough, `⸨laugh:1.2⸩` keeps it in IPA, and a sound takes the mode of its span. The written fillers (`um`, `э-э`, `嗯`, `अं`, …) and laughter (`hahaha`, `ха-ха`, `哈哈`) of every verbalizer become sounds also in plain text and stay words of the timeline; `嗯` no longer vanishes. The option `breaths` (`--breaths`) puts an inhale of `min(0.7, 0.3 + 0.03 n)` s into the pauses between sentences. `timeline.sounds` lists the sounds, which are not words. Measured on tier medium, seed 1: laugh calls at 198, 187, 176 and 168 Hz, an inhale 25.4 dB below the vowel of `Yes`, cough bursts rising 42.1 and 37.9 dB within 20 ms, a sigh falling 5.89 st (`node experiments/issue-56-measure.mjs`, `issue-56-cough.mjs`, `issue-56-sigh.mjs`); text without sounds gives the same samples as before, and the Rust engine renders the sounds to 4.4e-16 of JavaScript. The tables are in [docs/markup.md](markup.md#sounds).

| Issue                                                      | Type    | Title                                                                       | Blocked by                                                                                                                                                                                                                                     | Requirements     |
| ---------------------------------------------------------- | ------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [#42](https://github.com/konard/voice-simulator/issues/42) | Bug     | Mandarin third tone is spoken as a plain rise because the dip is dropped    | nothing                                                                                                                                                                                                                                        | R17, R19         |
| [#43](https://github.com/konard/voice-simulator/issues/43) | Bug     | Mandarin erhua is spoken as a separate syllable                             | nothing                                                                                                                                                                                                                                        | R17, R19         |
| [#44](https://github.com/konard/voice-simulator/issues/44) | Bug     | English heteronyms are always read the same way                             | nothing                                                                                                                                                                                                                                        | R17, R19         |
| [#45](https://github.com/konard/voice-simulator/issues/45) | Bug     | Hindi yes/no questions that start with क्या get a falling contour           | nothing                                                                                                                                                                                                                                        | R17, R19         |
| [#46](https://github.com/konard/voice-simulator/issues/46) | Bug     | Expanded numbers and dates are highlighted as one word                      | nothing                                                                                                                                                                                                                                        | R10, R17         |
| [#47](https://github.com/konard/voice-simulator/issues/47) | Feature | Pronunciation lexicons at scale from permissive sources                     | [#15](https://github.com/konard/voice-simulator/issues/15), [#16](https://github.com/konard/voice-simulator/issues/16)                                                                                                                         | R7, R17, R18     |
| [#48](https://github.com/konard/voice-simulator/issues/48) | Bug     | Russian stress is wrong outside the small dictionary and for homographs     | [#47](https://github.com/konard/voice-simulator/issues/47)                                                                                                                                                                                     | R17, R19         |
| [#49](https://github.com/konard/voice-simulator/issues/49) | Feature | Tone model with targets, the neutral tone and tone coarticulation           | [#42](https://github.com/konard/voice-simulator/issues/42)                                                                                                                                                                                     | R17, R19         |
| [#50](https://github.com/konard/voice-simulator/issues/50) | Feature | Speech markup: an SSML subset, inline tags and voice-quality symbols in IPA | nothing                                                                                                                                                                                                                                        | R17, R7, R10, R5 |
| [#51](https://github.com/konard/voice-simulator/issues/51) | Feature | Intonation models per language: sentence types, focus and Russian contours  | [#50](https://github.com/konard/voice-simulator/issues/50)                                                                                                                                                                                     | R17, R7, R19     |
| [#52](https://github.com/konard/voice-simulator/issues/52) | Feature | Vocal effort and loudness dynamics                                          | [#50](https://github.com/konard/voice-simulator/issues/50)                                                                                                                                                                                     | R17, R5, R7      |
| [#53](https://github.com/konard/voice-simulator/issues/53) | Feature | Whisper                                                                     | [#50](https://github.com/konard/voice-simulator/issues/50), [#35](https://github.com/konard/voice-simulator/issues/35)                                                                                                                         | R17, R7, R18     |
| [#54](https://github.com/konard/voice-simulator/issues/54) | Feature | Phonation types: breathy, creaky, pressed and falsetto                      | [#50](https://github.com/konard/voice-simulator/issues/50), [#32](https://github.com/konard/voice-simulator/issues/32)                                                                                                                         | R17, R5, R7      |
| [#55](https://github.com/konard/voice-simulator/issues/55) | Feature | Emotions and attitudes                                                      | [#51](https://github.com/konard/voice-simulator/issues/51), [#52](https://github.com/konard/voice-simulator/issues/52), [#54](https://github.com/konard/voice-simulator/issues/54), [#20](https://github.com/konard/voice-simulator/issues/20) | R17, R5, R18     |
| [#56](https://github.com/konard/voice-simulator/issues/56) | Feature | Paralinguistic sounds: breaths, laughter, sighs and hesitations             | [#50](https://github.com/konard/voice-simulator/issues/50), [#35](https://github.com/konard/voice-simulator/issues/35)                                                                                                                         | R17, R7, R18     |
| [#57](https://github.com/konard/voice-simulator/issues/57) | Feature | Accents beyond English and foreign accents                                  | nothing                                                                                                                                                                                                                                        | R17, R5, R7      |
| [#85](https://github.com/konard/voice-simulator/issues/85) | Bug     | English function words are spoken as full stressed words                    | nothing                                                                                                                                                                                                                                        | R17, R19         |
| [#86](https://github.com/konard/voice-simulator/issues/86) | Bug     | Russian prepositions and particles are read as separate stressed words      | nothing                                                                                                                                                                                                                                        | R17, R19         |

### Roadmap 4: Reverse simulation (listening)

The IPA-to-text stage of [#68](https://github.com/konard/voice-simulator/issues/68) uses runtime pronunciation tries, articulatory edit search and public-domain unigram/bigram counts in four explicitly selected languages. Its API, data provenance and verification are documented in [IPA recognition](ipa-to-text.md).

The language stage of [#69](https://github.com/konard/voice-simulator/issues/69) derives weighted phone statistics from the same tries, identifies syllable spans with confidence and reads mixed speech through a joint language-labelled beam search. The library exports `identifyLanguage` and `languageShares`; the command line has `language`. See [language identification](language-id.md) for fixed fixtures, calibration and acceptance measurements.

Audio to IPA to language to text by inverting the simulation: analysis front end, inversion, decoding, language identification, API, app and benchmarks.

The analysis front end of [#58](https://github.com/konard/voice-simulator/issues/58) (`src/recognition/`) resamples the input chunk by chunk to 16000, 11025 or 8000 Hz (`createResampler`, within 3e-8 of `resample()` for 44100 to 16000 Hz) and fills one frame set of flat `Float32Array`s every 5 or 10 ms: energy, zero crossings, centre of gravity, tilt, six Liu (1996) bands, periodicity (Boersma 1993), 24 mel energies, 13 cepstra, LPC by Burg, autocorrelation or covariance, a minimum-statistics noise floor (Martin 2001) and a speech flag. One `createFft` serves the whole package. The noise floor is capped at the loudest speech frame minus 25 dB, not the loudest frame, because a recording that starts with noise would otherwise hold the floor 25 dB under the noise and call all of it speech (`node experiments/issue-58-noise-cap.mjs`: 0 of 200 noise frames are called speech instead of 200 of 200). It takes 0.0138 of real time at 16000 Hz and 0.0059 at 8000 Hz and adds at most 13.5 ms of delay (`node experiments/issue-58-rtf.mjs`, `node experiments/issue-58-delay.mjs`). Stages #59 to #66 read the frame set and follow the `createX(frames, options)` / `advance(final)` / `committed` pattern (`FrameStage` in `src/recognition/frontend.d.ts`). The Rust core has the root finder (the LPC roots of the three orders, warm-started frame by frame, the dominant cost) and the tract length (`crates/voice-simulator-core/src/formants.rs`, export `vs_formant_candidates`), the same candidates as JavaScript in `tests/rust-parity.test.js`; the numbering, the smoothing and the use of the Rust engine by the tracker are left to [#77](https://github.com/konard/voice-simulator/issues/77).

The articulatory codebook of [#64](https://github.com/konard/voice-simulator/issues/64) generates a deterministic table from the simulator on first use. `buildCodebook`, `frameEnvelope` and bounded `query` provide candidate tract positions for #65, with typed binary caching and per-length geometry at 0.5 cm intervals. See [the codebook API and verification](CODEBOOK.md); observed LPC source coloration remains visible in the rendered-vowel target report. Rust transfer/key primitives have parity coverage; Rust table building belongs to #77 and app-worker storage to #74.

The pitch and voicing tracker of [#59](https://github.com/konard/voice-simulator/issues/59) (`src/recognition/pitch.js`, `trackPitch` and the stage `createPitchTracker`) takes up to 4 autocorrelation candidates per 5 ms frame (Boersma 1993) on the sound decimated to about 4 kHz, refines them at the working rate and chooses a Viterbi path through them and "unvoiced"; a stream fixes each frame 20 frames later (125 ms with the window). Two additions to the plan of the issue: f0 is that of the period starting at the frame (the path read half a period later), which keeps the fine error within the 15 cents of the issue, and the unvoiced state is cheaper in quiet frames (an energy drop or a frame near the noise floor), which ends voicing at a stop closure. On the six synthetic voices (`node experiments/issue-59-pitch-set.mjs`) it has a gross pitch error of 0, a voicing error of at most 0.0078 and a fine error of at most 14.3 cents; the frame error in white noise is at most 0.0091 at 10 dB; it costs 0.034 of real time at 16000 Hz (`node experiments/issue-59-rtf.mjs`); in [experiments/issue-11-audit-m4a.txt](../experiments/issue-11-audit-m4a.txt) the voicing error per 10 ms frame is 3.8–5.4 % against 7.2–16.3 % for YIN. Jitter and shimmer from period marks follow the head setting (`node experiments/issue-59-cases.mjs`). No corpus with a laryngograph reference has a permitted licence (PTDB-TUG, Keele and CSTR FDA are in `datasets/refused.json`), so `tests/heavy/recognition-pitch.test.js` skips the measurement on real speech ([docs/reports/recognition-pitch.md](reports/recognition-pitch.md)). The Rust core has the root finder (the LPC roots of the three orders, warm-started frame by frame, the dominant cost) and the tract length (`crates/voice-simulator-core/src/formants.rs`, export `vs_formant_candidates`), the same candidates as JavaScript in `tests/rust-parity.test.js`; the numbering, the smoothing and the use of the Rust engine by the tracker are left to [#77](https://github.com/konard/voice-simulator/issues/77).

The formant tracker of [#60](https://github.com/konard/voice-simulator/issues/60) (`src/recognition/formants.js`, `trackFormants` and the stage `createFormantTracker`) takes the roots of the LPC models of orders p, p - 2 and p - 4 as candidates, numbers them F1 .. F4 by dynamic programming against the resonances of a uniform tube of the tract length (Talkin 1987) and smooths each formant with a Kalman filter and a Rauch-Tung-Striebel smoother; a stream fixes each frame 10 frames (50 ms) later. Changes to the plan of the issue, each measured: the local cost is |f - ref| / ref + min(2 B / f, 1.3), because |f - ref| / 1000 + B / f labels the F2 of the female and child /i/ as F3 and leaves 1756 of 6000 steady-vowel frames invalid or more than 20 % off against 867 (`node experiments/issue-60-vowels.mjs`); the tract length is estimated in up to 3 passes from vowel-like frames only (periodic, loud, not nasal), since consonants pull it towards 16.5 cm (`node experiments/issue-60-length.mjs`); the nasal flag uses a lowest candidate below 0.9 ref[1] with a band drop and a high-band test, which flags 70 % of the nasal frames and 6.7 % of the vowel frames of the calibration set (`node experiments/issue-60-nasal.mjs`). The truth of the tests is `tubeFormants` of the planned area function, read on its 5 Hz grid by a 50 Hz scan and a hill climb (`gridFormants` in `tests/helpers/recognition-truth.js`, identical on 4350 frames and ten times faster, `node experiments/issue-60-truth.mjs`), so that `tests/recognition-formants.test.js` runs in about 30 s. The tests give the tract lengths 13.82, 17.24 and 19.43 cm for 13, 16.5 and 19 cm, a stream within 30 Hz of the batch in at least 99.6 % of the frames and 0.03 of real time at 16000 Hz. The audit targets (F1 within 5 %, F2 and F3 within 4 % of the planned formants) are not met: in [experiments/issue-11-audit-m4a.txt](../experiments/issue-11-audit-m4a.txt) `trackFormants` has mean errors of 7.2–17.9 % for F1, 4.2–5.6 % for F2 and 2.8–4.5 % for F3, and the `renderer formants` block shows that the rendered sound itself differs from the planned formants by 5.9–7.2 % in F1 and 5.0–5.6 % in F2, above the targets, so no tracker can meet them against that truth. On the golden set 99.6 % of the voiced frames have F1 to F3 and 0.4 % of the F2 steps jump by more than 300 Hz ([docs/reports/recognition-formants.md](reports/recognition-formants.md)); the VTR formant database is refused by the licence policy (`datasets/refused.json`), so no error per formant is measured on real speech. The Rust core has the root finder (the LPC roots of the three orders, warm-started frame by frame, the dominant cost) and the tract length (`crates/voice-simulator-core/src/formants.rs`, export `vs_formant_candidates`), the same candidates as JavaScript in `tests/rust-parity.test.js`; the numbering, the smoothing and the use of the Rust engine by the tracker are left to [#77](https://github.com/konard/voice-simulator/issues/77).

The experimental detector of [#62](https://github.com/konard/voice-simulator/issues/62)
exports `findLandmarks`, `createLandmarkDetector` and `BROAD_CLASSES`, with
mel sonority, two-scale band landmarks and a calibrated fixed class tree.
The [owner-revised contract and measured regression limits](RECOGNITION-LANDMARKS.md)
retain immutable 60 ms streaming classes and confirmed nuclei, while batch
uses retrospective closure cleanup. Synthetic recall is 63.33% and class
accuracy 48.25%/47.11% at 16/8 kHz; the original 90% and 85%/80% goals
remain aspirations. Controlled signal rules, noise rejection, latency,
calibration determinism, CPU cost and Rust/WASM parity are independently tested.

The batch source analysis of [#61](https://github.com/konard/voice-simulator/issues/61)
(`inverseFilter`) removes an all-pole tract with four-stage IAIF, then measures
LF Rd, open and normalized amplitude quotients, speech/source H1-H2, HNR and CPP.
It accepts the pitch track of #59 or uses local autocorrelation, reports closure
instants and reliable-frame quartiles, and flags recordings missing the low band.
Steady phonation gets an LF-constrained tract refinement. The same numerical code
is in the Rust core with WebAssembly parity tests. Definitions, measured limits
and reproducing commands are in [INVERSE-FILTER.md](INVERSE-FILTER.md).

| Issue                                                      | Type    | Title                                                                          | Blocked by                                                                                                                                                                                                                                                                                                                                                             | Requirements                    |
| ---------------------------------------------------------- | ------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| [#58](https://github.com/konard/voice-simulator/issues/58) | Feature | Streaming analysis front end                                                   | nothing                                                                                                                                                                                                                                                                                                                                                                | R6, R7, R12, R13, R18           |
| [#59](https://github.com/konard/voice-simulator/issues/59) | Feature | Robust pitch and voicing tracker                                               | [#58](https://github.com/konard/voice-simulator/issues/58), [#18](https://github.com/konard/voice-simulator/issues/18), [#16](https://github.com/konard/voice-simulator/issues/16)                                                                                                                                                                                     | R6, R9, R12, R13, R18           |
| [#60](https://github.com/konard/voice-simulator/issues/60) | Feature | Formant tracker                                                                | [#58](https://github.com/konard/voice-simulator/issues/58), [#18](https://github.com/konard/voice-simulator/issues/18), [#17](https://github.com/konard/voice-simulator/issues/17)                                                                                                                                                                                     | R6, R9, R12, R13, R18           |
| [#61](https://github.com/konard/voice-simulator/issues/61) | Feature | Glottal inverse filtering and source parameters                                | [#58](https://github.com/konard/voice-simulator/issues/58)                                                                                                                                                                                                                                                                                                             | R6, R9, R12, R13, R18           |
| [#62](https://github.com/konard/voice-simulator/issues/62) | Feature | Syllable nuclei, landmarks and broad sound classes                             | [#58](https://github.com/konard/voice-simulator/issues/58), [#17](https://github.com/konard/voice-simulator/issues/17)                                                                                                                                                                                                                                                 | R6, R10, R12, R13, R18          |
| [#63](https://github.com/konard/voice-simulator/issues/63) | Feature | Voice configuration fit on real speakers (pass 1)                              | [#59](https://github.com/konard/voice-simulator/issues/59), [#60](https://github.com/konard/voice-simulator/issues/60), [#61](https://github.com/konard/voice-simulator/issues/61), [#17](https://github.com/konard/voice-simulator/issues/17), [#32](https://github.com/konard/voice-simulator/issues/32)                                                             | R6, R8, R9, R12, R13, R18, R19  |
| [#64](https://github.com/konard/voice-simulator/issues/64) | Feature | Articulatory codebook generated by the simulator                               | [#58](https://github.com/konard/voice-simulator/issues/58)                                                                                                                                                                                                                                                                                                             | R6, R12, R13, R18, R19          |
| [#65](https://github.com/konard/voice-simulator/issues/65) | Feature | Acoustic-to-articulatory inversion (pass 2)                                    | [#64](https://github.com/konard/voice-simulator/issues/64), [#60](https://github.com/konard/voice-simulator/issues/60), [#63](https://github.com/konard/voice-simulator/issues/63)                                                                                                                                                                                     | R6, R9, R12, R13, R18, R19      |
| [#66](https://github.com/konard/voice-simulator/issues/66) | Feature | Decode articulation into IPA with times                                        | [#65](https://github.com/konard/voice-simulator/issues/65), [#62](https://github.com/konard/voice-simulator/issues/62)                                                                                                                                                                                                                                                 | R6, R7, R10, R12, R13, R18, R19 |
| [#67](https://github.com/konard/voice-simulator/issues/67) | Feature | Analysis-by-synthesis rescoring                                                | [#66](https://github.com/konard/voice-simulator/issues/66), [#18](https://github.com/konard/voice-simulator/issues/18)                                                                                                                                                                                                                                                 | R6, R7, R12, R13, R18, R19      |
| [#68](https://github.com/konard/voice-simulator/issues/68) | Feature | IPA to text per language                                                       | [#47](https://github.com/konard/voice-simulator/issues/47)                                                                                                                                                                                                                                                                                                             | R6, R7, R19                     |
| [#69](https://github.com/konard/voice-simulator/issues/69) | Feature | Language identification and mixed-language speech from IPA                     | [#68](https://github.com/konard/voice-simulator/issues/68)                                                                                                                                                                                                                                                                                                             | R6, R7, R19                     |
| [#70](https://github.com/konard/voice-simulator/issues/70) | Feature | Recognise tones, stress and sentence type                                      | [#66](https://github.com/konard/voice-simulator/issues/66), [#59](https://github.com/konard/voice-simulator/issues/59), [#49](https://github.com/konard/voice-simulator/issues/49), [#51](https://github.com/konard/voice-simulator/issues/51)                                                                                                                         | R6, R17, R18, R19               |
| [#71](https://github.com/konard/voice-simulator/issues/71) | Feature | Recognise loudness, whisper, voice quality and emotion                         | [#61](https://github.com/konard/voice-simulator/issues/61), [#52](https://github.com/konard/voice-simulator/issues/52), [#53](https://github.com/konard/voice-simulator/issues/53), [#54](https://github.com/konard/voice-simulator/issues/54), [#55](https://github.com/konard/voice-simulator/issues/55), [#17](https://github.com/konard/voice-simulator/issues/17) | R6, R17, R18, R19               |
| [#72](https://github.com/konard/voice-simulator/issues/72) | Feature | Recognise whispered speech                                                     | [#66](https://github.com/konard/voice-simulator/issues/66), [#53](https://github.com/konard/voice-simulator/issues/53)                                                                                                                                                                                                                                                 | R6, R13, R17, R18, R19          |
| [#73](https://github.com/konard/voice-simulator/issues/73) | Feature | Recognition API, command and server route with streaming results               | [#66](https://github.com/konard/voice-simulator/issues/66), [#68](https://github.com/konard/voice-simulator/issues/68), [#69](https://github.com/konard/voice-simulator/issues/69)                                                                                                                                                                                     | R3, R4, R6, R7, R10, R13        |
| [#74](https://github.com/konard/voice-simulator/issues/74) | Feature | App: recognition from the microphone and files with live syllable highlighting | [#73](https://github.com/konard/voice-simulator/issues/73)                                                                                                                                                                                                                                                                                                             | R6, R7, R10                     |
| [#75](https://github.com/konard/voice-simulator/issues/75) | Feature | Round-trip tests: text to audio to text in the heavy workflow                  | [#73](https://github.com/konard/voice-simulator/issues/73), [#14](https://github.com/konard/voice-simulator/issues/14), [#26](https://github.com/konard/voice-simulator/issues/26)                                                                                                                                                                                     | R6, R7, R11, R13, R18           |
| [#76](https://github.com/konard/voice-simulator/issues/76) | Feature | Recognition benchmark on public recordings                                     | [#73](https://github.com/konard/voice-simulator/issues/73), [#16](https://github.com/konard/voice-simulator/issues/16), [#18](https://github.com/konard/voice-simulator/issues/18), [#14](https://github.com/konard/voice-simulator/issues/14)                                                                                                                         | R6, R8, R11, R13, R19           |
| [#77](https://github.com/konard/voice-simulator/issues/77) | Feature | Recognition in Rust and on several cores with a single-core fallback           | [#73](https://github.com/konard/voice-simulator/issues/73), [#21](https://github.com/konard/voice-simulator/issues/21)                                                                                                                                                                                                                                                 | R2, R6, R12, R13                |

### Roadmap 5: Voice copy and state-of-the-art validation

Multi-pass voice copy with continuous recognition, copy synthesis of real recordings, lowest-settings certification and the final evaluation.

| Issue                                                      | Type    | Title                                                                                      | Blocked by                                                                                                                                                                                                                                                                                                                                                                                                                         | Requirements     |
| ---------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [#78](https://github.com/konard/voice-simulator/issues/78) | Feature | Multi-pass voice session: fit, invert, stabilise, keep recognising                         | [#63](https://github.com/konard/voice-simulator/issues/63), [#73](https://github.com/konard/voice-simulator/issues/73)                                                                                                                                                                                                                                                                                                             | R9, R8, R12      |
| [#79](https://github.com/konard/voice-simulator/issues/79) | Feature | Copy synthesis: reproduce a real recording                                                 | [#78](https://github.com/konard/voice-simulator/issues/78), [#70](https://github.com/konard/voice-simulator/issues/70), [#71](https://github.com/konard/voice-simulator/issues/71), [#20](https://github.com/konard/voice-simulator/issues/20)                                                                                                                                                                                     | R8, R9           |
| [#80](https://github.com/konard/voice-simulator/issues/80) | Feature | App: copy a voice while the person keeps speaking                                          | [#78](https://github.com/konard/voice-simulator/issues/78), [#74](https://github.com/konard/voice-simulator/issues/74)                                                                                                                                                                                                                                                                                                             | R9, R10, R3      |
| [#81](https://github.com/konard/voice-simulator/issues/81) | Feature | Lowest-settings certification: 8 kHz and one core                                          | [#75](https://github.com/konard/voice-simulator/issues/75), [#76](https://github.com/konard/voice-simulator/issues/76), [#79](https://github.com/konard/voice-simulator/issues/79), [#26](https://github.com/konard/voice-simulator/issues/26)                                                                                                                                                                                     | R13, R12, R11    |
| [#82](https://github.com/konard/voice-simulator/issues/82) | Feature | Rust parity for everything added after the port (feature inventory, probes and speed gate) | [#25](https://github.com/konard/voice-simulator/issues/25), [#33](https://github.com/konard/voice-simulator/issues/33), [#34](https://github.com/konard/voice-simulator/issues/34), [#35](https://github.com/konard/voice-simulator/issues/35), [#36](https://github.com/konard/voice-simulator/issues/36), [#53](https://github.com/konard/voice-simulator/issues/53), [#54](https://github.com/konard/voice-simulator/issues/54) | R2, R12          |
| [#83](https://github.com/konard/voice-simulator/issues/83) | Feature | State-of-the-art evaluation and public report                                              | [#19](https://github.com/konard/voice-simulator/issues/19), [#20](https://github.com/konard/voice-simulator/issues/20), [#79](https://github.com/konard/voice-simulator/issues/79), [#81](https://github.com/konard/voice-simulator/issues/81), [#31](https://github.com/konard/voice-simulator/issues/31), [#28](https://github.com/konard/voice-simulator/issues/28)                                                             | R19, R1, R8, R14 |

### Dependency graph

An arrow points from an issue to the issues it blocks. Bugs have rounded boxes.

```mermaid
flowchart LR
  subgraph M0["Roadmap 0: Foundations and measurement"]
    P01(["#13"])
    P02["#14"]
    P03["#15"]
    P04["#16"]
    P05["#17"]
    P06["#18"]
    P07["#19"]
    P08["#20"]
  end
  subgraph M1["Roadmap 1: Rust engine and adaptive quality"]
    P09["#21"]
    P10["#22"]
    P11["#23"]
    P12["#24"]
    P13["#25"]
    P14["#26"]
    P15["#27"]
    P16["#28"]
    P17["#29"]
    P18["#30"]
    P19["#31"]
  end
  subgraph M2["Roadmap 2: Voice physics and configuration"]
    P20(["#32"])
    P21["#33"]
    P22["#34"]
    P23["#35"]
    P24["#36"]
    P25["#37"]
    P26["#38"]
    P27["#39"]
    P28["#40"]
    P29["#41"]
    P72(["#84"])
  end
  subgraph M3["Roadmap 3: Languages and modes of speech"]
    P30(["#42"])
    P31(["#43"])
    P32(["#44"])
    P33(["#45"])
    P34(["#46"])
    P35["#47"]
    P36(["#48"])
    P37["#49"]
    P38["#50"]
    P39["#51"]
    P40["#52"]
    P41["#53"]
    P42["#54"]
    P43["#55"]
    P44["#56"]
    P45["#57"]
    P73(["#85"])
    P74(["#86"])
  end
  subgraph M4["Roadmap 4: Reverse simulation (listening)"]
    P46["#58"]
    P47["#59"]
    P48["#60"]
    P49["#61"]
    P50["#62"]
    P51["#63"]
    P52["#64"]
    P53["#65"]
    P54["#66"]
    P55["#67"]
    P56["#68"]
    P57["#69"]
    P58["#70"]
    P59["#71"]
    P60["#72"]
    P61["#73"]
    P62["#74"]
    P63["#75"]
    P64["#76"]
    P65["#77"]
  end
  subgraph M5["Roadmap 5: Voice copy and state-of-the-art validation"]
    P66["#78"]
    P67["#79"]
    P68["#80"]
    P69["#81"]
    P70["#82"]
    P71["#83"]
  end
  P02 --> P04
  P03 --> P04
  P04 --> P05
  P02 --> P07
  P05 --> P07
  P06 --> P07
  P09 --> P10
  P02 --> P10
  P09 --> P11
  P10 --> P11
  P11 --> P12
  P10 --> P13
  P11 --> P13
  P13 --> P16
  P14 --> P16
  P13 --> P17
  P15 --> P17
  P02 --> P18
  P02 --> P19
  P13 --> P19
  P21 --> P22
  P06 --> P26
  P05 --> P26
  P05 --> P27
  P06 --> P27
  P21 --> P29
  P23 --> P29
  P24 --> P29
  P03 --> P35
  P04 --> P35
  P35 --> P36
  P30 --> P37
  P38 --> P39
  P38 --> P40
  P38 --> P41
  P23 --> P41
  P38 --> P42
  P20 --> P42
  P39 --> P43
  P40 --> P43
  P42 --> P43
  P08 --> P43
  P38 --> P44
  P23 --> P44
  P46 --> P47
  P06 --> P47
  P04 --> P47
  P46 --> P48
  P06 --> P48
  P05 --> P48
  P46 --> P49
  P46 --> P50
  P05 --> P50
  P47 --> P51
  P48 --> P51
  P49 --> P51
  P05 --> P51
  P20 --> P51
  P46 --> P52
  P52 --> P53
  P48 --> P53
  P51 --> P53
  P53 --> P54
  P50 --> P54
  P54 --> P55
  P06 --> P55
  P35 --> P56
  P56 --> P57
  P54 --> P58
  P47 --> P58
  P37 --> P58
  P39 --> P58
  P49 --> P59
  P40 --> P59
  P41 --> P59
  P42 --> P59
  P43 --> P59
  P05 --> P59
  P54 --> P60
  P41 --> P60
  P54 --> P61
  P56 --> P61
  P57 --> P61
  P61 --> P62
  P61 --> P63
  P02 --> P63
  P14 --> P63
  P61 --> P64
  P04 --> P64
  P06 --> P64
  P02 --> P64
  P61 --> P65
  P09 --> P65
  P51 --> P66
  P61 --> P66
  P66 --> P67
  P58 --> P67
  P59 --> P67
  P08 --> P67
  P66 --> P68
  P62 --> P68
  P63 --> P69
  P64 --> P69
  P67 --> P69
  P14 --> P69
  P13 --> P70
  P21 --> P70
  P22 --> P70
  P23 --> P70
  P24 --> P70
  P41 --> P70
  P42 --> P70
  P07 --> P71
  P08 --> P71
  P67 --> P71
  P69 --> P71
  P19 --> P71
  P16 --> P71
```

<!-- roadmap:end -->

## Rules for every roadmap issue

The same rules are printed at the end of every issue.

- Read [VISION.md](VISION.md), this file and [CONTRIBUTING.md](CONTRIBUTING.md)
  first.
- **No neural networks** in the library, the app, the tests or the tools, and
  no playback of recorded speech. Allowed: physics, closed-form signal
  processing, search, optimisation, dynamic programming and small documented
  tables.
- **Public domain.** New code is Unlicense. New dependencies need a permissive
  licence (MIT, BSD, Apache-2.0, ISC, Zlib, CC0, Unlicense). Committed data is
  public domain or CC0; anything else is downloaded at test time and never
  committed.
- One pull request per issue. Do not start before every issue under "Blocked
  by" is closed.
- Work in the JavaScript reference implementation in `src/` unless the issue
  says otherwise. If the directory `crates/` exists when you start, implement
  the same numerical code in the Rust core too and extend the parity tests,
  following the interface rules, the determinism rules and the parity classes
  of [RUST-ENGINE.md](RUST-ENGINE.md).
- Same input, seed and options must give the same samples on Node.js, Bun and
  Deno. Take randomness only from `src/random.js`.
- Add tests in `tests/` that fail before the change and pass after it. Tests
  that need more than about 10 seconds or a download run only in the manually
  triggered workflow.
- Keep every source and Markdown file under 1500 lines, run `npm run check` and
  `npm test`, and add a changeset (`npm run changeset`) when code changes.
- Update `README.md`, `src/index.d.ts`, the command line help and this file
  when behaviour or the public API changes. Put experiment scripts in
  `experiments/` and name them after the issue's number.
- Report measured numbers with the command that produced them. Do not write a
  claim that was not measured.

## How the roadmap is maintained

- The text of every issue is kept in
  [case-studies/issue-11/plan](case-studies/issue-11/plan/README.md), one file
  per issue, with the names that the issues share (files, functions, formats).
- `node experiments/issue-11-create-issues.mjs check` validates the plan: every
  issue has all sections, every blocker exists and the dependencies have no
  cycle. `create` made the GitHub issues, milestones and "blocked by" links;
  `update` sends an issue again after its plan file was edited; `roadmap`
  writes the tables and the graph above from
  [the list of created issues](case-studies/issue-11/data/created-issues.json).
- A pull request that finishes an issue ticks nothing here: the state of an
  issue lives on GitHub. A pull request that changes the direction updates
  [VISION.md](VISION.md) and adds or edits issues, then this file.
