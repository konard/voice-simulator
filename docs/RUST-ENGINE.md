# Rust engine

The voice simulator has a reference implementation in JavaScript (`src/`)
and an engine in Rust (`crates/`) that is compiled into one WebAssembly
file, `src/engine/voice-simulator.wasm`. The JavaScript code defines the
expected output; the Rust engine has to reproduce it, and the parity tests
check that it does. The package keeps working when no Rust tool is
installed: the file is optional and everything falls back to JavaScript.

So far the engine holds the random generator of
`src/random.js`, the band-limited resampler of `src/audio/resample.js`
(`resample` and `createStreamResampler`, issue 27) and the air flow of
`src/acoustics/aerodynamics.js` with `strouhalFrequency` of
`src/acoustics/voice.js` (`crates/voice-simulator-core/src/aerodynamics.rs`,
issue 35): mouth pressure, flow, turbulence source strength and the peak
frequency of the frication noise, and the whole waveguide voice renderer
of `src/acoustics/voice.js` with its glottis, noise sources, radiation,
output stage, microphone and room (issue 22, see
[Waveguide renderer](#waveguide-renderer-issue-22)), and the 3D
finite-difference time-domain solver of `src/acoustics/fdtd3d.js` with a
WebAssembly SIMD build (issue 23, see
[3D FDTD solver](#3d-fdtd-solver-issue-23)). The random generator
proved that every link of the chain works: workspace, build, loader, CI job
and parity tests.

## Layout

| Path                           | What it is                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| `Cargo.toml`, `Cargo.lock`     | The workspace (three members) and its locked dependencies                                  |
| `rust-toolchain.toml`          | The one exact stable compiler the build uses, with `rustfmt`, `clippy` and the wasm target |
| `crates/voice-simulator-core`  | The numerical code: `no_std`, no `unsafe`, no I/O, no threads, no clock                    |
| `crates/voice-simulator-wasm`  | The WebAssembly interface: plain `vs_*` exports over the core                              |
| `crates/voice-simulator-cli`   | The `voice-simulator-cli` binary (`std` only) for running the core from a terminal         |
| `scripts/build-wasm.mjs`       | `npm run build:wasm`: builds the wasm crate and copies it to `src/engine/`                 |
| `src/engine/wasm-loader.js`    | `loadEngineModule(source)`: loads the file in a page, a worker, Node.js, Bun and Deno      |
| `tests/rust-parity.test.js`    | Rust against JavaScript, value by value                                                    |
| `tests/rust-crates.test.js`    | The crate licence gate and the shape of the workspace                                      |
| `src/engine/layout.js`         | `RENDERER_CONFIG`, `FRAME` and `LISTENER`: the arrays JavaScript hands to the renderer     |
| `src/engine/rust-renderer.js`  | `RustVoiceRenderer`, `renderPlanRust` and `renderJob` (issue 22)                           |
| `tests/rust-waveguide.test.js` | The waveguide renderer and its parts against JavaScript (issue 22)                         |
| `crates/.../src/fdtd/`         | The 3D FDTD solver: kernel, SIMD kernel, packed model, solver (issue 23)                   |
| `src/engine/pack-model.js`     | `packVoxelModel`: the voxel model as one buffer for the Rust solver (issue 23)             |
| `tests/rust-fdtd.test.js`      | The 3D solver against JavaScript, the SIMD build and the loader fallback (issue 23)        |

The core crate may depend on `libm` only, and only `src/math.rs` may call
it (`sin`, `cos`, `exp`, `ln`, `pow`, `tanh`, `sqrt`, `floor`, `ceil`;
`round_half_up` is `Math.round` of JavaScript); every other file
calls `math::…`. A different libm could round a transcendental function
differently, so this keeps the choice in one place.

## Building

```sh
rustup toolchain install    # installs the toolchain of rust-toolchain.toml
npm run build:wasm          # or: node scripts/build-wasm.mjs
```

The script runs
`cargo build --release --locked --target wasm32-unknown-unknown -p voice-simulator-wasm`,
copies `target/wasm32-unknown-unknown/release/voice_simulator_wasm.wasm` to
`src/engine/voice-simulator.wasm` and prints its size and SHA-256:

```text
src/engine/voice-simulator.wasm: 93300 bytes
SHA-256: 0453c24c9a20e1d5c9e44f85e333ee4080f12b47fb67ad4fef57849be07ebe90
WASM_SIZE_BUDGET: 98304 bytes
```

(Rust 1.100.0 on x86_64 Linux. The build does not depend on the folder or
the machine: a copy of the repository in another directory gives the same
hash.)

| Switch         | Effect                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------- |
| `--check-size` | Exit with 1 when the file is larger than `WASM_SIZE_BUDGET`                                    |
| `--require`    | Exit with 1 when `cargo` is not installed; without it that case prints a note and exits with 0 |

Without `cargo` the script prints
`cargo not found: the JavaScript engine will be used`.

The file is git-ignored (`src/engine/*.wasm`) and never committed. It is in
the npm package only when it was built before `npm pack` or `npm publish`;
the release jobs download the file that the CI job `rust` built.

`WASM_SIZE_BUDGET` in `scripts/build-wasm.mjs` is the measured size rounded
up to the next 16 384 bytes. A change that makes the file larger than the
budget raises it to the new measured size rounded up the same way, and the
commit message states the measured size.

The command line tool:

```sh
cargo run -q -p voice-simulator-cli -- version
cargo run -q -p voice-simulator-cli -- random 1 3
```

`random <seed> <count>` prints one value per line as the 16 hexadecimal
digits of its `f64` bits. A seed made of digits (with an optional `-`) is a
number, reduced like `value >>> 0`; any other seed is hashed like a string
by `hashSeed`. The first three values for seed 1 are `3fe410fd5e600000`,
`3f66693920000000` and `3fe0e0d89d600000`, the bits of the first three
values of `createRandom(1)`.

## Interface rules

The wasm crate exports plain `#[no_mangle] pub extern "C"` functions. There
is no wasm-bindgen, no wasm-pack and no `wasm-opt`: no generated glue file,
no tool whose version has to match a library, one file that loads
everywhere, and a build whose output depends only on the pinned compiler.
The module imports nothing.

- Every export starts with `vs_`. Arguments and results are `u32`, `i32` or
  `f64` only: no strings, no structs.
- `vs_abi_version() -> u32` returns the interface version, now 2 (issue
  23 changed `vs_renderer_new` and the frame layout). Any
  breaking change of an export (removed, renamed, a different signature or
  meaning) raises it, together with `ENGINE_ABI_VERSION` in the loader.
- `vs_alloc(bytes: u32) -> u32` returns an offset aligned to 8, or 0 when
  the memory is exhausted. `vs_free(ptr: u32, bytes: u32)` frees it; `bytes`
  must be the number given to `vs_alloc`, and offset 0 is ignored.
- Arrays cross as (offset, length in elements) into the linear memory.
  State and coefficients are `f64`; audio output is `f32`.
- Objects are integer handles greater than 0.
- Errors are negative `i32` codes from the table below.
- Every call that can allocate can grow the memory, and growing it detaches
  every typed-array view of the old buffer. JavaScript creates its views
  again after each such call (`float64View(engine, pointer, count)` of the
  loader does that from `engine.memory.buffer`).

### Exports

| Export                                                             | Result                                                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `vs_abi_version() -> u32`                                          | 2                                                                                    |
| `vs_alloc(bytes) -> u32`                                           | Offset of a block aligned to 8, or 0                                                 |
| `vs_free(ptr, bytes)`                                              | Frees a block of `vs_alloc`                                                          |
| `vs_hash_seed_utf16(ptr, len) -> u32`                              | `hashSeed` of the `len` UTF-16 code units at `ptr`; traps on a bad range             |
| `vs_random_fill(seed, out, count) -> i32`                          | Writes `count` `f64` values of `createRandom(seed)` at `out`; 0 or error             |
| `vs_random_normal_fill(seed, out, count) -> i32`                   | The same for `randomNormal(createRandom(seed))`                                      |
| `vs_resample_length(len, from, to) -> i32`                         | `Math.round(len * to / from)`, the output length of `vs_resample`                    |
| `vs_resample(in, len, from, to, zc, out, outLen) -> i32`           | `resample` of the `len` `f32` samples at `in` into the `outLen` at `out`; 0 or error |
| `vs_resampler_new(from, to, zc) -> i32`                            | Handle of a `createStreamResampler(from, to, {zeroCrossings: zc})`                   |
| `vs_resampler_push(handle, in, len) -> i32`                        | `push` of `len` `f32` samples; the number of outputs waiting to be read              |
| `vs_resampler_flush(handle) -> i32`                                | `flush`; the number of outputs waiting to be read                                    |
| `vs_resampler_read(handle, out, count) -> i32`                     | Moves up to `count` waiting outputs (`f32`, oldest first) to `out`; how many         |
| `vs_resampler_held(handle) -> i32`                                 | `held()`: the input samples kept for the outputs still to come                       |
| `vs_resampler_free(handle) -> i32`                                 | Frees the resampler; 0 or `BAD_HANDLE`                                               |
| `vs_aero_reynolds(flow, area) -> f64`                              | `reynolds` of `aerodynamics.js`                                                      |
| `vs_aero_source_strength(dp, area, flow) -> f64`                   | `sourceStrength`                                                                     |
| `vs_aero_open_tract_strength(lung, area) -> f64`                   | `openTractStrength`                                                                  |
| `vs_aero_glottal_area(v, a, c, b, chink) -> f64`                   | `glottalArea({voicing: v, aspiration: a, closure: c}, b, chink)`                     |
| `vs_aero_strouhal_frequency(flow, area) -> f64`                    | `strouhalFrequency` of `voice.js`                                                    |
| `vs_aero_steady_flow(lung, g, c, out) -> i32`                      | Writes `[oralPressure, flow]` of `steadyFlow` at `out`; 0 or error                   |
| `vs_aero_run(dt, compliance, steps, count) -> i32`                 | Steps a new `Aerodynamics` in place (below); 0 or error                              |
| `vs_renderer_new(config, length, model, modelLength) -> i32`       | Handle of a renderer for `RENDERER_CONFIG` at `config` and a packed model (or 0, 0)  |
| `vs_renderer_render(h, frames, n, out, samples) -> i32`            | Renders `samples` `f32` samples into `out` with the `n` frames at `frames`; how many |
| `vs_renderer_position(handle) -> i32`                              | Samples rendered so far                                                              |
| `vs_renderer_field(handle, out, capacity) -> i32`                  | Writes the pressure of the oral, then the nasal sections; how many                   |
| `vs_renderer_free(handle) -> i32`                                  | Frees the renderer; 0 or `BAD_HANDLE`                                                |
| `vs_biquad_run(kind, f, q, rate, data, count) -> i32`              | A `Biquad` (0 low-pass, 1 high-pass, 2 band-pass) over `data` in place; 0 or error   |
| `vs_glottis_run(seed, params, data, count) -> i32`                 | A `Glottis` over the noise at `data` in place (13 parameters); periods or error      |
| `vs_radiation_run(area, rate, baffle, data, count) -> i32`         | A `Radiation` over the incident waves at `data` in place; 0 or error                 |
| `vs_waveguide_run(params, n, data, count) -> i32`                  | A `Waveguide` stepped by the glottal input at `data` in place; 0 or error            |
| `vs_stages_run(seed, sr, gain, band, rate, f, data, count) -> i32` | `NoiseSources` plus `OutputStage` over `data` in place; 0 or error                   |

The exports of the 3D solver (`vs_simd`, `vs_fdtd_*`) are listed in
[Solver exports](#solver-exports).

`vs_aero_run` steps a new `Aerodynamics` of `src/acoustics/aerodynamics.js`
`count` times by `dt` seconds over the `5 * count` `f64` values at `steps`:
each step reads `[lungPressure, glottalArea, constrictionArea, -, -]` and
writes `[flow, flowDerivative, oralPressure, glottalDrop, constrictionDrop]`
in place.

### Error codes

| Code | Name            | Meaning                                                                                                    |
| ---- | --------------- | ---------------------------------------------------------------------------------------------------------- |
| 0    | `OK`            | Success                                                                                                    |
| -1   | `NULL`          | The offset is 0 while the length is not                                                                    |
| -2   | `MISALIGNED`    | The offset is not a multiple of the element size                                                           |
| -3   | `OUT_OF_BOUNDS` | The range runs past the end of the linear memory                                                           |
| -4   | `NO_MEMORY`     | The engine could not allocate memory                                                                       |
| -5   | `BAD_HANDLE`    | The integer handle names no live object                                                                    |
| -6   | `BAD_ARGUMENT`  | A rate or a zero-crossing count that is not positive, or an output length that is not `vs_resample_length` |
|      |                 | A renderer configuration that does not parse, too few frames, or a frame the solver cannot take            |

A length of 0 is always accepted, whatever the offset.

### Loader

`loadEngineModule(source, {simd})` of `src/engine/wasm-loader.js` takes a
`WebAssembly.Module`, a `BufferSource`, a URL (or a string resolved against
the loader), or nothing, which means the files next to the loader. A
`file:` URL is read with `node:fs/promises` (imported only then), any other
with `fetch`. It resolves to `{ exports, memory, abiVersion, simd }`, or to
`null` when `WebAssembly` is missing, the file cannot be read or compiling
fails. It throws only when `vs_abi_version()` differs from
`ENGINE_ABI_VERSION`. `simd` tells whether the file is the SIMD build
(`vs_simd()`).

Without a source, `simd: 'auto'` (the default) tries
`voice-simulator-simd.wasm` first and loads `voice-simulator.wasm` when
that file is missing or `WebAssembly.compile` rejects it; `false` loads only
the scalar file; `true` only the SIMD file, and gives `null` when it cannot
be used. With a source, `true` (`false`) gives `null` when the source is
not (is) a SIMD build. There is no run-time detection inside WebAssembly,
hence two files.
There is no top-level `await` and no top-level import of a `node:` module.

## Waveguide renderer (issue 22)

`RustVoiceRenderer(module, plan, options)` of `src/engine/rust-renderer.js`
renders like `VoiceRenderer` with `solver: 'waveguide'` and has the same
public members (`render(target)`, `renderAsync`, `position`,
`totalSamples`, `done`, `duration`, `sampleRate`, `field()`), plus `free()`
for its engine memory and `prepareTime`, the milliseconds spent preparing
frames in JavaScript. `renderPlanRust(module, plan, options)` renders a
whole plan. Both are exported by the package, with `loadEngineModule`:

```js
import {
  loadEngineModule,
  prepareUtterance,
  renderPlanRust,
} from 'voice-simulator';

const engine = await loadEngineModule(); // null without the wasm file
const { plan, renderOptions } = prepareUtterance('Hello world.', {
  tier: 'minimal',
  seed: 1,
});
const samples = renderPlanRust(engine, plan, renderOptions);
```

JavaScript keeps what runs once per control block: it samples the plan and
shapes the tract with `blockShape` of `src/acoustics/voice.js` (the code
`VoiceRenderer` calls in `#updateShape`), resolves the microphone and the
room with `createListener`, and computes the tail length. Rust
(`crates/voice-simulator-core/src/`) runs everything per solver step and
per sample:

| File           | Port of                                                              |
| -------------- | -------------------------------------------------------------------- |
| `filters.rs`   | `filters.js`: `Biquad`, `Noise`                                      |
| `glottis.rs`   | `glottis.js`: `Glottis`, the LF waveform and the chink               |
| `radiation.rs` | `radiation.js`: `Radiation`, `radiationLoad`                         |
| `waveguide.rs` | `waveguide.js`: `Waveguide` with its nose, `piriformBranch`          |
| `losses.rs`    | `losses.js`: the viscothermal shelf filters and the wall constants   |
| `stages.rs`    | `voice.js`: `NoiseSources`, `OutputStage`                            |
| `renderer.rs`  | `voice.js`: `#step`, `#record`, `#finish` of `VoiceRenderer`         |
| `listener.rs`  | `microphone.js` and `room.js`: `MicrophoneStage`, `Room`, the delays |
| `solver.rs`    | the `Solver` trait the waveguide implements (the 3D solver later)    |
| `config.rs`    | `RENDERER_CONFIG`                                                    |
| `frame.rs`     | `FRAME`                                                              |

The constructor throws an Error with `code = 'ENGINE_UNSUPPORTED'` for
options the engine does not handle: a `solver` other than `'waveguide'`, a
WebGPU `device`, `source: 'folds'` (the two-mass vocal folds of
`folds.js`, not ported) and a `bandLimit` that is not above 0.

### Configuration

One `Float64Array` per renderer (`RENDERER_CONFIG` of
`src/engine/layout.js`, the same constants in `config.rs`): 31 header
values, then `NOSE_AREA_COUNT` nose areas (`noseShape(head).areas`), then
`LISTENER_LENGTH` listener values.

| Index | Name               | Index | Name                  |
| ----- | ------------------ | ----- | --------------------- |
| 0     | `SAMPLE_RATE`      | 14    | `VOCAL_TRACT_LENGTH`  |
| 1     | `SECTIONS`         | 15    | `FRICATION_LEVEL`     |
| 2     | `NOSE_SECTIONS`    | 16    | `OUTPUT_GAIN`         |
| 3     | `BLOCK_SIZE`       | 17    | `WALL_LOSS`           |
| 4     | `TOTAL_SAMPLES`    | 18    | `NASAL_LOSS`          |
| 5     | `GLOTTIS_SEED`     | 19    | `PHARYNX_WIDTH`       |
| 6     | `NOISE_SEED`       | 20    | `PIRIFORM` (0 or 1)   |
| 7     | `TENSENESS`        | 21    | `TEETH` (0 or 1)      |
| 8     | `BREATHINESS`      | 22    | `BAND_LIMIT` (0 none) |
| 9     | `JITTER`           | 23    | `PIRIFORM_INDEX`      |
| 10    | `SHIMMER`          | 24    | `PIRIFORM_AREA`       |
| 11    | `ASPIRATION_LEVEL` | 25    | `PIRIFORM_SECTIONS`   |
| 12    | `GLOTTAL_CHINK`    | 26    | `NOSE_AREA_COUNT`     |
| 13    | `LUNG_PRESSURE`    | 27    | `LISTENER_LENGTH`     |
|       |                    | 28    | `WALL_MASS`           |
|       |                    | 29    | `WALL_RESISTANCE`     |
|       |                    | 30    | `WALL_STIFFNESS`      |

There are two seeds, not three: `grep -n "createRandom\|createNoise"
src/acoustics` finds only `'<seed>:glottis'` (`Glottis`) and
`'<seed>:noise'` (`NoiseSources`); JavaScript passes `hashSeed` of each.

The listener values are `[stage count, stages...]`
(`src/engine/listener-layout.js`, `LISTENER` in `layout.js` and
`listener.rs`):

- microphone: `[1, gain, delay, fraction, size, directional, lowGain,
highGain, smoothing]` (9 values);
- room: `[2, size, tailDelay, tailGain, tapCount, delays[8], scales[8],
poles[8], tapDelays[tapCount], tapGains[tapCount]]` (29 values plus the
  taps).

### Frames

One frame per control block (`blockSize` samples, aligned to the absolute
sample position), `16 + sections` values (`FRAME` of `layout.js`, the same
constants in `frame.rs`): 0 `length`, 1 `velumArea`, 2 `velumIndex`, 3
`frication.index`, 4 `frication.position`, 5 `frication.area`, 6
`frication.gain`, 7 `frication.sibilance`, 8 `frication.obstacle`, 9
`glottis.f0`, 10 `glottis.voicing`, 11 `glottis.aspiration`, 12
`glottis.closure`, 13 `glottis.loudness`, 14 the lung pressure (Pa), 15
zero (reserved), then `areas[0..sections]`. `vs_renderer_render` uses frame
`k` for the `k`-th block that starts inside the call and fails with
`BAD_ARGUMENT` when there are fewer frames than blocks.

### Deviations from the plan of issue 22

- `Solver::step` takes a fourth argument, `transient`: the burst transient
  (a flow derivative) that `VoiceRenderer` injects at the frication
  junction since issue 35. Without it the plosive releases would differ.
- Frame field 14 is the lung pressure, not reserved:
  `VoiceRenderer` reads `state.lungPressure ?? head.lungPressure` per block
  for the air flow of issue 35, so it changes with the plan.
- Two seeds instead of three (above).
- `source: 'folds'` is refused with `ENGINE_UNSUPPORTED`, like the other
  solvers; the issue listed only `solver` and `device`, but the folds are a
  different glottal source that was not part of the port.
- Step 9 (the feature ids `solver.waveguide` and `source.lf`) was skipped:
  `src/engine/features.js` of issue 82 does not exist yet.

### Render jobs and the native CLI

`renderJob(plan, options)` gives the job of a whole utterance: little-endian
`f64` values `[config length, config..., frame count, frames..., sample
count]`. `scripts/write-render-job.mjs <text> <tier> <out> [--seed <seed>]`
writes one and, when the wasm file is built, prints the SHA-256 of its
WebAssembly render. `voice-simulator-cli render-job <file>` renders it
natively and prints the SHA-256 of the samples (`f32`, little-endian), the
sample count, the seconds and the real-time factor. Both hashes are equal:

```sh
cargo build --release -p voice-simulator-cli
node scripts/write-render-job.mjs "Hello world." minimal /tmp/job.bin
target/release/voice-simulator-cli render-job /tmp/job.bin
```

| Tier    | SHA-256 (WebAssembly and native)                                   | Native seconds | Native RTF |
| ------- | ------------------------------------------------------------------ | -------------- | ---------- |
| minimal | `85ef5dd3eb2c14195160dea7ff9753249df28adb38f86d497adeeee25a0241d0` | 0.029          | 0.021      |
| low     | `2f2582f751c08e913cd7b2bcc0e12450abc576b833ed43bd465c11c2ca402f13` | 0.069          | 0.050      |
| medium  | `947a973577d2676381959f9299e673a802a598156ca8b1992ef84d386d6ad0be` | 0.098          | 0.071      |

### Parity and speed

`REQUIRE_WASM=1 node --test tests/rust-waveguide.test.js` (Node.js 26,
x86_64 Linux) measured:

| Test                                    | Limit         | Measured                 |
| --------------------------------------- | ------------- | ------------------------ |
| biquad, relative RMS error              | 1e-9          | 0                        |
| glottis, relative RMS error             | 1e-6          | 1.5e-17, 59 periods each |
| radiation, relative RMS error           | 0             | 0                        |
| waveguide, relative RMS error           | 1e-9          | 2.0e-15                  |
| noise sources and output stage          | 1e-9          | 8.5e-17 and 5.3e-17      |
| render `minimal`, `low`, `medium`       | max diff 1e-4 | 0, 0, 1.7e-18            |
| render, `studio` room, microphone 30 cm | max diff 1e-4 | 0                        |
| chunks of 1, 37 and 1024 samples        | identical     | identical                |

The waveguide and `medium` differences come from `pow`: the shelf filters
of `losses.rs` (issue 36) design on a grid `250 * (top / 250) ** (i / 40)`,
and `libm::pow` (a port of fdlibm) differs from V8's `Math.pow` (glibc's
`pow` on Linux, 0 differences in 20 000 random pairs) by one ulp for a few
exponents. The other values are bit-identical.

`npm run build:wasm && npm run test:heavy -- --suite performance` renders
the pangram of the performance suite (3.5 s of audio) on every waveguide
tier, three runs each, median; the report is
[docs/reports/performance-rust-waveguide.md](reports/performance-rust-waveguide.md).
The Rust renderer is 1.5 to 2.0 times faster than JavaScript (`minimal`
2.01, `low` 1.56, `medium` 1.60), and 22 % to 51 % of its time is the frame
preparation that stays in JavaScript (`sampleState`, `tractShape`), so
that part, left to issue 82, now bounds the speed-up.

## 3D FDTD solver (issue 23)

`RustVoiceRenderer` and `renderPlanRust` also take `solver: 'fdtd3d'`, the
3D finite-difference time-domain solver of `src/acoustics/fdtd3d.js` that
the tiers `high`, `ultra`, `studio` and `reference` use:

```js
const engine = await loadEngineModule();
const { plan, renderOptions } = prepareUtterance('Hello.', {
  tier: 'high',
  seed: 1,
});
const samples = renderPlanRust(engine, plan, renderOptions);
```

JavaScript still builds the voxel model (`options.model`, or
`buildVoxelModel(head, {dx, microphone, enclosure, piriform, vallecula})`
as the `Fdtd3d` constructor does), packs it once with `packVoxelModel` of
`src/engine/pack-model.js` and hands it to `vs_renderer_new`, together with
what the constructor derives from the listening options (`fdtdListening`:
the output, the spherical boundary and the point the receiver cell is the
nearest free-air cell to). A WebGPU `device` still throws
`ENGINE_UNSUPPORTED`; the GPU path (`queueStep`, `flushSteps`) is not
ported.

| File                       | What it is                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------- |
| `fdtd/kernel.rs`           | `Grid`: `step` (what the solver runs), `step_scatter` (`#stepJs`) and `step_gather`    |
| `fdtd/kernel_simd.rs`      | `step` and `step_gather` with `f64x2` vectors of `core::arch::wasm32`, `simd128` only  |
| `fdtd/model.rs`            | The packed voxel model: `Model::unpack`, `Model::pack`, the same layout table as JS    |
| `fdtd/solver.rs`           | `Fdtd3d`, method by method in snake case, implementing the `Solver` trait of issue 22  |
| `src/engine/pack-model.js` | `packVoxelModel(model)`, `modelHeader(buffer)` and `fdtdListening(model, options)`     |
| `tests/rust-fdtd.test.js`  | The kernel, the SIMD build, the model, the solver and whole renders against JavaScript |

### Kernel

`Grid` holds `link_a`, `link_b` (`u32` cell indices, not the byte offsets of
`fdtd-kernel.js`), `velocity`, `damping`, `conductance`, `flux` (per link),
`pressure`, `divergence`, `keep`, `gain` (per cell, `f64`) and the incident
lists `incident_start`, `incident_link`, `incident_sign`. `step_scatter` is
the loop of `#stepJs` operation by operation. `step_gather` first computes
`velocity` and `flux` of every link, then for every cell starts with
`d = 0.0`, adds `sign * flux[l]` for its links in increasing link order and
sets `pressure = keep * pressure - gain * d`. Every cell sees the same
additions in the same order as in the scatter form (a sign of ±1 multiplies
exactly, and `d + -f` equals `d - f`), so the two give the same bits; the
Rust test `gather_equals_scatter` checks it on a random grid of
`Random::new(1)` with 500 cells and 1400 links over 200 steps, every array
bit for bit.

The solver steps with `Grid::step`: the scatter loop without the store to
`flux`, which nothing in the solver reads (the hand-written kernel of
`fdtd-kernel.js` keeps no flux either). The test `step_equals_scatter`
checks on the grids of `Random::new(1)` (500 cells, 1400 links) and
`Random::new(4)` (499 cells, 1399 links: odd counts for the SIMD tails)
that `step` leaves `flux` at zero and every other array bit for bit equal
to `step_scatter` over 200 steps. The plan of the issue had the solver step
with `step_gather`; measured on `high`, the gather reads every flux twice
and the incident lists once more, and was the slowest of the three forms
(see "Speed" below), so the solver takes the scatter form, which gives the
same bits.

The incident lists are padded: when no cell has more than `MAX_WIDTH` (8)
links, every list is filled up to the longest one with the extra link
index `links`, whose `flux` is always `+0.0`. A sum that starts at `+0.0`
is never `-0.0` and `x + 0.0` is `x`, so the padding changes no bit, and
the cell loop gets lists of one fixed length that the compiler unrolls.
A voxel cell has at most 6 neighbours (measured on `high`, `ultra` and
`studio` with `experiments/issue-23-cell-degrees.mjs`); a grid with a
longer list keeps the unpadded lists (`padded_gather_equals_scatter` and
`long_lists_are_not_padded` test both).

The SIMD forms compute two links and two cells per `f64x2` with
`f64x2_sub` and `f64x2_mul` only: no relaxed SIMD, no fused multiply-add,
so every lane rounds as the scalar code does. In `step` the two fluxes of a
vector go into `divergence` one link after the other, as the scalar loop
adds them; in `step_gather` the sum over the incident links of a cell
stays scalar and ordered. A scalar tail takes an odd count. The intrinsics
used are safe functions, so the crate keeps `#![forbid(unsafe_code)]`.

`vs_fdtd_kernel_new(links, cells)` gives a kernel for the parity tests and
for issue 24; `vs_fdtd_kernel_array(handle, which)` the offset of one of
its arrays (0 `link_a`, 1 `link_b`, 2 `velocity`, 3 `damping`, 4
`conductance`, 5 `flux`, 6 `pressure`, 7 `divergence`, 8 `keep`, 9 `gain`;
asking for 0 or 1 makes the next step build the incident lists again);
`vs_fdtd_kernel_steps(handle, count, form)` runs `count` steps in form 0
(`step_scatter`), 1 (`step_gather`) or 2 (`step`); another form gives
`BAD_ARGUMENT`. `vs_fdtd_kernel_free(handle)` frees it.

### Solver speed-ups that change no bit

- `bin_scale` searches precomputed thresholds (`bin_filled`, one per bin
  of the opening table, built in `Fdtd3d::new` from the same additions as
  the JavaScript comparison) instead of adding them up at every search.
- `update_links` keeps, per link, the last base of the wall damping and
  its `pow`; a link whose area and loss did not change between two shapes
  reuses the power instead of calling `math::pow` again (equal bits in,
  equal bits out).
- `math::sqrt`, `floor` and `ceil` use the `f64.sqrt`, `f64.floor` and
  `f64.ceil` instructions of WebAssembly. Stable Rust 1.100 reaches those
  only through the `f64` methods of `std` (`core::arch::wasm32::f64_sqrt`
  is unstable), so the core crate has a feature `std` that only links
  `std` for these three methods; the wasm crate turns it on, the core
  stays `no_std` without it and the CLI and the host tests use `libm`. Both
  are correctly rounded (IEEE 754 requires it of `sqrt`, and `floor` and
  `ceil` are exact), so the bits are the same; the render job check below
  compares the CLI and the WebAssembly render.

### Model

`packVoxelModel(model)` writes every property of the model that
`fdtd3d.js` reads (`grep -o "model\.[a-zA-Z]*" src/acoustics/fdtd3d.js |
sort -u`: `dx`, `opening`, `cells`, `links`, `openFaces`,
`boundaryAdmittance`, `enclosure`, `lengths`, `larynxTravel`, `sinuses`,
`landmarks`, `teeth`, plus `openMasks`) into one `ArrayBuffer`: a header of
14 `u32` words (magic `VSMD`, version 2, byte length, counts and flags),
then one
section per property, each starting at a multiple of 8 bytes. The layout
table is at the top of `pack-model.js` and of `fdtd/model.rs`.
`Model::pack` writes the same bytes back, which `vs_fdtd_model_repack`
exposes for the test `packs and unpacks a model`. Only the tract cells have
rows of the opening table (the JavaScript table is zero elsewhere), so the
model of a 40 cm room stays small.

### Configuration and frames

`RENDERER_CONFIG` gains `SOLVER` (31: 0 the waveguide, 1 the 3D solver,
`SOLVER_CODES` of `layout.js`), `FDTD_OUTPUT` (32: 0 the flow out of the
lips and nostrils, 1 the pressure at the receiver cell), `FDTD_SPHERICAL`
(33) and `MICROPHONE_X`, `_Y`, `_Z` (34 to 36); `HEADER` is 37.
`vs_renderer_new(config, length, model, modelLength)` takes the packed
model (0 and 0 for the waveguide).

A frame gains the incisors: field 15 `TEETH` is 1 when the shape has
`shape.teeth`, field 16 `EXTRA` is the number of values after the areas
(`FRAME_EXTRA_VALUES`, 1), and after the areas comes `shape.teeth.gap`
(cm), the only number of `shape.teeth` that `#applyTeeth` and
`#teethSlot` read. `STRIDE` is 17 and a frame has `17 + sections + 1`
values.

A render job (`renderJob`, `scripts/write-render-job.mjs`) is
`[config length, config..., model length in bytes, model..., frame count,
frames..., sample count]`; the model length is 0 for the waveguide.

### Solver exports

| Export                                                    | Result                                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `vs_simd() -> u32`                                        | 1 in the SIMD build, 0 in the scalar one                                                    |
| `vs_fdtd_kernel_new(links, cells) -> i32`                 | Handle of a `Grid`, or `BAD_ARGUMENT` above 2^28 links or cells                             |
| `vs_fdtd_kernel_array(handle, which) -> u32`              | Offset of array `which` (above), 0 for a bad handle or number                               |
| `vs_fdtd_kernel_steps(handle, count, form) -> i32`        | `count` steps of form 0, 1 or 2; 0, `BAD_HANDLE`, or `BAD_ARGUMENT` (form, or missing cell) |
| `vs_fdtd_kernel_free(handle) -> i32`                      | Frees the kernel; 0 or `BAD_HANDLE`                                                         |
| `vs_fdtd_solver_new(options, model, modelLength) -> i32`  | Handle of an `Fdtd3d` for 10 option values and a packed model                               |
| `vs_fdtd_solver_set_nose(handle, areas, count) -> i32`    | `setNose(areas)`                                                                            |
| `vs_fdtd_solver_set_shape(handle, frame, length) -> i32`  | `setShape` from one frame                                                                   |
| `vs_fdtd_solver_step_duration(handle) -> f64`             | `stepDuration` for the last shape (s), NaN for a bad handle                                 |
| `vs_fdtd_solver_steps(handle, inputs, count, out) -> i32` | `count` steps with `[flow, noisePosition, noise, transient]` each; the outputs to `out`     |
| `vs_fdtd_solver_field(handle, out, capacity) -> i32`      | The pressure of every cell; how many                                                        |
| `vs_fdtd_solver_free(handle) -> i32`                      | Frees the solver; 0 or `BAD_HANDLE`                                                         |
| `vs_fdtd_model_repack(model, length, out, cap) -> i32`    | Unpacks a packed model and packs it again into `out`; its length, or `BAD_ARGUMENT`         |

The options of `vs_fdtd_solver_new` are the output (0 flow, 1 microphone),
the spherical boundary (0 or 1), the receiver target x, y and z (cm),
`wallLoss`, `nasalLoss`, `glottalChink` (mm²), `vocalTractLength` (cm) and
`lengthScale` (`RENDERER_CONFIG.LENGTH_SCALE` in a render).
Version 2 of the model (issue 40) adds the opening `origin`, `larynxTravel`
and the pouch openings of every place of the glottis
(`header::PLACES`, `header::POUCH_LINKS`), which the moving source plane
of `Fdtd3d` uses.

### Deviations from the plan of issue 23

- The frame fields of the incisors are 15 and 16, not 14 and 15: field 14
  carries the lung pressure since issue 22 (see above).
- The kernel tests copy the coefficients after `setNose` and `setShape` of
  `a`. The coefficients that the `Fdtd3d` constructor leaves belong to no
  shape (a conductance of 1 next to sinus cells of fill 1/12 makes the
  field grow to Infinity within 2000 steps, so nothing would be compared),
  and every render calls `setShape` before its first step.
- The render in a 40 cm enclosure compares the first 2400 samples (50 ms):
  the room has about 60 000 cells and the whole render takes minutes, and
  its first samples run every part of the room solver and the listener.
- The incident lists are padded (above). Reordering cells or links stays
  out of scope; padding changes no order of additions.
- The solver steps with `Grid::step` (scatter without `flux`), not
  `step_gather` (above); the three forms give the same bits.
- The core crate gained the feature `std` for three correctly rounded
  instructions (above); without it the crate is `no_std` as before.

### Parity, render jobs and speed

`REQUIRE_WASM=1 node --test tests/rust-fdtd.test.js` (Node.js 26, x86_64
Linux) measured:

| Test                                        | Limit             | Measured          |
| ------------------------------------------- | ----------------- | ----------------- |
| kernel against JavaScript, forms 0, 1, 2    | equal under `===` | equal, 2000 steps |
| SIMD against scalar                         | equal under `===` | equal, 2000 steps |
| packs and unpacks a model                   | equal             | equal             |
| solver, `aː`, relative RMS difference       | 1e-9              | 4.5e-16           |
| render `'Hello.'`, `high`                   | max diff 1e-4     | 0                 |
| the same with `teeth: false`                | max diff 1e-4     | 1.1e-19           |
| the same in a 40 cm enclosure, 2400 samples | max diff 1e-4     | 0                 |
| loader falls back to scalar                 | `simd === false`  | `simd === false`  |

A render job of the 3D solver renders natively with the same bits:

```sh
npm run build:wasm
cargo build --release -p voice-simulator-cli
node scripts/write-render-job.mjs "Hello world." high /tmp/job-high.bin
target/release/voice-simulator-cli render-job /tmp/job-high.bin
```

printed (x86_64 Linux, Node.js 26):

| Renderer                         | SHA-256 of the samples (65 854)                                    | Seconds |
| -------------------------------- | ------------------------------------------------------------------ | ------- |
| scalar WebAssembly (the script)  | `7cc54f80e33924edc977b387efb83e0cf82b0fbc01d1af7fe293a9a17772ac1b` | 1.26    |
| `voice-simulator-cli render-job` | `7cc54f80e33924edc977b387efb83e0cf82b0fbc01d1af7fe293a9a17772ac1b` | 0.89    |

The CLI takes `sqrt`, `floor` and `ceil` from `libm`, the WebAssembly
build from the instructions (above), and the hashes are equal.
`tests/rust-render-job.test.js` checks the tiers `minimal` to `high` the
same way when the CLI is built.

#### Speed

```sh
npm run build:wasm
HEAVY=1 REQUIRE_WASM=1 node --test --test-timeout=3600000 tests/heavy/performance-rust-fdtd.test.js
```

renders the pangram of the heavy suite `performance` three times per
renderer, interleaved, and writes
[reports/performance-rust-fdtd.md](reports/performance-rust-fdtd.md) (and
`.json`). Measured on a shared x86_64 Linux machine (6 cores, load average
about 5), Node.js 26.13, Rust 1.100.0:

| Tier   | dx (cm) | JavaScript RTF | Rust scalar RTF | Rust SIMD RTF | Speed-up | SIMD ratio | Max abs diff |
| ------ | ------- | -------------- | --------------- | ------------- | -------- | ---------- | ------------ |
| high   | 1       | 1.3699         | 0.9582          | 0.9036        | 1.43×    | 1.060×     | 0, 0         |
| ultra  | 0.6     | 6.9878         | 6.2683          | 5.7286        | 1.11×    | 1.094×     | 0, 0         |
| studio | 0.5     | 12.5854        | 11.2744         | 10.4155       | 1.12×    | 1.082×     | 0, 0         |

JavaScript is `VoiceRenderer` with its hand-written WebAssembly kernel
(`kernel: 'wasm'`, the default). The Rust scalar renderer is faster on
every tier, and the SIMD build is 1.060 times faster than the scalar one on
`high`: below the 1.15 the issue asks for, so `SHIP_SIMD` in
`scripts/build-wasm.mjs` stays `false`. `npm run build:wasm` still builds
and size-checks the SIMD file (192 648 bytes) and the parity tests still
run it, but it is not copied to `src/engine/`, and `simd: 'auto'` loads the
scalar file.

How the scalar build got below JavaScript, measured with `TIER=high
RUNS=5 node experiments/issue-23-render-speed.mjs <builds>` on the same
pangram (the Rust RTF over the JavaScript RTF of the same run, the least
RTF of 4 or 5 runs each):

| Build                                                           | Rust / JavaScript |
| --------------------------------------------------------------- | ----------------- |
| solver with `step_gather`, `libm` square root                   | 1.16              |
| plus the `bin_scale` thresholds and the cached damping powers   | 1.11              |
| plus `Grid::step_scatter` instead of `step_gather`              | 0.96 to 1.01      |
| plus the `f64.sqrt`, `f64.floor` and `f64.ceil` instructions    | 0.94              |
| plus `Grid::step` (no store to `flux`), the shipped scalar file | 0.90 to 0.94      |
| the same, SIMD build                                            | 0.86              |

`experiments/issue-23-kernel-speed.mjs` (`FORM=0`, `1`, `2`) times the
kernel forms alone and `experiments/issue-23-micro-kernel.mjs` a bare Rust
loop against the hand-written kernel, which separates the code generation
of the compiler from the solver around it.

## Choosing an engine (issue 25)

`createEngine(options)` of `src/engine/index.js` loads the engine that
renders, and every renderer, `synthesize`, `synthesizeAsync`,
`synthesizeStream`, `renderPlan`, `renderPlanAsync`, `measureAudioTier`,
`benchmarkAudioTiers`, the CLI (`--engine`, `--threads`), the HTTP server
(`createVoiceServer({engine})`, `engine=js` per request) and the worker
take the same `engine` option:

- `'auto'` (the default): the Rust engine when `voice-simulator.wasm`
  loads, else JavaScript with `engine.reason` saying why ("this runtime has
  no WebAssembly", "the Rust engine (voice-simulator.wasm) is missing or
  does not compile"). A render the engine does not support (`solver:
'fdtd2d'` or another registered solver, a WebGPU `device`, `source:
'folds'`, `bandLimit <= 0`) runs in JavaScript too, with the reason in
  `renderer.fallbackReason`.
- `'rust'`: the Rust engine, or an Error with
  `code === 'ENGINE_UNAVAILABLE'` when it does not load. Renders it does not
  support still fall back to JavaScript, with `fallbackReason`.
- `'js'`: the JavaScript renderer; no WebAssembly is read or compiled.

The engine object is `{name: 'rust' | 'js', requested, simd, threads,
reason}` with `createRenderer(plan, renderOptions)`, `supports(options)`,
`features()` and `close()`; an engine object can be passed wherever an
`engine` name can. Engines from the default files are cached by
`engine|threads|simd`, so the file is read and compiled once; one from a
`source` is not cached. `threads` (default 1, a positive integer or
`'auto'`) is accepted and checked but the engine renders on one thread
until issue 24; `simd` (default `'auto'`) goes to the loader.

`getEngine(options)` is createEngine without a promise. In Node.js, Bun
and Deno (where `process.getBuiltinModule` exists) it reads and compiles
the file synchronously (`loadEngineModuleSync`), so the synchronous
`synthesize` and `renderPlan` use Rust under `'auto'`. In a browser
WebAssembly of this size has to load asynchronously: `getEngine('auto')`
gives the cached engine of an earlier `await createEngine()`, else
JavaScript (not cached, so a later createEngine still loads Rust), and
`getEngine('rust')` throws `ENGINE_UNAVAILABLE`. The asynchronous
functions and the worker call createEngine themselves.

Rust and JavaScript compute in the same order (see
[Determinism rules](#determinism-rules)), and the parity tests allow a
difference of up to 1e-4 per sample (parity class B): an output that has to
stay byte-stable across machines and versions (golden files, hashes) uses
`engine: 'js'`. On the CLI `--engine js` gives the same bytes as before
issue 25; `benchmark` prints the engine first (`engine: rust`, or
`"engine":"rust"` with `--json`).

### Worker

`voice-simulator/worker` (`src/engine/worker.js`) is a module worker that
renders off the main thread; its logic is `createWorkerHandler(post)` of
`src/engine/worker-protocol.js`, which the tests drive without a worker.
The example app's `synth-worker.js` is one line,
`import '../../../../src/engine/worker.js';`.

```javascript
const worker = new Worker(new URL('voice-simulator/worker', import.meta.url), {
  type: 'module',
});
worker.postMessage({ type: 'engine' }); // -> {type: 'engine', name: 'rust', simd, threads, reason}
```

| Message in                                                                                                                          | Answer                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `{type: 'engine', engine?, threads?, simd?}`                                                                                        | `{type: 'engine', name, simd, threads, reason}`; `{type: 'engine', name: null, error}` when `'rust'` cannot load                       |
| `{type: 'benchmark', head, gpu?, engine?, threads?, simd?}`                                                                         | `{type: 'benchmark', level, loads, measured, gpu, gpuLoads}`                                                                           |
| `{type: 'speak', id, ipa, lang, head, seed, tier, auto, chunkSize, microphone?, room?, enclosure?, gpu?, engine?, threads?, simd?}` | `{type: 'start', id, sampleRate, solver, gpu, totalSamples, model?, engine, fallbackReason}`, then `chunk`s and `end` (or `overload`s) |
| `{type: 'cancel', id}`                                                                                                              | the utterance stops; no `end`                                                                                                          |

Out per utterance: `{type: 'overload', id, from, level, load}` (auto mode:
the tier could not keep up and the utterance restarts on `level`),
`{type: 'chunk', id, start, samples, field, load}` (the samples and the RMS
pressure field of the chunk), `{type: 'end', id, load}` and
`{type: 'error', id, message}`. `engine` in `start` is the engine that
renders this utterance (`'js'` on WebGPU, for example, with the reason in
`fallbackReason`).

The loader names the file with the literal
`new URL('./voice-simulator.wasm', import.meta.url)`, so Vite, webpack and
Rollup copy it next to the worker bundle and rewrite the URL; the app's
`npm run example:web:build` emits `assets/voice-simulator-<hash>.wasm`.
Where the request fails (blocked, offline, an old browser) the worker
renders in JavaScript and says why. The app's settings panel shows
"Engine: Rust", "Engine: Rust (SIMD)" or "Engine: JavaScript (<reason>)"
and has the setting Engine: Auto, Rust or JavaScript.

## Determinism rules

The same input, seed and options give the same samples on every runtime.
Review checks these rules:

- no `mul_add` (a fused multiply-add rounds once, `a * b + c` twice);
- no `-C target-cpu=native`, no fast-math flags, no relaxed SIMD;
- transcendental functions only through `math.rs`;
- no `HashMap` iteration in numeric code (its order is random);
- no NaN produced on purpose (WebAssembly does not fix the bits of a NaN).

The scalar `f64` build defines the reference output; a faster variant
(SIMD, threads) must match it under the class of the code it changes.

## Parity classes

Each ported function has a class, stated by the issue that ports it.

- **Class A, bit-identical.** Code that uses only `+ - * /`, `sqrt` and
  integers. These operations are correctly rounded in IEEE 754, in
  JavaScript and in WebAssembly, so Rust gives the same bits when it does
  the same operations in the same order. The test compares every value with
  `Object.is`. The random generator is class A.
- **Class B, tolerance.** Anything else, for example code that calls `sin`
  or `exp`, whose last bit may differ between libm and the JavaScript
  engine. The measure is the relative RMS error
  `sqrt(sum((a - e)^2) / sum(e^2))` of the Rust output `a` against the
  JavaScript output `e`, with the limit stated by the issue that ports the
  code. The resampler is class B with a limit of `1e-6` (issue 27); on
  Node.js 26, Bun 1.4.4 and Deno 2.9.7 the measured error is 0, every sample is
  bit-identical (`node experiments/issue-27-resample-parity.mjs`).

| Module (issue)         | Class |
| ---------------------- | ----- |
| `random.rs`            | A     |
| `resample.rs` (27)     | B     |
| `aerodynamics.rs` (35) | A     |
| `filters.rs` (22)      | B     |
| `glottis.rs` (22)      | B     |
| `radiation.rs` (22)    | B     |
| `waveguide.rs` (22)    | B     |
| `stages.rs` (22)       | B     |
| `renderer.rs` (22)     | B     |
| `listener.rs` (22)     | B     |
| `fdtd/kernel.rs` (23)  | A     |
| `fdtd/kernel_simd.rs`  | A     |
| `fdtd/model.rs` (23)   | A     |
| `fdtd/solver.rs` (23)  | B     |

The lag of the mouth pressure in `Aerodynamics::step` uses `lag_factor`
(`lagFactor` in JavaScript), a rational form of 1 - exp(-x), instead of
`exp`: JavaScriptCore and V8 round `Math.exp` differently, so `exp` gave
Bun and Node.js different samples, and without it the step is class A. All
48 000 values of the closure and release are bit-identical
(`node experiments/issue-35-rust-airflow-parity.mjs`).

## Tests

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
npm run build:wasm
REQUIRE_WASM=1 node --test tests/rust-parity.test.js tests/rust-waveguide.test.js tests/rust-fdtd.test.js tests/engine-layout.test.js
cargo build --release -p voice-simulator-cli
REQUIRE_WASM=1 REQUIRE_CLI=1 node --test tests/rust-render-job.test.js
bun test tests/rust-parity.test.js tests/rust-fdtd.test.js
deno test -A tests/rust-parity.test.js tests/rust-fdtd.test.js
```

Without the file, `tests/rust-parity.test.js` reports its tests as skipped
with the reason. `REQUIRE_WASM=1` (set in CI after the build) turns a
missing file into an error, so a broken build cannot pass as a skip.

`tests/engine-layout.test.js` always runs: it reads `config.rs`,
`frame.rs` and `listener.rs` as text and checks that their constants have
the names and numbers of `layout.js`. `tests/rust-render-job.test.js` needs
the wasm file for its render and the native binary (found through
`VOICE_SIMULATOR_CLI`, `target/release` or `target/debug`) for the SHA-256
check; `REQUIRE_CLI=1` turns a missing binary into an error.

`tests/rust-crates.test.js` runs without a Rust toolchain: every
`[[package]]` of `Cargo.lock` is a workspace crate or a key of
`scripts/rust-allowed-crates.json`, which maps each allowed crate to its
licence (`{"libm": "MIT"}`). A new crate is added there in the same pull
request that adds it to a `Cargo.toml`, and only with a permissive licence.
`npm run check:policy` checks the licences of all crates as well, through
`cargo metadata`.

## CI

The job `rust` of `release.yml` runs the commands above (with
`node scripts/build-wasm.mjs --require --check-size`) and uploads the file
as the artifact `voice-simulator-wasm`; it also builds the native CLI and
runs the parity tests with `REQUIRE_WASM=1` and `REQUIRE_CLI=1`. The heavy
workflow builds the file for the suites `performance` and `all`, which run
`tests/heavy/performance-rust-waveguide.test.js` and
`tests/heavy/performance-rust-fdtd.test.js` with `REQUIRE_WASM=1`. `release` and `instant-release`
need it and download the artifact into `src/engine/` before they publish.
In `example-app.yml` the job `wasm-build` does the same build and upload,
and `web-build`, `desktop-package`, `android-build` and `ios-build`
download the file before they build. Both jobs use the `rustup` of the
runner image: `rustup toolchain install` without arguments installs the
toolchain of `rust-toolchain.toml` (rustup 1.29 warns that the automatic
install of `rustup show` is deprecated), and `rustup show` then prints the
active versions into the log.
