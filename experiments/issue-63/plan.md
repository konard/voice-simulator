# Issue 63: voice configuration fit

Objective: implement and verify the complete scope of issue 63 in PR 146.

## Second CI repair investigation

- [x] Read the full issue and every PR comment type again; fetch main.
- [x] Verify run 44094741268 belongs to current dc376f5; preserve its logs.
- [x] Read fresh Node failures at full-log lines 15388–15458; distinguish
      five accuracy assertions from slower-runner timeouts.
- [x] Test source stationarity, landmark boundary behavior and timing
      independently, without loosening the objective, SD formula or gates.
- [ ] Implement demonstrated corrections with failing regression tests.
- [ ] Re-run focused acceptance tests, then all current-head CI and heavy gates.
- [ ] Review the final PR diff, update evidence and description, commit every
      requested change and mark ready only after every requirement passes.

The stationary-source prototype again fixes B's pitch but fails its rate
and all three legacy preset cases; it was discarded. The new eight-evaluation
`rate-source-coupling.mjs` probe shows that even true breathiness alone still
leaves the objective favoring B's incorrect faster rate. Pitch smoothing at
five finite radii leaves A's prescribed SD unchanged. Detailed measurements
and remaining criteria are in `docs/reports/issue-63-validation.md`; these
negative probes are evidence, not completed acceptance criteria.

Prerequisites 59, 60, 61, 17 and 32 are closed. Issues 33 and 41 are
merged; include optional fold-source refinement and saveVoice compatibility.
Issue 62 merged during this follow-up, in main a5b3c51. Its detector is now
present; integrating its nuclei without breaking rate and continuation is
an additional unmet requirement (see the merge follow-up below).
The issue has no comments. The PR has three automation conversation comments
and no inline comments or reviews at the latest November 17 review.

## Requirements and verification

- [ ] Stage A: shared frame/pitch/formant/source/landmark analysis; fixed JSON
      histograms, counts, mel and perturbation sums; 20-frame rejection.
- [x] Part selection, default parameters, bounded estimates and MAD SDs;
      committed reproducible calibration of pitch range, breathiness and rate.
- [x] Stage B: scaled feature objective, aligned MCD with transcript,
      regularisation and deterministic two-round bounded Nelder-Mead search.
- [x] Budget, seed, callback, progress generator, final simplex SD and full
      result, with all legacy feature keys plus source diagnostics.
- [x] Incremental fitter and JSON continuation, fixed state size, split
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
  Rust parity and actual matching-worker tests: 9 pass on Node, Bun and Deno.
- `npm run check` passes after the fixed-prior correction and evidence
  scripts: lint, formatting, duplication, numerical engine coverage and
  dependency policy (699 packages, 1,553 files). Runtime CI remains red:
  Deno/Ubuntu completes 2,954 passes/five failures, Bun/Ubuntu completes
  2,956 passes/five failures; other OS jobs hit the existing suite budgets.
- Current focused API tests verify no-refinement recovery, 8 kHz, part
  selection, callbacks, determinism, saveVoice and five-key wrapper results.
  The uncertainty and transcript recovery tests remain red; no gate weakened.
- `experiments/issue-63/performance.mjs` at 3487780: Node v26.13.0,
  AMD EPYC with IBPB, 10 s input: statistics 1.928 s (RTF 0.1928);
  default fit 49.751 s, all 40 renders, RSS 236,314,624 bytes.
  Deferring unused legacy diagnostics fixed a measured 65.899 s overrun;
  normal and verbose-trace results are asserted equal.
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
- Substituting the renderer's known f0 plan also exceeds 5 Hz, both in
  quarter-semitone bins (5.078 Hz) and with unbinned MAD (5.373 Hz) on
  the same 263 frames (`pitch-truth.mjs`). Even planned voicing gives
  5.218/5.496 Hz; tracking error alone does not explain the failed gate.
- Before the fixed-prior correction, head B starts at pitch 100 Hz,
  tract 19.663 cm and breathiness 0.659.
  The first six required simplex vertices exhaust round one's budget.
  Their objective prefers pitch 126 Hz; the final ten-render fit retains
  it and fails the 3% pitch gate (`objective.mjs`). The fixed prior later
  brings the tract estimate within its gate but retains 126 Hz.
- Corrected a review finding: `frames.mel` contains ln(power), whereas the
  objective specifies dB. A numerical regression fails before conversion
  and passes afterward; the equivalent Rust conversion has parity coverage.
  Rechecking the ten-render fits still selects pitch 126 Hz for head B.
- Continuation explicitly tests both specified heads. Holding the formant
  tracker's prior at its initial 16.5 cm removes whole-utterance dependence:
  head B is 18.817 cm whole and split, and head A is 14.768 cm for both.
  The regression fails before the fix and passes at 3487780. The 8 kHz
  and both no-refinement recovery cases also pass; B still selects 126 Hz.
- At 3487780, correcting only the source in the diagnostic reduces
  acoustic distance from 12.284 to 3.136; changing jitter and shimmer
  alone leaves 12.053. The true head gives zero. Within the ten-render
  simplex budget, pitch 126 has J 10.753 versus stage A 12.284, and the
  round-two breathiness vertex lowers J to 8.311 while keeping 126 Hz.
  Cubic lag interpolation plus pitch-slope compensation still infers
  breathiness 0.568 for head B's true 0.2 (`hnr-interpolation.mjs`).
  A bounded 17-lag search still reads 0.557. Short-sentence calibration of
  range and HNR also keeps the incorrect 126 Hz pitch.
- A separate signal probe (`hnr-signal.mjs`) compares calibrated HNR on
  raw speech, speech high-passed at 400 Hz, and the IAIF derivative. B
  still reads breathiness 0.661, 0.525 and 0.954, respectively, versus 0.2.
- Full heavy workflow 44072776328 completed all 20 heads and 24 golden
  recordings in both modes at implementation SHA 3487780. Both tests fail.
  With text: median pitch 4.06% and rate 16.14%. Without: tract 6.75%,
  pitch 2.49%, rate 13.59%, maximum tract 10.18%, coverage 7/20.
  Golden hi-02 with text has distance 18.0101 versus preset 17.3978.
  Archive: docs/reports/copy-voice-fit.md and .json; details and commands:
  docs/reports/issue-63-validation.md. All seven failing synthetic gates
  and the single golden failure are retained; no thresholds were relaxed.

## CI investigation protocol

1. List the five latest branch runs with timestamps, conclusions and SHAs.
2. Compare each SHA with the latest commit; do not reuse an old pass.
3. Download failed run logs under ci-logs/. If cancelled jobs have no full
   run log, download each available completed job log through the API.
4. Read actual failures in bounded chunks; record exact errors and saved
   log line numbers in the validation report and PR.
5. Keep the PR draft while any acceptance gate remains unmet. Passing
   infrastructure or protocol checks does not complete the acoustic gates.

## CI repair follow-up

- [x] Re-read issue 63 and all PR conversation, inline and review comments.
- [x] Fetch and merge the latest default branch, including new landmarks.
- [x] Preserve fresh complete logs for run 44077893432 at head 75cd6c7.
- [x] Identify the five accuracy failures and suite-budget overruns.
- [x] Profile one bounded fit and eliminate redundant analysis work.
- [x] Verify focused regressions across Node, Bun and Deno.
- [x] Read current implementation CI, including completed job logs when the
      full-run download cannot include an unacquired runner's missing log.
- [ ] Make every accuracy assertion and runtime budget pass in current CI.
- [ ] Reconcile every remaining acceptance gate with measured evidence;
      update the validation report and PR without concealing unmet gates.

### Follow-up evidence

- f525c91 reuses the round-one best vertex and retains prepared legacy
  pitch analysis for final diagnostics. New regressions pass on Node, Bun
  and Deno (three each); `npm run check` passes. The baseline comparison
  experiment proves exact diagnostic/result equality and two actual renders
  reduced to one for a two-evaluation fit on both required heads.
- Ten-second timing at f525c91: statistics 2.335652 s (RTF 0.233565),
  refinement 54.247191 s, 39 actual renders, RSS 231,686,144 bytes.
- The stationary-HNR source initializer was tried and discarded: B recovers
  pitch 100 Hz but rate 1.097456 versus 0.9; two legacy cases still fail.
  The original HNR estimator and calibration remain in production.
- Shorter HNR windows still infer B breathiness 0.531536 rather than 0.2.
  Working-rate changes leave A pitch SD above 5 Hz at all three rates.
- After the refactor the two failing acceptance tests still reproduce,
  including B pitch 126 Hz and A uncertainty. No gate has been relaxed.
- Cycle-pair correlation with separate amplitude normalization and fractional
  lag search still infers B breathiness at least 0.306325 versus 0.2 on a
  stable subset. The seven-recording probe remains experimental.
- Run 44084995292 at f525c91 completed with failure. Node/Ubuntu finishes in
  273 s, Node/Windows in 231 s and Deno/Ubuntu in 259 s, each with the same
  five accuracy failures. Bun/Ubuntu finishes in 433 s with those five plus
  a 30 s breathiness-test timeout. Node/macOS and Deno/Windows still reach
  300 s; Bun/macOS and Bun/Windows reach 500 s. Deno/macOS never acquired a
  runner and was cancelled. Infrastructure, app, security, workflow and
  link checks pass. These results do not complete the issue.

## Newly merged landmark requirement

- [x] Fetch and merge main a5b3c51 in merge commit 38df1c0.
- [x] Preserve both Rust parity selections; measure combined scalar/SIMD
      engines at 496779/502680 bytes, and set the next 16 KiB budget (507904).
- [x] Run combined WASM parity/size tests: seven pass. `npm run check` passes.
- [x] Probe direct landmark integration with a regression: the count test
      fails before and passes afterward, but rate and continuation regress.
- [ ] Integrate landmarks while retaining rate accuracy and split agreement.
      The direct prototype is reverted: A gives 0.724734 versus true 1.15;
      its whole count is five and its two half-counts sum to seven.
- [x] Probe actual tracker window/voicing settings: all fifteen SDs exceed 5 Hz.
- [x] Inspect duplicate evaluation opportunity: all 39 actual heads in a
      forty-evaluation B fit are distinct after best-vertex reuse.

These additional measurements are recorded in the validation report. No
acceptance gate has been relaxed, and the PR remains unfinished.

## Peak-only legacy pitch follow-up

- [x] Add a failing regression for rate measurements that defer unused pitch.
- [x] Retain exact peak voicing decisions and cache each computed YIN frame.
- [x] Verify complete legacy diagnostics and fits against the saved baseline.
- [x] Run focused regressions on Node, Bun and Deno, then repository checks.
- [ ] Read fresh CI logs and update the PR with current-head results.

The objective needs only the legacy envelope rate during each candidate
evaluation. The prepared analysis can measure YIN at those peaks first,
then fill the other active frames only for diagnostics. This retains the
syllable counter, calibration, objective and accuracy thresholds.

The ten-second performance probe measures Stage A 2.017063 s (RTF 0.201706),
fit 47.356523 s, 39 renders and RSS 237608960 bytes. The final distance is
unchanged at 0.3580763979634746. Both local budgets pass; accuracy remains
unresolved.
