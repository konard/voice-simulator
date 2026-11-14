---
id: P70
title: Rust parity for everything added after the port
type: Feature
milestone: M5
blocked_by: [P13, P21, P22, P23, P24, P41, P42]
requirements: [R2, R12]
---

## Goal

Make the Rust engine complete. Every part of the sound simulation that was
added to the JavaScript reference after the first port must exist in Rust,
give the same sound within a stated tolerance, and be at least as fast. A
script, `scripts/check-engine-parity.mjs`, lists the features of both engines
and fails when Rust lacks one, so the two can never drift apart again.

## Why

The Rust engine is the default ({{P13}}). The rule at the bottom of every
issue says "implement in the JavaScript reference, and in Rust if `crates/`
exists", but a rule in prose is easy to miss, and an issue that was merged
before the port could not follow it at all. Wherever Rust lacks a feature the
engine must fall back to JavaScript, which is many times slower: exactly the
voices that need the new physics (folds, noise, whisper) would then lose the
speed the port was made for (requirement R2).

## Current state

- Today there is no Rust: `ls crates Cargo.toml` fails. {{P09}} to {{P13}}
  add the workspace, port the waveguide, the glottal source, the voice
  renderer and the 3D solver, and add `src/engine/` with `createEngine`.
- The whole path from an articulation plan to samples is in `src/acoustics/`
  (14 files: `analysis.js`, `fdtd-gpu.js`, `fdtd-kernel.js`, `fdtd3d.js`,
  `filters.js`, `glottis.js`, `microphone.js`, `radiation.js`, `room.js`,
  `sinuses.js`, `transfer.js`, `voice.js`, `voxel-model.js`, `waveguide.js`).
  Solvers are chosen by name through `registerSolver(name, factory)` in
  `voice.js`.
- The voice source is the Liljencrants-Fant pulse in `glottis.js`; noise is
  filtered white noise. {{P21}} (vocal folds), {{P22}} (source-tract
  interaction, subglottal tract), {{P23}} (turbulence noise), {{P24}}
  (frequency-dependent losses), {{P41}} (whisper) and {{P42}} (phonation
  types) change or replace these parts. Each may have been merged before or
  after the port, in JavaScript only.
- Nothing lists what an engine can do. A caller finds out that Rust lacks a
  feature only because the engine silently uses JavaScript.

## What to do

1. Feature manifest of the JavaScript engine: `src/engine/features.js`
   exporting `ENGINE_FEATURES`, a frozen array of
   `{ id, modules, tolerance, probe }`.
   - `id`: a short name, for example `solver.waveguide`, `solver.fdtd3d`,
     `source.lf`, `source.folds`, `source.tract-interaction`,
     `source.subglottal`, `noise.turbulence`, `losses.frequency`,
     `mode.whisper`, `mode.phonation`, `tier.narrowband`.
   - `modules`: the files of `src/acoustics/` (and other folders, if the
     feature lives elsewhere) that implement it.
   - `probe`: `{ text or ipa, options }`, a short utterance (1 s or less)
     and the `synthesize` options that switch the feature on.
   - `tolerance`: see step 5.
   - Also export `JS_ONLY`: an array of `{ module, reason }` for files that
     stay JavaScript on purpose (for example `fdtd-gpu.js`: the WebGPU host
     code runs in the browser's JavaScript).
2. Feature list of the Rust engine:
   `crates/voice-simulator-core/src/features.rs` with
   `pub const FEATURES: &[&str]`, one id per line between the comment lines
   `// features:start` and `// features:end`. Export it through the
   WebAssembly interface and the native binary as `features()`; the engine
   object of `createEngine` gets a method `features()` that returns the ids
   (the JavaScript engine returns the ids of `ENGINE_FEATURES`). Add a Rust
   unit test that every id in `FEATURES` is unique.
3. `scripts/check-engine-parity.mjs` (no build needed; it reads
   `features.rs` as text). It exits with 1 and prints a table when:
   - an id of `ENGINE_FEATURES` is missing in `FEATURES`, or the reverse;
   - a file in `src/acoustics/` is neither in the `modules` of a feature nor
     in `JS_ONLY` (this catches a new module that nobody registered);
   - a feature has no `probe` or no `tolerance`.

   With `--json` it prints one object with the keys `js`, `rust`,
   `missingInRust`, `missingInJs` and `unlisted` (arrays of ids or file
   names). Add the script to `npm run check` and to the Rust job of the CI.

4. Audit. Run the script and port every feature in `missingInRust`. The
   expected list, to be confirmed by the script: the fold model of {{P21}},
   the coupling and the subglottal tract of {{P22}}, the noise sources of
   {{P23}}, the losses of {{P24}}, whisper of {{P41}}, the phonation types of
   {{P42}}; and, if they are merged and not yet in Rust, the 2D tier
   ({{P25}}), the articulators ({{P28}}), vocal effort ({{P40}}) and the
   narrow-band tiers ({{P14}}). Port one feature per commit. Follow the
   structure of the JavaScript file so the two can be read side by side.
5. Parity tests, `tests/engine-parity.test.js`: for every feature render its
   `probe` with `engine: 'js'` and `engine: 'rust'`, same `seed`, and compare.
   `tolerance` is one of:
   - `{ kind: 'samples', maxError: 1e-4 }`: largest absolute sample
     difference, for linear deterministic code (waveguide, filters, losses);
   - `{ kind: 'spectrum', maxDb: 0.5 }`: `logSpectralDistance` of {{P06}}
     plus an f0 difference below 0.5 %, for code where rounding grows
     (self-oscillating folds) or where random numbers are drawn in another
     order (turbulence).

   Both engines must use the generator of `src/random.js` with the same
   algorithm so that `samples` is possible wherever the order is the same.
   Use `spectrum` only with a sentence in the pull request that says why.
   The two limits are proposals: if a ported feature misses its limit, find
   the cause first; loosen a limit only with the measured number and the
   reason written next to it in `features.js`.

6. Speed, `tests/heavy/performance-parity.test.js` (suite `performance` of
   {{P02}}): for every feature probe and for every tier, repeat the render
   until 2 s have passed and take the median time. Rust (one thread) must
   need at most 1.0 times the JavaScript time. Write the table with
   `writeReport('engine-parity', ...)` and copy it to
   `docs/reports/engine-parity.md`.
7. Remove the temporary fallbacks. After step 4,
   `createEngine({ engine: 'rust' })` must never hand a render to the
   JavaScript engine because of a missing feature. Delete those branches;
   keep only the fallback for "WebAssembly cannot be loaded". Add a counter
   `engine.fallbacks` (number of renders handed to JavaScript, with the
   reason) so that a test can assert it is 0.
8. Documentation: `README.md` (engine section) and `docs/CONTRIBUTING.md`
   get the rule "a new engine feature is one entry in `ENGINE_FEATURES`, one
   line in `features.rs` and one parity probe; the check fails otherwise".
   Update `src/index.d.ts` (`ENGINE_FEATURES`, `features()`, `fallbacks`).
9. The issue template text "in the JavaScript reference first, in Rust if
   `crates/` exists" stays valid; from now on the check enforces it.

## Tests

`tests/engine-features.test.js` (fast, no Rust build needed):

- `lists every acoustics module`: every file of `src/acoustics/` is in a
  feature or in `JS_ONLY`.
- `has a probe for every feature`: each probe renders with `engine: 'js'`
  at tier `minimal` in under 1 s and gives finite samples.
- `fails on a missing Rust feature`: run the script with
  `--rust-file <fixture>` where one id is removed; exit code 1 and the id is
  printed. With the real file the exit code is 0.

`tests/engine-parity.test.js` (skipped with a message when the WebAssembly
build is absent; the CI job that builds Rust runs it):

- one test per feature id, named `parity: <id>`, with the tolerance of the
  manifest;
- `never falls back`: after all probes ran with `engine: 'rust'`,
  `engine.fallbacks` is 0.

Rust: `cargo test -p voice-simulator-core` contains one test per ported
feature that compares against a short reference vector written by the
JavaScript engine to `crates/voice-simulator-core/tests/vectors/<id>.json`
(made by `node scripts/check-engine-parity.mjs --write-vectors`).

## Acceptance criteria

- [ ] `node scripts/check-engine-parity.mjs` exits with 0 and prints the same
      ids for both engines; it is part of `npm run check`.
- [ ] `node --test tests/engine-parity.test.js` passes with the built
      WebAssembly module: every feature within its tolerance, 0 fallbacks.
- [ ] `cargo test --workspace` and `cargo clippy --workspace -- -D warnings`
      pass.
- [ ] `docs/reports/engine-parity.md` is committed and shows, per feature and
      tier, the JavaScript time, the Rust time and their ratio; no ratio is
      above 1.0.
- [ ] `grep -rn "fallback" src/engine` shows only the "cannot load" case.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- Recognition in Rust: {{P65}}. Text to IPA and the planner stay JavaScript
  unless an earlier issue already moved them.
- Using several cores: {{P12}}. SIMD beyond what {{P11}} set up.
- New physics. This issue ports and checks what exists; it changes no
  sound of the JavaScript reference.
- The WebGPU solver (`fdtd-gpu.js`), which stays a JavaScript host with a
  shader.

## References

- `docs/VISION.md`, section "Running everywhere" ("The simulation core is
  written in Rust ... The JavaScript implementation stays as the readable
  reference and as the fallback").
- The Rust and WebAssembly book: https://rustwasm.github.io/docs/book/
- Research notes:
  `docs/case-studies/issue-11/research/5-performance-and-physics.md`.
