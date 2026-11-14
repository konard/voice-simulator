---
id: P65
title: Recognition in Rust and on several cores with a single-core fallback
type: Feature
milestone: M4
blocked_by: [P61, P09]
requirements: [R2, R6, R12, R13]
---

## Goal

The slow parts of recognition run in Rust (WebAssembly in browsers and in
Node.js, native in the command line crate) and use several cores when the
device has them. With one core, or without WebAssembly, recognition still
works and returns the same text. The JavaScript code stays as the reference.

## Why

The issue asks for Rust in a background worker by default, for speed on many
cores, and for "tolerable" behaviour on one core. Recognition repeats the
same small computations for every frame of audio (spectra, pitch, formants,
nearest entries of a codebook, dynamic programming), which is the kind of
code that gains most from Rust and from splitting over cores.

## Current state

- There is no Rust code in the repository: `ls Cargo.toml crates` fails.
  {{P09}} creates the workspace with `crates/voice-simulator-core` (pure Rust,
  no I/O), `crates/voice-simulator-wasm` and `crates/voice-simulator-cli`.
- After {{P61}} recognition is JavaScript only, on the thread of the caller:
  `recognize` and `createRecognizer` in `src/recognition/recognizer.js` call
  the stages of `src/recognition/` one after the other.
- No library code starts a worker. The only workers are in the example app
  (`examples/universal-app/src/engine/synth-worker.js`, `match-worker.js`).
- Facts from the research notes (file 5) that limit the design:
  `std::thread::spawn` does not work on `wasm32-unknown-unknown`; shared
  memory between workers needs cross-origin isolation, which GitHub Pages
  cannot switch on with headers; work that is independent per item can be
  split over plain workers without shared memory.

## What to do

1. Measure first. Create `scripts/profile-recognition.mjs`. It synthesises
   `The quick brown fox jumps over the lazy dog.` (`tier: 'minimal'`,
   `seed: 1`), calls `recognize` 5 times at each level and prints the median
   time per stage in ms and in percent: front end, pitch, formants, inverse
   filter, landmarks, inversion (codebook search), decoding to IPA, language
   identification, IPA to text. Paste the table into the pull request.
2. Port every stage that takes 10 % or more of the time at level `low` or
   `high`. The expected list: frame analysis (`analyzeFrames`), `trackPitch`,
   `trackFormants`, the nearest-entry search in the codebook, the dynamic
   programming of `invertArticulation` and `audioToIpa`, and the word search
   of `ipaToText`. A stage below 10 % stays in JavaScript.
3. Rust code goes to `crates/voice-simulator-core/src/recognition/`, one file
   per stage. Rules:
   - functions take slices of `f32` (audio, tables) and return `Vec`s of
     numbers; no strings, no I/O, no clock, no threads in this crate;
   - accumulated costs of dynamic programming are `f64`;
   - when two candidates have the same cost, the one with the lower index
     wins. Use the same rule in the JavaScript reference (change it if
     needed, in a separate commit that keeps all tests green).
4. Tables cross the boundary as flat typed arrays. If a JavaScript stage
   keeps its table as objects (codebook entries, lexicon), first add a
   function that packs it into `Float32Array`/`Uint32Array` and make the
   JavaScript stage read the packed form. Document every packed layout in a
   comment at the top of the Rust file that reads it.
5. Export the kernels from `crates/voice-simulator-wasm` with the prefix
   `rec_` (for example `rec_frames`, `rec_pitch`, `rec_codebook_search`).
6. Create `src/recognition/engine.js` exporting
   `createRecognitionEngine({ engine, threads })`:
   - `engine`: `'auto'` (default), `'rust'` or `'js'`, the same values as the
     option of {{P13}}. `'auto'` uses Rust when the WebAssembly module loads,
     otherwise JavaScript. `'rust'` throws when it does not load.
   - If `createEngine` of {{P13}} is in the code base, load the WebAssembly
     module through it; do not add a second loader.
   - `recognize` and `createRecognizer` accept `engine` and `threads` and
     pass them on. The command gets `--engine` and `--threads`.
7. Several cores, without shared memory:
   - `src/recognition/pool.js` exports `createRecognitionPool({ threads })`.
     Default `threads`: the number of logical cores (`os.availableParallelism()`
     in Node.js, `navigator.hardwareConcurrency` elsewhere), at most 8.
   - With `threads: 1` no worker is created; everything runs on the calling
     thread. This is the single-core fallback.
   - Each worker loads its own copy of the engine and receives the packed
     tables once.
   - Job type 1, codebook search: split the frames into `threads` contiguous
     blocks; each worker returns the `K` best entries per frame; the caller
     joins the blocks in frame order and runs the dynamic programming itself.
   - Job type 2, rescoring ({{P55}}, only if merged): `planRescoring`
     returns the jobs as plain data; each worker runs `scoreJob(job)` and
     returns the distance `m`; the caller puts the distances back in job
     order and finishes as `rescoreHypotheses` does.
   - Job type 3, long files in `recognize`: cut the audio at pauses of 0.3 s
     or more; recognise the pieces in parallel; join in time order. Use it
     only for audio longer than 10 s.
   - The result must not depend on `threads`. Nothing that a worker computes
     may depend on another worker's result or on the arrival order.
8. Native: in `crates/voice-simulator-cli`, add `recognize <file>` that reads
   WAV and prints the IPA and the time per stage. Use `rayon` behind the
   cargo feature `parallel` for job types 1 and 2. The text stages may stay
   in JavaScript; say in the README which stages the native command covers.
9. In the app, if {{P62}} is merged: `engine/recognition-worker.js` creates
   the engine with `engine: 'auto'`, `threads: 1` (it is already a worker).
10. Document in `README.md` (section "Recognition"): the options `engine` and
    `threads`, and the measured speed table of the acceptance criteria.

## Tests

`tests/recognition-parity.test.js` (skipped with a clear message when the
WebAssembly file is not built). Input: the fox sentence above at tiers
`minimal` and, when {{P14}} is merged, `telephone`.

- `frames match`: every feature value differs by at most `1e-4` relative to
  the largest value of that feature.
- `pitch matches`: same voiced/unvoiced decision in at least 99.5 % of the
  frames; in frames voiced in both, pitch differs by at most 0.1 Hz.
- `formants match`: F1 to F3 differ by at most 2 Hz in 99 % of the frames.
- `codebook search matches`: the same best entry in at least 99.9 % of the
  frames.
- `text matches`: `recognize(..., { engine: 'rust' })` and
  `{ engine: 'js' }` return the same `text` and `ipa`; word and syllable
  times differ by at most 0.001 s.

`tests/recognition-pool.test.js`:

- `does not depend on the number of threads`: results with `threads` 1, 2
  and 4 are deeply equal (`JSON.stringify` of the result is the same string).
- `creates no worker with one thread`: with a `createWorker` spy,
  `threads: 1` creates 0 workers.
- `survives a failing worker`: when a worker throws, the job is repeated on
  the calling thread and the result is unchanged.
- `falls back to JavaScript`: with `engine: 'auto'` and a loader that
  rejects, the result equals the `engine: 'js'` result.

`cargo test -p voice-simulator-core recognition`: one unit test per ported
stage with a fixed input and expected numbers taken from the JavaScript code.

`tests/heavy/performance-recognition.test.js` (suite `performance`): times
for engine × level × threads on 60 s of synthetic speech, written with
`writeReport('performance-recognition', ...)`.

## Acceptance criteria

- [ ] `npm test` runs the parity and pool tests and they pass on Node.js, Bun
      and Deno.
- [ ] `taskset -c 0 node bin/voice-simulator.js recognize fox.wav --level low`
      with `--engine rust --threads 1` added needs at most 0.25 s per second
      of audio on the CI runner (`fox.wav` is the fox sentence at 8000 Hz).
- [ ] The same command with `--engine js` prints the same text.
- [ ] On the ported stages, Rust is at least 2 times faster than JavaScript
      (table of `scripts/profile-recognition.mjs` for both engines in the
      pull request).
- [ ] On a machine with 4 or more cores, level `high`, 60 s of audio:
      `--threads 4` is at least 1.8 times faster than `--threads 1`. The test
      is skipped, with a message, on machines with fewer cores.
- [ ] `npm run check`, `npm test` and `cargo test --workspace` pass; a minor
      changeset is added.

## Out of scope

- Porting the synthesiser: {{P10}}, {{P11}}. Threads for the 3D solver:
  {{P12}}. Making the Rust engine the default for synthesis: {{P13}}.
- Shared memory, `wasm-bindgen-rayon` and cross-origin isolation.
- SIMD. Add it only in a later issue, with the parity tests of this one.
- The parity report over all features: {{P70}}.
- Tracking speed over time: {{P19}}.

## References

- Research notes, part A sections 1 to 4 (targets, determinism, threads,
  what to split over cores):
  `docs/case-studies/issue-11/research/5-performance-and-physics.md`.
- rayon, data parallelism for Rust (MIT OR Apache-2.0):
  https://github.com/rayon-rs/rayon
- Ney, H., Ortmanns, S. (2000). Progress in dynamic programming search for
  LVCSR. Proceedings of the IEEE 88(8), 1224-1240.
