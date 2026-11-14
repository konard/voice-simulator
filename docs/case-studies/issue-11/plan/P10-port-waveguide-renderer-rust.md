---
id: P10
title: Port the waveguide, the glottal source and the voice renderer to Rust
type: Feature
milestone: M1
blocked_by: [P09, P02]
requirements: [R2, R12, R13]
---

## Goal

Render speech with the 1D waveguide solver entirely inside the WebAssembly
module of {{P09}}: glottal source, noise sources, waveguide, lip and nostril
radiation, output filter, resampling, microphone and room. JavaScript keeps
text analysis and articulation planning and hands Rust one "frame" of tract
shape per control block. The result must match the JavaScript renderer within
a stated tolerance and must not be slower.

## Why

The waveguide tiers are the ones every device can run in real time and the
ones the lowest settings use (R13). They are also the smallest complete path
from a plan to samples, so they are the right first port: once they pass,
the 3D solver ({{P11}}) only swaps the solver inside a renderer that already
works, and the engine switch ({{P13}}) has something to switch to.

## Current state

- Files and what they hold (`src/acoustics/`): `filters.js` (103 lines:
  `createNoise(seed)`, `Biquad` with `lowpass`, `highpass`, `bandpass`,
  `process`), `glottis.js` (156 lines: `lfParameters`, `lfWaveform`,
  `glottalReflection`, `chinkTimeConstant`, class `Glottis` with
  `step(dt, control, noise)` and a generator `createRandom(seed + ':glottis')`
  for jitter and shimmer), `radiation.js` (85 lines: class `Radiation`),
  `waveguide.js` (340 lines: `piriformBranch`, `lossFactor`, class
  `Waveguide`), `microphone.js` (227 lines: `MicrophoneStage`,
  `createListener`), `room.js` (395 lines: `DelayNetwork`, `Room`),
  `voice.js` (412 lines: `NoiseSources`, `OutputStage`, `VoiceRenderer`).
  `sinuses.js` is used only by `voxel-model.js` (3D), not by the waveguide.
- `VoiceRenderer` loop. Every `blockSize` output samples (default 32)
  `#updateShape()` calls `sampleState(plan, time, state)`, then
  `tractShape(state, head, {sections, teeth, vowelCorrections})`, then
  `solver.setShape(areas, velumArea, velumIndex, teeth)`,
  `solver.setLength(shape.length)` and reconfigures the noise filters to the
  solver rate. `#record` runs solver steps `while (solverTime <= time)`;
  each step draws white noise twice (aspiration, frication), calls
  `glottis.step(stepDuration, shape.glottis, aspiration)` and
  `solver.step(source, shape.frication.position, noise)`. `#finish` passes
  the step outputs through two low-pass biquads (Q 0.54 and 1.31, cut-off
  `min(0.45 * sampleRate, 20000)`), interpolates linearly to the output
  rate, applies the listener, a 30 Hz DC blocker and `Math.tanh`.
- Blocks are aligned to the absolute sample position, so `render()` gives
  the same audio for any chunk size (comment above `render`).
- The waveguide rate is `sections * 35000 / length` Hz (`setLength`): 93 333
  Hz for 44 sections at 16.5 cm.
- Measured (`experiments/issue-11-audit-m1.txt`): of a `minimal` render,
  `sampleState` plus `tractShape` take 23 % (0.042 s of 0.184 s for 3.98 s of
  audio); of a `medium` render 22 %. Real-time factors on one core: `minimal`
  0.05, `low` 0.1, `medium` 0.14 (`experiments/issue-11-audit.txt`).
- Transcendental functions in the per-step path: `Math.exp` and `Math.sin`
  in `Glottis`, `Math.tanh` in `OutputStage.finish`, `**` in the loss
  factor. So results cannot be bit-identical with JavaScript (class B of
  {{P09}}).

## What to do

1. Port in this order, one commit and one parity test per row. Keep names
   and the order of floating-point operations as in the JavaScript file so
   that the two can be read side by side.

   | Step | JavaScript                                    | Rust (`crates/voice-simulator-core/src/`) |
   | ---- | --------------------------------------------- | ----------------------------------------- |
   | 1    | `filters.js`                                  | `filters.rs`: `Biquad`, `Noise`           |
   | 2    | `glottis.js`                                  | `glottis.rs`                              |
   | 3    | `radiation.js`                                | `radiation.rs`                            |
   | 4    | `waveguide.js`                                | `waveguide.rs`                            |
   | 5    | `voice.js`: `NoiseSources`, `OutputStage`     | `stages.rs`                               |
   | 6    | `voice.js`: `#step`, `#record`, `#finish`     | `renderer.rs`                             |
   | 7    | `microphone.js`, `room.js` (per-sample parts) | `listener.rs`                             |

2. Solver trait in `solver.rs`; `Waveguide` implements it and {{P11}} adds
   the 3D solver:

   ```rust
   pub trait Solver {
       fn set_shape(&mut self, frame: &[f64]);
       fn step_duration(&self) -> f64;
       fn step(&mut self, flow: f64, noise_at: f64, noise: f64) -> f64;
       fn field(&self, out: &mut [f64]) -> usize;
   }
   ```

3. Configuration. JavaScript builds one `Float64Array` and Rust reads it by
   index. Define the field list once in `src/engine/layout.js`
   (`RENDERER_CONFIG`, an array of names) and once in `config.rs`
   (constants with the same names and numbers); a test compares the two
   files as text. Fields: `sampleRate`, `sections`, `noseSections`,
   `blockSize`, `totalSamples`, the three seeds as `u32` values computed in
   JavaScript with `hashSeed` for exactly the strings the JavaScript classes
   use (`'<seed>:glottis'`, `'<seed>:noise'`, and any other found by
   `grep -n "createRandom\|createNoise" src/acoustics`), every `head.` value
   read by the ported files (`tenseness`, `breathiness`, `jitter`,
   `shimmer`, `aspirationLevel`, `glottalChink`, `vocalTractLength`,
   `fricationLevel`, `outputGain`, wall-loss values), the flags `piriform`
   and `teeth`, then variable-length parts with their lengths: nose areas
   (`noseShape(head).areas`), the piriform branch
   (`piriformBranch(sections, 16.5, head)`), and the resolved microphone and
   room numbers of step 7.
4. Frames. One frame describes the tract for one control block. Layout
   (`f64`, stride `16 + sections`): 0 `length`, 1 `velumArea`,
   2 `velumIndex`, 3 `frication.index`, 4 `frication.position`,
   5 `frication.area`, 6 `frication.gain`, 7 `frication.sibilance`,
   8 `frication.obstacle`, 9 `glottis.f0`, 10 `glottis.voicing`,
   11 `glottis.aspiration`, 12 `glottis.closure`, 13 `glottis.loudness`,
   14 and 15 zero (reserved), then `areas[0..sections]`. Put the same table
   in `layout.js` (`FRAME`) and `frame.rs`.
5. Exports in `crates/voice-simulator-wasm`:
   - `vs_renderer_new(config: u32, length: u32) -> i32` (handle or error);
   - `vs_renderer_render(handle, frames: u32, frame_count: u32, out: u32,
samples: u32) -> i32`: renders `samples` output samples (`f32`) starting
     at the renderer's position, using frame `k` for the `k`-th block that
     starts inside this call; returns the number written. Error when
     `frame_count` is smaller than the number of blocks that start in the
     call;
   - `vs_renderer_position(handle) -> u32`,
     `vs_renderer_field(handle, out: u32, capacity: u32) -> i32`,
     `vs_renderer_free(handle)`.
6. JavaScript side, `src/engine/rust-renderer.js`: class
   `RustVoiceRenderer(module, plan, options)` with the same public members
   as `VoiceRenderer` (`render(target)`, `renderAsync`, `position`,
   `totalSamples`, `done`, `duration`, `sampleRate`, `field()`). `render`
   computes, for every block start `p` (multiple of `blockSize`) inside the
   call, `sampleState(plan, p / sampleRate, state)` and `tractShape(...)`
   exactly as `#updateShape` does, writes the frames, calls
   `vs_renderer_render` and copies the samples out. Export the shared part
   of `#updateShape` from `voice.js` as a function so that both renderers
   call the same code. The constructor throws an error with
   `code = 'ENGINE_UNSUPPORTED'` for options Rust does not handle yet
   (`solver` other than `'waveguide'`, `device`).
7. Listener. `resolveMicrophone`, `resolveRoom`, `microphonePosition`,
   `microphoneDirection` and `reverberationTime` stay in JavaScript.
   `MicrophoneStage` and `Room`/`DelayNetwork` are built in Rust from the
   resolved numbers (list each number in `RENDERER_CONFIG`). The tail length
   is computed in JavaScript as today and passed as `totalSamples`.
8. `voice-simulator-cli render-job <file>`: reads a binary job (config
   array, frame array, sample count; little-endian `f64`), renders natively,
   prints the SHA-256 of the samples and the seconds used. Add
   `scripts/write-render-job.mjs <text> <tier> <out>` that writes such a
   job. This gives a native number to compare with WebAssembly.
9. Add the ids `solver.waveguide` and `source.lf` wherever {{P70}} expects
   a feature list, if that file exists; otherwise skip this step.

## Tests

`tests/rust-waveguide.test.js` (skipped without the binary, as in {{P09}};
`error(a, e) = sqrt(sum((a - e)^2) / sum(e^2))`):

- `biquad matches`: low-pass 3600 Hz, Q 0.54, rate 25 455; 4096 samples of
  `createNoise(1)`; error below 1e-9.
- `glottis matches`: 0.5 s at `dt = 1 / 46667`, control `{f0: 120, voicing:
1, aspiration: 0.1, closure: 0, loudness: 1}`, seed 1; error below 1e-6
  and the number of periods is equal.
- `waveguide matches`: 22 sections, a fixed area function (all 3 cm² except
  0.3 cm² at sections 14 to 16), unit impulse at step 0, 4096 steps; error
  below 1e-9.
- `render matches`: `'Hello world.'`, seed 1, tiers `minimal`, `low`,
  `medium`; the largest absolute sample difference is below 1e-4.
- `render with a room matches`: tier `minimal`, `room: 'studio'`,
  `microphone: {distance: 30}`; below 1e-4.
- `chunking does not change the audio`: the Rust renderer with chunk sizes
  1, 37, 1024 and the whole length gives bit-identical `Float32Array`s.
- `unsupported options are reported`: `solver: 'fdtd3d'` throws with
  `code === 'ENGINE_UNSUPPORTED'`.

`tests/engine-layout.test.js` (always runs): the names in `layout.js` equal
the names in `config.rs` and `frame.rs`, in order.

`tests/heavy/performance-rust-waveguide.test.js` (suite `performance` of
{{P02}}): the pangram of that suite, seed 1, each waveguide tier, JavaScript
and Rust, three runs, median; report `performance-rust-waveguide` with the
real-time factors, their ratio, and the share of time spent in JavaScript
frame preparation.

## Acceptance criteria

- [ ] `REQUIRE_WASM=1 node --test tests/rust-waveguide.test.js` passes; the
      measured errors are listed in the pull request.
- [ ] The heavy report shows, for `minimal`, `low` and `medium`, a Rust
      real-time factor not above the JavaScript one. The speed-up is
      recorded; if it is below 1.3, the pull request shows a profile that
      says where the time goes.
- [ ] `voice-simulator-cli render-job` prints the same SHA-256 as the
      WebAssembly render of the same job (native and wasm agree bit for bit).
- [ ] `npm run build:wasm -- --check-size` passes with the budget stated in
      the commit that raised it.
- [ ] With the binary deleted `npm test` passes (JavaScript only).
- [ ] `cargo test --workspace` and `cargo clippy --workspace --all-targets
-- -D warnings` exit with 0.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- The 3D solver and `sinuses.js`: {{P11}}. Threads: {{P12}}.
- Choosing Rust by default, the worker and the command-line flag: {{P13}}.
- Porting `sampleState`, `tractShape`, planning or G2P. The measured share
  of frame preparation goes into the report; {{P70}} decides about it.
- New physics. The port copies today's model; {{P21}} to {{P24}} change it
  later and {{P70}} keeps both engines equal.

## References

- Kelly, J. L., Lochbaum, C. C. (1962). Speech synthesis. Proceedings of the
  Fourth International Congress on Acoustics, paper G42.
- Fant, G., Liljencrants, J., Lin, Q. (1985). A four-parameter model of
  glottal flow. STL-QPSR 26(4), 1-13.
- Jangda, A. et al. (2019). Not so fast: analyzing the performance of
  WebAssembly vs. native code. USENIX ATC.
  https://www.usenix.org/conference/atc19/presentation/jangda
- Research notes, sections 1, 2 and 8:
  `docs/case-studies/issue-11/research/5-performance-and-physics.md`.
