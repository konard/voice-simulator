# Rust engine

The voice simulator has a reference implementation in JavaScript (`src/`)
and an engine in Rust (`crates/`) that is compiled into one WebAssembly
file, `src/engine/voice-simulator.wasm`. The JavaScript code defines the
expected output; the Rust engine has to reproduce it, and the parity tests
check that it does. The package keeps working when no Rust tool is
installed: the file is optional and everything falls back to JavaScript.

So far the engine holds three algorithms: the random generator of
`src/random.js`, the band-limited resampler of `src/audio/resample.js`
(`resample` and `createStreamResampler`, issue 27) and the air flow of
`src/acoustics/aerodynamics.js` with `strouhalFrequency` of
`src/acoustics/voice.js` (`crates/voice-simulator-core/src/aerodynamics.rs`,
issue 35): mouth pressure, flow, turbulence source strength and the peak
frequency of the frication noise. The random generator proves that every
link of the chain works: workspace, build, loader, CI job and parity tests.

## Layout

| Path                          | What it is                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| `Cargo.toml`, `Cargo.lock`    | The workspace (three members) and its locked dependencies                                  |
| `rust-toolchain.toml`         | The one exact stable compiler the build uses, with `rustfmt`, `clippy` and the wasm target |
| `crates/voice-simulator-core` | The numerical code: `no_std`, no `unsafe`, no I/O, no threads, no clock                    |
| `crates/voice-simulator-wasm` | The WebAssembly interface: plain `vs_*` exports over the core                              |
| `crates/voice-simulator-cli`  | The `voice-simulator-cli` binary (`std` only) for running the core from a terminal         |
| `scripts/build-wasm.mjs`      | `npm run build:wasm`: builds the wasm crate and copies it to `src/engine/`                 |
| `src/engine/wasm-loader.js`   | `loadEngineModule(source)`: loads the file in a page, a worker, Node.js, Bun and Deno      |
| `tests/rust-parity.test.js`   | Rust against JavaScript, value by value                                                    |
| `tests/rust-crates.test.js`   | The crate licence gate and the shape of the workspace                                      |

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
src/engine/voice-simulator.wasm: 33260 bytes
SHA-256: 2a0f7a7bc2760b5e211f51901972698ea82e7c8b1790becb6a789f3bc1f54b8c
WASM_SIZE_BUDGET: 49152 bytes
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
- `vs_abi_version() -> u32` returns the interface version, now 1. Any
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

| Export                                                   | Result                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `vs_abi_version() -> u32`                                | 1                                                                                    |
| `vs_alloc(bytes) -> u32`                                 | Offset of a block aligned to 8, or 0                                                 |
| `vs_free(ptr, bytes)`                                    | Frees a block of `vs_alloc`                                                          |
| `vs_hash_seed_utf16(ptr, len) -> u32`                    | `hashSeed` of the `len` UTF-16 code units at `ptr`; traps on a bad range             |
| `vs_random_fill(seed, out, count) -> i32`                | Writes `count` `f64` values of `createRandom(seed)` at `out`; 0 or error             |
| `vs_random_normal_fill(seed, out, count) -> i32`         | The same for `randomNormal(createRandom(seed))`                                      |
| `vs_resample_length(len, from, to) -> i32`               | `Math.round(len * to / from)`, the output length of `vs_resample`                    |
| `vs_resample(in, len, from, to, zc, out, outLen) -> i32` | `resample` of the `len` `f32` samples at `in` into the `outLen` at `out`; 0 or error |
| `vs_resampler_new(from, to, zc) -> i32`                  | Handle of a `createStreamResampler(from, to, {zeroCrossings: zc})`                   |
| `vs_resampler_push(handle, in, len) -> i32`              | `push` of `len` `f32` samples; the number of outputs waiting to be read              |
| `vs_resampler_flush(handle) -> i32`                      | `flush`; the number of outputs waiting to be read                                    |
| `vs_resampler_read(handle, out, count) -> i32`           | Moves up to `count` waiting outputs (`f32`, oldest first) to `out`; how many         |
| `vs_resampler_held(handle) -> i32`                       | `held()`: the input samples kept for the outputs still to come                       |
| `vs_resampler_free(handle) -> i32`                       | Frees the resampler; 0 or `BAD_HANDLE`                                               |
| `vs_aero_reynolds(flow, area) -> f64`                    | `reynolds` of `aerodynamics.js`                                                      |
| `vs_aero_source_strength(dp, area, flow) -> f64`         | `sourceStrength`                                                                     |
| `vs_aero_open_tract_strength(lung, area) -> f64`         | `openTractStrength`                                                                  |
| `vs_aero_glottal_area(v, a, c, b, chink) -> f64`         | `glottalArea({voicing: v, aspiration: a, closure: c}, b, chink)`                     |
| `vs_aero_strouhal_frequency(flow, area) -> f64`          | `strouhalFrequency` of `voice.js`                                                    |
| `vs_aero_steady_flow(lung, g, c, out) -> i32`            | Writes `[oralPressure, flow]` of `steadyFlow` at `out`; 0 or error                   |
| `vs_aero_run(dt, compliance, steps, count) -> i32`       | Steps a new `Aerodynamics` in place (below); 0 or error                              |

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

A length of 0 is always accepted, whatever the offset.

### Loader

`loadEngineModule(source)` of `src/engine/wasm-loader.js` takes a
`WebAssembly.Module`, a `BufferSource`, a URL (or a string resolved against
the loader), or nothing, which means
`new URL('./voice-simulator.wasm', import.meta.url)`. A `file:` URL is read
with `node:fs/promises` (imported only then), any other with `fetch`. It
resolves to `{ exports, memory, abiVersion }`, or to `null` when
`WebAssembly` is missing, the file cannot be read or compiling fails. It
throws only when `vs_abi_version()` differs from `ENGINE_ABI_VERSION`.
There is no top-level `await` and no top-level import of a `node:` module.

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
REQUIRE_WASM=1 node --test tests/rust-parity.test.js
bun test tests/rust-parity.test.js
deno test -A tests/rust-parity.test.js
```

Without the file, `tests/rust-parity.test.js` reports its tests as skipped
with the reason. `REQUIRE_WASM=1` (set in CI after the build) turns a
missing file into an error, so a broken build cannot pass as a skip.

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
as the artifact `voice-simulator-wasm`. `release` and `instant-release`
need it and download the artifact into `src/engine/` before they publish.
In `example-app.yml` the job `wasm-build` does the same build and upload,
and `web-build`, `desktop-package`, `android-build` and `ios-build`
download the file before they build. Both jobs use the `rustup` of the
runner image: `rustup toolchain install` without arguments installs the
toolchain of `rust-toolchain.toml` (rustup 1.29 warns that the automatic
install of `rustup show` is deprecated), and `rustup show` then prints the
active versions into the log.
