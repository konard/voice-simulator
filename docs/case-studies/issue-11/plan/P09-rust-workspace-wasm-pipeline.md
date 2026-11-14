---
id: P09
title: Rust workspace and WebAssembly build pipeline
type: Feature
milestone: M1
blocked_by: []
requirements: [R2, R12, R19]
---

## Goal

Add a Rust workspace with three crates, a build that turns it into one
WebAssembly file, a small hand-written JavaScript loader, a CI job, and a
parity-test harness. The only algorithm ported in this issue is the random
generator of `src/random.js`; it proves that every link of the chain works.
The package must keep working when no Rust tool is installed.

## Why

The issue asks for "a Rust based background worker by default" that is "super
fast on CPUs" (R2, R12). Every later port ({{P10}}, {{P11}}, {{P12}},
{{P65}}) needs the same folders, build command, calling convention and way
of proving that Rust gives the same numbers as JavaScript. Fixing these once
keeps the ports small and stops each of them from inventing its own rules.

## Current state

- There is no Rust: `ls Cargo.toml crates rust-toolchain.toml` fails.
- One WebAssembly kernel exists. `experiments/wasm/fdtd-kernel.wat` (text
  format, one exported memory, one exported function `step` with eleven
  `i32` parameters) is built by hand with
  `npm install --no-save wabt && node experiments/wasm/build.mjs`; the script
  prints base64 that a person pastes into `src/acoustics/fdtd-kernel.js` as
  the constant `WASM` (444 characters, 332 bytes). The module is compiled
  once with `new WebAssembly.Module`; on failure `createKernel` returns
  `null` and `Fdtd3d` uses its JavaScript loop. No CI job builds it.
- `package.json`: `"files": ["bin/", "src/", "CHANGELOG.md", "LICENSE",
"README.md"]`, no build step, `engines.node >= 20`, licence Unlicense.
  Tests run on Node.js, Bun and Deno (`release.yml`, job `test`).
- `src/random.js`: `hashSeed(value)` returns `value >>> 0` for a finite
  number, otherwise FNV-1a over the UTF-16 code units of `String(value)`
  (start `0x811c9dc5`, `hash ^= unit`, `hash = Math.imul(hash, 0x01000193)`).
  `createRandom(seed)` is mulberry32: `state = hashSeed(seed) || 0x9e3779b9`;
  per call `state = (state + 0x6d2b79f5) >>> 0`,
  `v = Math.imul(state ^ (state >>> 15), state | 1)`,
  `v ^= v + Math.imul(v ^ (v >>> 7), v | 61)`,
  result `((v ^ (v >>> 14)) >>> 0) / 4294967296`.
  `randomNormal(random)` adds four values left to right and returns
  `(sum - 2) * Math.sqrt(3)`.
- Publishing jobs in `release.yml`: `release` and `instant-release`. The app
  is built in `example-app.yml` (jobs `web-build`, `desktop-package`,
  `android-build`, `ios-build`). The workflow rules listed in {{P02}} apply
  to every new job.

## What to do

1. Workspace. Root `Cargo.toml` with `[workspace]`, `resolver = "2"`, members
   `crates/voice-simulator-core`, `crates/voice-simulator-wasm`,
   `crates/voice-simulator-cli`; `[workspace.package]` with
   `edition = "2021"`, `license = "Unlicense"`, `publish = false`;
   `[profile.release]` with `opt-level = 3`, `lto = "fat"`,
   `codegen-units = 1`, `panic = "abort"`, `strip = true`. Commit
   `Cargo.lock`. Add `/target/` and `src/engine/*.wasm` to `.gitignore`.
2. `rust-toolchain.toml`: `channel` = one exact stable version (the newest
   stable on the day of the work, written as a number, never `stable`),
   `components = ["rustfmt", "clippy"]`,
   `targets = ["wasm32-unknown-unknown"]`.
3. `crates/voice-simulator-core`: `#![no_std]`, `extern crate alloc`,
   `#![forbid(unsafe_code)]`. No I/O, no threads, no clock. Its only
   dependency may be `libm`, used only inside `src/math.rs` (`sin`, `cos`,
   `exp`, `ln`, `pow`, `tanh`, `sqrt`); other files call `math::…`. First
   module `src/random.rs`:
   - `pub fn hash_seed_utf16(units: &[u16]) -> u32` (FNV-1a as above, with
     `wrapping_mul`);
   - `pub struct Random { state: u32 }`, `Random::new(seed: u32)` (0 becomes
     `0x9e3779b9`), `next(&mut self) -> f64`, `normal(&mut self) -> f64`.
     Use `wrapping_add`/`wrapping_mul` on `u32`; divide by `4294967296.0`.
4. `crates/voice-simulator-wasm`: `crate-type = ["cdylib", "rlib"]`, depends
   on the core only. Plain `#[no_mangle] pub extern "C"` functions; no
   wasm-bindgen, no wasm-pack, no `wasm-opt`. Reasons: no generated glue
   file, no tool whose version must match a library, the same file loads in a
   page, a worker, an AudioWorklet, Node.js, Bun and Deno, and the output of
   the build depends only on the pinned compiler. Rules of the interface
   (write them into `docs/RUST-ENGINE.md`):
   - every export starts with `vs_`; arguments and results are `u32`, `i32`
     or `f64` only; no strings, no structs;
   - `vs_abi_version() -> u32` returns 1; raise it on any breaking change;
   - `vs_alloc(bytes: u32) -> u32` returns an offset aligned to 8, or 0 when
     memory is exhausted; `vs_free(ptr: u32, bytes: u32)`;
   - arrays cross as (offset, length in elements) into the linear memory;
     state and coefficients are `f64`, audio output is `f32`;
   - objects are integer handles (> 0); errors are negative `i32` codes
     listed in one table;
   - JavaScript must create its typed-array views again after every call
     that can allocate, because growing the memory detaches old views.
     First exports: `vs_hash_seed_utf16(ptr, len) -> u32`,
     `vs_random_fill(seed: u32, out: u32, count: u32)` and
     `vs_random_normal_fill(seed, out, count)` (both write `f64`).
5. `crates/voice-simulator-cli`: binary `voice-simulator-cli`, `std` only,
   arguments parsed by hand. Commands in this issue: `version`, and
   `random <seed> <count>`, which prints one value per line as 16 hexadecimal
   digits of the `f64` bits. Later issues add commands that render.
6. Build script `scripts/build-wasm.mjs` and `"build:wasm"` in
   `package.json`: run
   `cargo build --release --locked --target wasm32-unknown-unknown -p
voice-simulator-wasm`, copy
   `target/wasm32-unknown-unknown/release/voice_simulator_wasm.wasm` to
   `src/engine/voice-simulator.wasm`, print its size in bytes and its
   SHA-256. With `--check-size` exit with 1 when the file is larger than
   `WASM_SIZE_BUDGET` (constant in the script; set it to the measured size of
   this issue's build rounded up to the next 16 384 bytes; later issues raise
   it with the measured number in the commit message). If `cargo` is not
   found print `cargo not found: the JavaScript engine will be used` and exit
   with 0, or with 1 when `--require` is given.
7. Loader `src/engine/wasm-loader.js` exporting
   `loadEngineModule(source)`. `source` may be a `WebAssembly.Module`, a
   `BufferSource`, a URL or nothing; nothing means
   `new URL('./voice-simulator.wasm', import.meta.url)`, read with
   `node:fs/promises` when the URL starts with `file:` and with `fetch`
   otherwise. It returns `{ exports, memory, abiVersion }`, or `null` when
   `WebAssembly` is missing, the file is missing or compiling fails. It
   throws only when `vs_abi_version()` is not the number the loader expects.
   No top-level `await`; no import of `node:` modules at the top level.
8. Determinism rules (in `docs/RUST-ENGINE.md`, checked by review): no
   `mul_add`, no `-C target-cpu=native`, no fast-math flags, no relaxed
   SIMD, transcendental functions only through `math.rs`, no `HashMap`
   iteration in numeric code, no NaN produced on purpose. The scalar `f64`
   build defines the reference output.
9. Parity classes (same document). Class A, bit-identical: code that uses
   only `+ - * /`, `sqrt` and integers. Class B, tolerance: anything else;
   the measure is `sqrt(sum((a - e)^2) / sum(e^2))` with the limit stated by
   the issue that ports the code.
10. CI. In `release.yml` add job `rust` (`ubuntu-24.04`, `timeout-minutes:
15`, runs when `any-code-changed` is true): `cargo fmt --all --check`,
    `cargo clippy --workspace --all-targets --locked -- -D warnings`,
    `cargo test --workspace --locked`,
    `node scripts/build-wasm.mjs --require --check-size`, then
    `REQUIRE_WASM=1 node --test tests/rust-parity.test.js`, then upload
    `src/engine/voice-simulator.wasm` as artifact `voice-simulator-wasm`.
    Use the `rustup` of the runner image, which reads `rust-toolchain.toml`
    (first step: `rustup show`); if the image has no `rustup`, install the
    toolchain with the action `dtolnay/rust-toolchain` pinned to a commit.
    Jobs `release` and `instant-release` get `needs: rust` and download the
    artifact into `src/engine/` before they publish. In `example-app.yml` add
    job `wasm-build` with the same build and upload; `web-build`,
    `desktop-package`, `android-build` and `ios-build` download it before
    they build. Add both jobs to `pipeline-status` and to
    `docs/CI-TIMEOUT-BUDGETS.md`.
11. Licence gate without new tools: `scripts/rust-allowed-crates.json`
    (`{"libm": "MIT"}` at first) and a test that every `[[package]]` name in
    `Cargo.lock` is a workspace crate or a key of that file.

## Tests

`tests/helpers/rust-engine.js` exports `loadRustEngine()` (calls the loader)
and `noRust` (a skip reason string, or `null`). When `REQUIRE_WASM=1` and the
file is missing, it throws instead of skipping.

`tests/rust-parity.test.js` (uses `itUnless(noRust)` of
`tests/helpers/skip.js`):

- `hashes seeds like JavaScript`: for `''`, `'a'`, `'voice'`, `'héllo'`,
  `'你好'`, `'😀'`, `vs_hash_seed_utf16` equals `hashSeed`.
- `uniform numbers are bit-identical`: for seeds 0, 1, 42, `0xffffffff` and
  `hashSeed('voice')`, 10 000 values of `vs_random_fill` equal `createRandom`
  under `Object.is`.
- `normal numbers are bit-identical`: the same for `randomNormal`.
- `views survive growth`: allocate 70 000 000 bytes with `vs_alloc`, then
  fill and read 1000 values; no exception.

`tests/rust-crates.test.js` (always runs): the licence test of step 11, and
`rust-toolchain.toml` has a `channel` that matches `^\d+\.\d+\.\d+$`.

Rust unit tests in `random.rs`: the first three values for seed 1 equal
constants printed by Node.js (paste their `f64` bits).

## Acceptance criteria

- [ ] `cargo fmt --all --check`, `cargo clippy --workspace --all-targets --
-D warnings` and `cargo test --workspace` exit with 0.
- [ ] `npm run build:wasm` run twice prints the same SHA-256, and the size is
      at most `WASM_SIZE_BUDGET`; both numbers are in the pull request.
- [ ] `REQUIRE_WASM=1 node --test tests/rust-parity.test.js` passes on
      Node.js; the same file passes with `bun test` and `deno test -A`.
- [ ] `voice-simulator-cli random 1 3` prints the bits of the first three
      values of `createRandom(1)`.
- [ ] With `src/engine/voice-simulator.wasm` deleted, `npm test` passes and
      the parity tests are reported as skipped.
- [ ] After `npm run build:wasm`, `npm pack --dry-run` lists
      `src/engine/voice-simulator.wasm`; without the build it does not, and
      `git status` never shows the file.
- [ ] Job `rust` is green on the pull request and `pipeline-status` needs it;
      `node scripts/check-ci-workflows.mjs` exits with 0.
- [ ] `npm run check` and `npm test` pass; a patch changeset is added.

## Out of scope

- Porting the synthesiser: {{P10}} (waveguide, source, renderer) and {{P11}}
  (3D solver). Threads: {{P12}}.
- Choosing the engine at run time and making Rust the default: {{P13}}.
- A native Node.js add-on. Node.js, Bun and Deno load the same `.wasm` file.
- Folding the licence gate into the general policy check: {{P03}}.

## References

- Rust platform support, `wasm32-unknown-unknown`:
  https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-unknown.html
- Sunsetting the rustwasm GitHub organisation:
  https://blog.rust-lang.org/inside-rust/2025/07/21/sunsetting-the-rustwasm-github-org
- RFC 3514, floating-point semantics:
  https://rust-lang.github.io/rfcs/3514-float-semantics.html
- WebAssembly nondeterminism:
  https://github.com/WebAssembly/design/blob/master/Nondeterminism.md
- Research notes, sections 1, 2, 7 and 8:
  `docs/case-studies/issue-11/research/5-performance-and-physics.md`.
