# Issue 63: voice configuration fit

Objective: implement and verify the complete scope of issue 63 in PR 146.
Prerequisites 59, 60, 61, 17 and 32 are closed. Issues 33 and 41 are
merged; include optional fold-source refinement and saveVoice compatibility.
Issue 62 is open and landmarks.js is absent: use envelope syllable nuclei.
The issue and PR have no comments, inline comments or reviews at start.

## Requirements and verification

- [x] Stage A: shared frame/pitch/formant/source analysis; fixed JSON
      histograms, counts, mel and perturbation sums; 20-frame rejection.
- [x] Part selection, default parameters, bounded estimates and MAD SDs;
      committed reproducible calibration of pitch range, breathiness and rate.
- [x] Stage B: scaled feature objective, aligned MCD with transcript,
      regularisation and deterministic two-round bounded Nelder-Mead search.
- [x] Budget, seed, callback, progress generator, final simplex SD and full
      result, with all legacy feature keys plus source diagnostics.
- [ ] Incremental fitter and JSON continuation, fixed state size, split
      recording agreement, optional refinement of an explicitly supplied stretch.
- [ ] Legacy match wrappers and unchanged tests; example worker compatibility.
- [x] Rust numerical implementation and automated parity tests.
- [x] Public exports and declarations, README, CLI help, roadmap, minor changeset.
- [ ] Unit gates: two specified heads, transcript/no transcript/8 kHz,
      uncertainty, continuation, determinism and exactly five legacy result keys.
- [ ] Heavy copy suite: all 20 seeded heads, error/coverage gates; every
      golden speaker with/without transcript, distance and aligned MCD versus
      nearest preset, tract length with manifest sex; committed report copy.
- [x] Run the complete heavy suite and archive all 88 fits with revision,
      all gate outcomes, parameter SDs and manifest review status.
- [x] Stage A <= 0.3 RTF and default fit <= 60 s for 10 s audio, measured.
- [ ] Node/Bun/Deno focused tests, npm check/test, app tests and Rust checks.
- [ ] Preserve useful atomic commits, merge latest main, push only prepared
      branch, review PR diff, update PR title/body with Fixes #63, verify current
      CI and heavy runs, clean tree, mark PR ready after completion.

## Work sequence

1. Read guidance and related APIs/PRs; establish reproducible baseline probes.
2. Draft all library, tests, Rust and documentation requirements.
3. Run focused checks, investigate measured failures without relaxing gates.
4. Commit/push, run heavy/performance and standard CI, preserve failure logs,
   correct failures, commit reports and finalise PR.

Logs stay in this experiment directory and CI failures in ci-logs/ (ignored).
No required criteria are complete until backed by measured evidence below.

## Evidence and unresolved gates

- `tests/voice-fit-numerics.test.js`: fixed bins, even medians/MAD, weights,
  cached aligned MCD versus the existing public metric, bounded deterministic
  simplex; negative spectral tilt survives state serialization.
- `tests/voice-fit-rust-parity.test.js`: built scalar WASM, histogram quantiles
  and MAD, feature weights and simplex paths match JS. Focused numerical,
  Rust parity and actual matching-worker tests: 8 pass on Node, Bun and Deno.
- Current focused API tests verify no-refinement recovery, 8 kHz, part
  selection, callbacks, determinism, saveVoice and five-key wrapper results.
  The uncertainty and transcript recovery tests remain red; no gate weakened.
- `experiments/issue-63/performance.mjs`: Node v26.13.0, AMD EPYC with IBPB,
  10 s input: statistics 1.982 s (RTF 0.1982); default fit 55.922 s,
  34 renders (spread stop), RSS 234,975,232 bytes.
- The production Vite build passes its existing 500 kB chunk guard after
  splitting shared recognition DSP. A Playwright module worker receives
  1 s of 160 Hz harmonic audio and emits five progress messages and `done`:
  distance 8.436775, fitted pitch 187.049 Hz, voiced duration 1 s.
  This verifies the worker protocol, not synthetic parameter accuracy.
- Full CI at c67213a exposed a stale size assertion, a 519 kB worker and
  CodeQL source-factory validation. The fixes at 49f1aa7 pass Rust Engine,
  Security and all example app jobs. Logs are preserved in `ci-logs/`.
- The old 8 kHz test required an unavailable F4 to remain zero. Restoring
  the bandwidth-dependent default count makes that unchanged regression pass.
- Full runtime CI also finds three legacy matching accuracy regressions;
  those tests remain unchanged. Some OS jobs exhaust the existing five-minute
  suite budget. The expanded analysis per render is the main added work;
  increasing timeouts has not been used as a fix.
- Head A has 263 voiced frames, pitch 208.855 Hz and the prescribed MAD SD
  5.948 Hz, above the <5 Hz gate. Changing the soft voicing threshold does
  not fix it (`voicing.mjs`). Capping SD would contradict the required formula.
- Head B starts at pitch 100 Hz, tract 19.663 cm and breathiness 0.659.
  The first six required simplex vertices exhaust round one's budget.
  Their objective prefers pitch 126 Hz; the final ten-render fit retains
  it and fails the 3% pitch and 6% tract gates (`objective.mjs`).
- Corrected a review finding: `frames.mel` contains ln(power), whereas the
  objective specifies dB. A numerical regression fails before conversion
  and passes afterward; the equivalent Rust conversion has parity coverage.
  Rechecking the ten-render fits still selects pitch 126 Hz for head B.
- Continuation now explicitly tests both specified heads. Head B changes
  tract length from 19.663 cm whole to 18.919 cm split, failing 2% agreement.
- Correcting only the source in the diagnostic reduces J from 12.874 to
  5.872; changing jitter and shimmer alone leaves J at 12.852.
  Cubic lag interpolation plus pitch-slope compensation still infers
  breathiness 0.568 for head B's true 0.2 (`hnr-interpolation.mjs`).
  A bounded 17-lag search still reads 0.557. Short-sentence calibration of
  range and HNR also keeps the incorrect 126 Hz pitch.
- Full heavy workflow 44062254770 completed all 20 heads and 24 golden
  recordings in both modes at implementation SHA 4d0737d. Both tests fail.
  With text: median pitch 4.19% and rate 18.75%. Without: tract 8.92%,
  pitch 2.77%, rate 12.71%, maximum tract 13.60%, coverage 0/20.
  Golden hi-02 with text has distance 17.5612 versus preset 17.5152.
  Archive: docs/reports/copy-voice-fit.md and .json; details and commands:
  docs/reports/issue-63-validation.md. This predates the mel correction.

## CI investigation protocol

1. List the five latest branch runs with timestamps, conclusions and SHAs.
2. Compare each SHA with the latest commit; do not reuse an old pass.
3. Download failed run logs under ci-logs/. If cancelled jobs have no full
   run log, download each available completed job log through the API.
4. Read actual failures in bounded chunks; record exact errors and saved
   log line numbers in the validation report and PR.
5. Keep the PR draft while any acceptance gate remains unmet. Passing
   infrastructure or protocol checks does not complete the acoustic gates.
