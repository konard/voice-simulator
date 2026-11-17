# Issue 63 validation and remaining failures

This is an unfinished implementation in [PR 146](https://github.com/konard/voice-simulator/pull/146).
The PR remains a draft and must remain unmerged. Accuracy thresholds and the
existing matching tests have not been relaxed.

## Requirement inventory

The complete issue and all PR comment types were read. The issue has no
comments; the PR has three automation conversation comments and no inline
comments or reviews as of November 17, 2026. Required prerequisites
59, 60, 61, 17 and 32 are closed.
Optional fold source 33 and voice files 41 are merged. Landmark issue 62
merged during the CI repair follow-up. Its module is now present on this
branch, but the fitter still uses the envelope counter: the attempted
landmark integration introduces rate and continuation failures, as measured
below. This requirement is now explicitly unfinished.

| Requirement | Implementation and verification | Status |
| --- | --- | --- |
| Shared frame, pitch, formant and inverse-filter analysis | `voice-fit-statistics.js`; fixed-bin numerical tests | Implemented |
| Landmark nuclei after issue 62 merges | New module merged; `landmark-rate.mjs` compares counts and split behavior | Unfinished; direct integration breaks rate and continuation |
| Fixed JSON state, 20 voiced-frame minimum, defaults and parts | `copyState`, `statisticsResult`; silence, malformed-state and selection tests | Implemented |
| Median estimates, calibrated source/range/rate, MAD SDs | Committed calibration and `calibrate.mjs`; numerical tests | Implemented; recovery/uncertainty gates fail |
| Scaled acoustic objective, aligned transcript MCD and prior | `voice-fit-objective.js`; cached MCD compared with public metric after identical alignment | Implemented |
| Two bounded deterministic simplex rounds and render callback | `voice-fit-simplex.js`, `voice-fit.js`; budget/path tests | Implemented; parameter recovery fails |
| Full result, progress generator and incremental API | Public declarations and API tests; JSON round trip; both-head split regression | Implemented; split regression passes |
| Fold-source search and voice-file interoperability | Conditional fold coordinates; save/load voice API assertion | Implemented |
| Legacy matching and analysis API | Wrappers keep five result keys; existing matching tests unchanged | Protocol passes; three accuracy regressions remain |
| Rust numerical port | Histogram, MAD, calibration inversion, objective, centered mel and simplex core; WASM parity tests | Implemented primitives; orchestration stays in JS |
| Production example app | Existing chunk tests/build and actual worker in Playwright | Current app CI passes; browser worker checked |
| Documentation, CLI and release trigger | README, declarations, CLI help, roadmap and minor changeset | Implemented |
| Two-head unit accuracy and uncertainty | `tests/voice-fit.test.js` | Failing |
| Twenty-head synthetic accuracy and coverage | Full heavy run and archived raw data | Failing on measured revision |
| Every golden recording, both modes, SD/distance/MCD and manifest sex | 48 rows in `copy-voice-fit.md/json`; unreviewed rows marked `*` | Report complete; one distance gate fails on measured revision |
| Stage A and default-fit performance | `performance.mjs`, measured below; deferred unused render diagnostics | Passing on local machine |
| All runtime suites and final CI | GitHub runs linked in PR; preserved failed logs | Failing |

## Reproduce the unit failures

```sh
node --test tests/voice-fit.test.js tests/voice-match.test.js
node experiments/issue-63/statistics.mjs
node experiments/issue-63/objective.mjs
```

The specified short sentence is rendered with seed 1, JS waveguide at 16000 Hz.
With ten refinement renders, head A returns tract 14.767932 cm, pitch
208.854756 Hz, tenseness 0.616667 and rate 1.159574. These point estimates pass.
Head B returns tract 18.817204 cm (1.715% error), pitch 126 Hz (26% error),
tenseness 0.816667 and rate 0.967456. Its pitch gate fails.
At 3487780, the ten-render distances are 5.920842 and 8.294783,
respectively. Both no-refinement recovery cases and the 8000 Hz test pass.

Head A's f0 histogram has 263 voiced frames, median 208.854756 Hz and
MAD 14.548368 Hz. The issue's formula gives
`1.4826 * 14.548368 / sqrt(263 / 20) = 5.948061 Hz`, exceeding the requested
5 Hz. Refinement can only increase this SD under the specified maximum rule.
The half-bin floor does not determine this value. Altering the voicing
threshold from 0 to 0.9 retains 261–263 frames and does not resolve the gate.
The required formula and this tracker output cannot also produce SD below 5.

`node experiments/issue-63/pitch-truth.mjs` also substitutes the renderer's
known pitch plan, without changing the recorded audio. The formula remains
above 5 Hz even without tracking error or histogram quantisation:

| Pitch observations | Frames | Histogram SD (Hz) | Unbinned MAD SD (Hz) |
| --- | --- | --- | --- |
| Tracked f0 | 263 | 5.948061 | 5.765623 |
| Known f0 at tracked voiced frames | 263 | 5.077536 | 5.373364 |
| Known f0 where planned voicing exceeds 0.5 | 249 | 5.218326 | 5.495896 |

The prescribed uncertainty calculation includes the sentence's intended
pitch variation. Replacing the tracker alone therefore does not establish
that the requested uncertainty gate can pass. Meeting both requirements
needs a change to the input, the specified observations or the SD rule;
none of those has been silently changed here.

The original batch formant tracker re-estimates its anatomical prior from
the whole utterance. For head B this gave 19.662921 cm whole and
18.918919 cm split: 3.784% disagreement. Holding the prior at the tracker's
initial 16.5 cm makes its accepted dF statistics comparable between stretches:
both estimates are now 18.817204 cm. Head A remains 14.767932 cm in both
cases. `formant-prior.mjs` isolates this cause; the two-head continuation
regression fails before the fix and passes at 3487780. No audio is buffered.

## Search and source investigation

With `maxRenders: 10`, round one's 60% budget is exactly six evaluations:
the initial vertex and one perturbation of each of its five coordinates.
There is no remaining reflection step. Round two has four evaluations,
insufficient to initialize its full six-dimensional transcript simplex.
The implementation returns the measured best point within the budget.

`node experiments/issue-63/objective.mjs` at 3487780 gives these round-one
costs on head B, including the required prior penalty:

| Vertex | J | Aligned MCD (dB) |
| --- | --- | --- |
| Stage A | 12.283960 | 37.873217 |
| Tract 17.917204 cm | 11.728838 | 36.760601 |
| Pitch 126 Hz | 10.752796 | 33.128387 |

The mel-unit correction has a regression that fails before the fix and
passes after; the objective still selects the incorrect pitch. The stage A
source is strongly biased:
head B's true breathiness is 0.2 but the default-head HNR table gives 0.659490.
Holding other stage A estimates fixed and supplying the known source reduces
the diagnostic distance from 12.283960 to 3.135942; restoring only jitter and
shimmer gives 12.053483. The known true head gives zero distance. In round
two, the breathiness vertex moves from 0.659490 to 0.559490 and lowers J
to 8.310783 while retaining 126 Hz. This is evidence that source error dominates the
compensating pitch step, not proof that the remaining optimizer is sufficient.

The default-head constants were rechecked with
`node experiments/issue-63/calibrate.mjs` after merging current main.
The five HNR entries reproduce to their stored precision; default
f0 range is 7.146042 semitones and pooled syllable rate is 3.058104/s,
matching the committed range factor and `10 / 3.27` rate constant.

Bounded attempts kept as reproducible experiments:

- `hnr-interpolation.mjs`: seven rendered heads; cubic fractional-lag
  correlation, pitch-slope compensation and a 17-lag search within 4% of the
  tracked period. Each alternative uses its own five-point default-head
  calibration. Head B still reads breathiness 0.568 with compensation and
  0.557 with lag search, versus the true 0.2. These alternatives were not
  substituted into the shared inverse-filter implementation.
- `calibration-sensitivity.mjs`: three default-head calibrations, ten exact
  vertices per alternative. Calibrating range and HNR on the short sentence
  still selects 126 Hz and 19.662921 cm. It lowers J to 7.716519 without
  recovering the parameters. This experiment also precedes the dB correction.
- `voicing.mjs`: finite threshold sweep of the specified head A, showing
  that soft voicing decisions do not explain its uncertainty failure.
- `pitch-truth.mjs`: compares tracked and known planned f0 on the same
  frames, with histogram and unbinned MAD calculations, as tabulated above.
- `hnr-signal.mjs`: seven heads with separately calibrated HNR of raw
  speech, 400 Hz high-passed speech and the inverse-filter derivative.
  Head B reads breathiness 0.661, 0.525 and 0.954 respectively, versus
  the true 0.2. Neither alternate signal was substituted into the tracker.

## Full heavy measurements

The archived [Markdown](copy-voice-fit.md) and [JSON](copy-voice-fit.json)
identify measured SHA 3487780 and [run 44072776328](https://github.com/konard/voice-simulator/actions/runs/44072776328).
All 40 synthetic fits and 48 golden fits completed in 1,739 s. These
measurements include the mel-unit, deferred-diagnostic and fixed-prior
corrections. Both heavy tests still fail. The synthetic assertion lists
all seven failing gates at line 697 of `heavy-44072776328.log`; the
golden assertion is at line 711.

| Metric | With transcript | Without transcript | Required |
| --- | --- | --- | --- |
| Median tract error | 0.857% | 6.753% | 4% / 6% |
| Maximum tract error | 2.793% | 10.178% | 10% |
| Median pitch error | 4.061% | 2.487% | 2% |
| Median rate error | 16.141% | 13.588% | 8% |
| Median tenseness absolute error | 0.05993 | 0.04997 | 0.15 |
| Median breathiness absolute error | 0.07587 | 0.08140 | 0.2 |
| Tract 3 SD coverage | 20/20 | 7/20 | At least 16/20 |

Golden distance passes 47/48 comparisons. `hi-02` with text gives 18.010081
versus preset 17.397847. The ungated half-preset-distance target is met by
3/48 fits (6.25%); MCD improves by at least 0.5 dB for 37/48 (77.08%).
The manifest says `unknown` for speaker sex; the report preserves that value.
All 12,144 parameter records in the archived JSON have finite values and
nonnegative finite SDs. The earlier complete run 44062254770 remains
available in Actions; it predates the corrections and is not the current
measurement.

## Performance and CI evidence

`npm run check` passes locally after the fixed-prior correction and the
evidence scripts: engine coverage, lint, formatting, duplication and
dependency policy (699 packages, 1,553 files). The numerical, scalar
WASM parity and actual matching-worker selection passes nine tests on
each of Node, Bun and Deno. This selection does not include the failed
acoustic acceptance assertions.

`node experiments/issue-63/performance.mjs`, Node v26.13.0 on AMD EPYC
(with IBPB), 10 s input at 3487780: statistics 1.928274 s, RTF 0.192827;
default fit 49.750774 s, all 40 renders, RSS 236,314,624 bytes.

After the mel-unit correction, the first complete 40-render measurement
took 65.898798 s and exceeded the budget. The bounded `timing.mjs` probe
found unnecessary legacy HNR/H1-H2 diagnostics on every candidate; those
are excluded from the objective, which uses inverse-filter histograms.
Deferring them to the returned render reduced the same search to
52.845828 s with exactly the same distance, 0.3974208391680957. Verbose
tracing still computes every render's diagnostics; the determinism test
asserts complete equality between normal and traced results, including the
winning render's features. The subsequent fixed-prior change gives the
49.750774 s measurement above.

Logs are saved under ignored `ci-logs/` and `experiments/issue-63/*.log`.
At 3487780, [run 44072787727](https://github.com/konard/voice-simulator/actions/runs/44072787727),
Deno/Ubuntu job 134003920312 finishes in 235 s with 2,954 passes and five
failures. Saved log `test-deno-ubuntu-134003920312.log` records transcript
recovery at line 4208 and uncertainty at line 4218. The continuation test
passes. Legacy failures at lines 4226, 4234 and 4242 report female speech-rate
error 0.119755, male pitch error 0.156910 and small-female speech-rate error
0.138217, all above the unchanged 0.1 gates. The complete result is at
line 4257. Earlier OS jobs also encountered the existing five-minute
suite budget; increasing it has not been used as a solution.

In the same run, Node/Ubuntu job 134003920407 reaches the 300 s suite
budget at line 4450 of `test-node-ubuntu-134003920407.log`. Its two new
acceptance assertions fail at lines 4667 and 4681; the matching file is
still running when the budget wrapper terminates it (line 4693). The
Deno result above completes those tests and identifies their actual errors.

The complete workflow log, `checks-44072787727.log`, confirms the same
five assertions on Bun/Ubuntu: 2,956 passes and five failures in 435 s
(lines 36982–36994). Bun/macOS and Bun/Windows reach their 500 s suite
budgets; Node on all three operating systems and Deno/macOS/Windows
reach 300 s. These are additional unfinished performance checks, not
evidence that the accuracy assertions pass on those platforms.

Earlier CI exposed a worker chunk above 500 kB, an obsolete WASM size
assertion, narrow-band F4 and a CodeQL source-factory guard. Those were fixed;
Rust Engine, example app and security passed at 49f1aa7. These infrastructure
passes do not satisfy the outstanding acoustic gates.

## CI repair follow-up at f525c91

The latest default branch was fetched and is already an ancestor of this
implementation commit. The fresh complete failed run
[44077893432](https://github.com/konard/voice-simulator/actions/runs/44077893432)
at 75cd6c7 was downloaded to `ci-logs/checks-44077893432.log` before
investigation. It confirms five assertion failures on the runtimes that
finish, as well as suite-budget overruns. These are numerical and runtime
failures; no missing secret or repository access was found.

The candidate evaluator now retains its already prepared legacy analysis
for completion of the winning render's HNR/H1-H2 diagnostics. It also
reuses the best vertex when the next simplex round evaluates the identical
head. Cached evaluations do not increment `renders` or call `onStep`;
the simplex budget and objective are unchanged. Only one best evaluation
is cached; the cache cannot grow with `maxRenders`.

New automated regressions pass on Node, Bun and Deno:

```sh
node --test --test-name-pattern='deferred source|reuses an identical|is deterministic' tests/voice-fit-numerics.test.js tests/voice-fit.test.js
bun test --test-name-pattern 'deferred source|reuses an identical|is deterministic' tests/voice-fit-numerics.test.js tests/voice-fit.test.js
deno test -A --filter '/deferred source|reuses an identical|is deterministic/' tests/voice-fit-numerics.test.js tests/voice-fit.test.js
node experiments/issue-63/legacy-diagnostics.mjs
```

Each runtime passes all three selected regressions. The last command loads
the pre-change implementation from 75cd6c7 into temporary modules, compares
eager and deferred diagnostics on both specified heads, and checks exact
equality of the two-render fit results except `renders`: two actual renders
before, one after. The new vertex-count regression fails before the fix.
`npm run check` passes locally. No Rust numerical expressions change in
this refactor.

The ten-second performance command at f525c91, on Node v26.13.0 and AMD
EPYC (with IBPB), measures Stage A at 2.335652 s (RTF 0.233565), refinement
at 54.247191 s with 39 actual renders, and RSS 231,686,144 bytes. Both
performance gates pass locally. This run is not a controlled wall-time
comparison with the earlier measurement.

The bounded source probes did not resolve the accuracy gates:

- `source-reliability.mjs` measures 15 recordings. Calibrating a stationary
  subset of reliable frames improves head B's pitch but changes the specified
  median-HNR estimator. A temporary experiment still returns speech rate
  1.097456 for its true 0.9 and leaves two legacy regressions. That production
  change was discarded; only the experiment scripts remain.
- `hnr-window.mjs` compares five window rules on seven recordings. Capping
  the HNR window at 30 ms improves B's inferred breathiness from 0.653678
  to 0.531536, still far from its true 0.2. The inverse-filter definition and
  calibration table were left unchanged.
- `analysis-rates.mjs` compares the existing working-rate option at 8000,
  11025 and 16000 Hz on both heads. Head A's prescribed pitch SD remains
  5.959401, 5.948061 and 5.948061 Hz, respectively. Changing the working
  rate does not satisfy its uncertainty gate.
- `hnr-cycle.mjs` measures seven recordings with weighted cycle-pair
  correlation, separate amplitude normalization, cubic interpolation and
  an optional nine-lag search spanning 2% either side of the tracked period.
  Each variant has its own five-point default-head calibration. Stable
  subsets still infer B breathiness at least 0.306325 versus 0.2; the best
  all-frame result is 0.386895. This does not establish a production fix.

The focused failing acceptance selection was re-run after the refactor:

```sh
node --test --test-name-pattern='recovers synthetic voices with a transcript|reports uncertainty' tests/voice-fit.test.js
```

It still fails both assertions: head B selects pitch 126 Hz, and head A's
pitch SD exceeds 5 Hz. Both fits now use nine actual renders within the
unchanged ten-evaluation budget. The archived full heavy report remains
explicitly tied to its measured implementation revision; no new passing
heavy-suite result is claimed. The original acceptance criteria and tests
remain unchanged, and the PR must remain a draft while they fail.

### Fresh CI for the performance changes

[Run 44084995292](https://github.com/konard/voice-simulator/actions/runs/44084995292)
at full SHA `f525c91a21760027bf2131fe7d51457d7edd2b19` completed with failure.
Lint/format, types, documentation, changeset, simulation, Rust and Docker
checks pass. Separate app, security, workflows and link workflows pass.
The Deno/macOS job was cancelled without acquiring a runner, so the full-run
log command fails with `log not found: 134046098186`. Completed test-job logs
were downloaded individually instead; the missing runner log is not a test
result.

| Runtime / OS | Result | Saved log evidence |
| --- | --- | --- |
| Node / Ubuntu | 2,957 pass, five fail; 273 s, within 300 s | `test-node-ubuntu-134046098243.log`: summary 4663–4673; errors 4676–4737 |
| Node / Windows | 2,834 pass, five fail; 231 s, within 300 s | `test-node-windows-134046098229.log`: summary 4658–4665; errors 4670–4734 |
| Deno / Ubuntu | 2,956 pass, five fail; 259 s, within 300 s | `test-deno-ubuntu-134046098496.log`: errors 4210–4253; summary 4257 |
| Bun / Ubuntu | 2,957 pass, six fail; 433 s, within 500 s | `test-bun-ubuntu-134046098453.log`: failures and summary 4681–4695 |
| Node / macOS | Two failures; matching file unfinished at 300 s | `test-node-macos-134046098560.log`: summary 4642–4648; failures 4653–4680 |
| Deno / Windows | Five accuracy failures before the 300 s budget | `test-deno-windows-134046098441.log`: failures 4164, 4167, 4174, 4176, 4177; budget 4179 |
| Bun / macOS | Accuracy failures and per-test timeouts before 500 s | `test-bun-macos-134046098464.log`: legacy errors/timeouts 3948–3988; budget 3989 |
| Bun / Windows | Accuracy failures and per-test timeouts before 500 s | `test-bun-windows-134046098207.log`: legacy errors/timeouts 4327–4367; budget 4368 |

The five common failures are transcript recovery at
`tests/voice-fit.test.js:52`, uncertainty at line 93, female speech-rate
error 0.119755, male pitch error 0.156910 and small-female speech-rate error
0.138217. The latter three exceed the unchanged 0.1 legacy thresholds at
`tests/voice-match.test.js:151` and line 157. Bun/Ubuntu additionally times
out the 0.8-breathiness test after 32,829 ms against its 30,000 ms limit.
These errors remain unresolved; no secret, access grant or other manual
credential action explains them. The measured local performance passes
and narrower CI passes are not substitutes for the unmet accuracy gates.

## Default-branch landmark merge follow-up

Main advanced to `a5b3c51` (landmark PR 142) during this investigation.
Merge commit `38df1c0` retains both numerical implementations and runs both
WASM parity suites in CI. The combined scalar engine is 496779 bytes
(SHA-256 `42ff9dc1c2c04e5e9647476aea329fb4ba59886bf381eea3cb99e415e107026f`);
SIMD is 502680 bytes. Rust 1.100.0 builds with one Cargo job complete in
21.82 s and 21.17 s. The shared size budget and its assertion now use the
next 16 KiB boundary, 507904 bytes. See the exact build commands in
`docs/RUST-ENGINE.md`.

```sh
REQUIRE_WASM=1 node --test tests/voice-fit-rust-parity.test.js tests/rust-landmarks.test.js tests/engine-size.test.js
node experiments/issue-63/landmark-rate.mjs
node experiments/issue-63/pitch-settings.mjs
node experiments/issue-63/evaluation-cache.mjs
```

The seven combined parity/size tests pass. `npm run check` also passes on
the merged implementation (699 packages, 1,593 files). The bounded probes
use Node with `--max-old-space-size=384` and retain no additional audio.

The landmark probe measures these counts and existing speech-window durations:

| Input | Whole nuclei | First-half nuclei | Second-half nuclei | Whole speech seconds |
| --- | --- | --- | --- | --- |
| Default head, MATCH_TEXT | 16 | 8 | 8 | 3.27 |
| Head A, short acceptance sentence | 5 | 3 | 4 | 1.41 |
| Head B, short acceptance sentence | 7 | 4 | 3 | 1.69 |

A temporary regression comparing fitter nuclei with `findLandmarks` fails
before integration: B has five legacy nuclei versus seven landmarks.
Substituting landmark counts and recalibrating the default rate to
`16 / 3.27` makes that regression pass, but head A's ten-render rate becomes
0.724734 instead of its true 1.15. The two-half continuation test also fails:
A's pooled count is seven, while its whole-recording count is five.
Saved logs `landmark-rate-before.log` and `landmark-integration-node.log`
record these outcomes. That prototype was reverted; no new passing
landmark-based rate or continuation result is claimed. Both the previous
legacy regressions and this newly applicable requirement remain unfinished.
The calibration experiment now reports landmark measurements alongside the
unchanged production envelope calibration.

The pitch-settings probe varies the actual tracker's minimum pitch across
40, 50, 60, 75 and 90 Hz, and its Viterbi voicing threshold across 0.45,
0.6 and 0.75. All fifteen cases retain median 208.854756 Hz; the prescribed
histogram SD ranges from 5.936785 to 6.040643 Hz. None meets the <5 Hz gate.
This is separate from filtering the already computed soft voicing scores.
No tracker defaults or observations were changed in production.

The cache probe executes a full 40-evaluation head B fit after the earlier
best-vertex reuse. All 39 actual renders are distinct, with no further
exact repeated heads. Extending the cache would not save work in this case.
These negative probes do not fix the remaining accuracy or CI timeout
failures, and are retained so they need not be repeated without new evidence.

## Peak-only legacy pitch evaluation

Each refinement candidate previously ran legacy YIN over every active frame,
although its envelope rate only consults voicing at local peaks. The prepared
analysis now caches those peak decisions and completes the other active
frames only when full features or diagnostics are requested. The counter,
calibration, objective and all acceptance thresholds are unchanged. Optional
`legacy-voice-pitch` trace events expose the evaluated and active frame counts;
tracing remains disabled by default.

The regression `measures syllable rate using only peak frames before completing
legacy pitch` fails before this change (`lazy-yin-before.log`: undefined
`rateFeatures`) and passes afterward. The four focused deferred-analysis,
vertex-reuse and determinism regressions pass on Node, Bun and Deno.

```sh
node --test --test-name-pattern='measures syllable rate|deferred source|reuses an identical|is deterministic' tests/voice-fit-numerics.test.js tests/voice-fit.test.js
node experiments/issue-63/legacy-diagnostics.mjs
```

The baseline comparison against `75cd6c7` confirms identical complete features
and fits for both required heads, with and without the diagnostic-only option.
Before completion, A computes 10 peak YIN frames instead of all 138 active
frames; B computes 14 instead of 166 (`lazy-yin-legacy-counts.log`). The winning
render still receives the exact full diagnostics. This is a work reduction,
not evidence that any outstanding acoustic criterion has been fixed.

The bounded ten-second performance probe on Node v26.13.0 / AMD EPYC
measures Stage A at 2.017063 s (RTF 0.201706), refinement at 47.356523 s
with 39 actual renders and RSS 237608960 bytes. Its final distance is
0.3580763979634746, identical to the previous probe. Both local budgets
pass; these timings are not a controlled before/after comparison.
`npm run check` passes (699 packages, 1596 files).

Merged-head CI run 44090743237, created 2026-11-17 at 13:14:27 UTC for SHA
`3611634a383126d0ef97e46db37dcba8b1edd2fb`, finished with failure before this
additional optimization. All nine runtime jobs fail; infrastructure, Rust,
app, security, workflow and link checks pass. The complete run log and
individual completed-job logs are preserved under ignored `ci-logs/`.

| Runtime / OS | Result | Saved log evidence |
| --- | --- | --- |
| Node / Ubuntu | 3005 pass, five accuracy failures; 249 s / 300 s | `merged-node-ubuntu-134065703624.log`: errors 4772–4824, duration 4833 |
| Deno / Ubuntu | 3004 pass, same five failures; 225 s / 300 s | `merged-deno-ubuntu-134065703568.log`: errors 4295–4329, summary 4344–4347 |
| Bun / Ubuntu | 3005 pass, six fail; 429 s / 500 s | `merged-bun-ubuntu-134065703652.log`: summary 4775–4796; female and breathiness tests exceed 30 s |
| Node / Windows | Two acceptance failures and unfinished matching file at 300 s | `merged-node-windows-134065703623.log`: budget 4541, errors 4745, 4759 |
| Deno / Windows | Unfinished matching file at 300 s | `merged-deno-windows-134065703801.log`: budget 4288 |
| Bun / Windows | Legacy errors and 30 s timeouts; suite reaches 500 s | `merged-bun-windows-134065703533.log`: 4426–4467 |
| Node / macOS | Two acceptance failures and unfinished matching file at 300 s | `merged-node-macos-134065703714.log`: summary 4736–4743, errors 4750, 4764 |
| Deno / macOS | Legacy accuracy failures; suite reaches 300 s | `merged-deno-macos-134065703622.log`: 4243–4250 |
| Bun / macOS | Legacy errors and 30 s timeouts; suite reaches 500 s | `merged-bun-macos-134065703689.log`: 4047–4090 |

The Pipeline Status job correctly fails because `test` failed
(`merged-pipeline-134073738337.log`: 266–268). This evidence predates the
peak-only optimization and is not its current-head verification.

## Second restart: source and rate compensation

The complete issue, all seven current PR conversation comments, inline
comments and reviews were read again. There are still no issue comments,
inline PR comments or reviews. Fresh run
[44094741268](https://github.com/konard/voice-simulator/actions/runs/44094741268)
belongs to `dc376f55abf391f2f96878dcf7b5aa7fef0e8d29`, created November 17,
2026 at 13:38:24 UTC. Its full log is preserved as
`ci-logs/ci-44094741268.log`. Node/Ubuntu lines 15388–15458 show the same
five accuracy failures after the previous optimization. These are genuine
assertion failures, independent of the additional slower-runner timeouts.
There is no missing credential or access grant that can explain them.

```sh
node --max-old-space-size=384 experiments/issue-63/reliability-boundaries.mjs
node --max-old-space-size=384 experiments/issue-63/rate-source-coupling.mjs
```

The first bounded probe renders nine recordings: five default-head source
calibrations, the two required heads and two legacy presets. It measures
source stationarity, pitch smoothing and landmark dip thresholds separately.
Median pitch filtering over radii 0, 2, 5, 10 and 20 frames leaves A's
histogram SD at 5.948061 Hz in every case. Raising the landmark dip from
2 to 3 dB decreases A's nucleus count from five to four and B's from seven
to six; this does not establish a consistent rate counter. Neither the
observations nor the uncertainty formula was changed in production.
Fresh executions of `experiments/issue-63/pitch-truth.mjs` on Node, Bun
and Deno produce identical JSON: tracked SD 5.948061 Hz, known f0 at the
tracked voiced frames 5.077536 Hz, and known f0 at planned voiced frames
5.218326 Hz. Removing histogram quantisation also leaves each above 5 Hz.

A temporary stationary-source initializer was also tested against all six
affected recovery cases. It used a separately measured five-point HNR
calibration and retained source frames with a relative pitch slope below
0.005 across adjacent frames. B's pitch improved to 100 Hz, but its rate
became 1.097456 instead of 0.9. All three legacy preset cases still failed;
only the two breathiness cases passed. The focused log
`ci-logs/stable-source-focused.log` records four failures and two passes.
This prototype was discarded; these source changes are not part of the PR.

The second probe isolates why a source-only change is insufficient. It
holds B's other Stage A estimates fixed and compares the initial rate
0.967456 with the permitted simplex vertex at 1.097456. These are eight
explicit evaluations, not a fit or an altered objective. Distances omit
the prior, as required for the public result:

| Supplied breathiness | Initial-rate distance | Faster-rate distance |
| --- | --- | --- |
| 0.20 (the known true value) | 4.987658 | 4.906348 |
| 0.25 | 3.991928 | 3.990987 |
| 0.30 | 3.636871 | 3.648031 |
| 0.35 | 4.108116 | 4.081722 |

Even supplying the true breathiness does not correct the other source
estimates: the distance improvement of 0.081311 at the faster vertex
exceeds its 0.008 prior penalty. The objective still prefers a rate
outside the requested tolerance. Tuning the HNR table to force a particular
vertex would not demonstrate a general correction. The source, rate,
uncertainty, landmark, legacy, heavy and runtime criteria remain unfinished.
No thresholds, tests, objective weights or timeouts were relaxed or skipped.

## Speech-mode merge verification

Main advanced to `ab5449363a21042644aa9357e07b441f05dd0167` during the
second restart. Its acoustic-mode exports and declarations, Rust mode
parity suite and two-process Bun runner are preserved alongside voice
fitting and landmark parity. All four merge conflicts were resolved.

```sh
CARGO_BUILD_JOBS=1 node scripts/build-wasm.mjs --require --check-size
REQUIRE_WASM=1 node --test tests/voice-fit-rust-parity.test.js tests/rust-modes.test.js tests/rust-landmarks.test.js tests/engine-size.test.js tests/bun-shards.test.js tests/recognition-mode-integration.test.js
npm run check
```

The scalar engine measures 502658 bytes, SHA-256
`68b261b3632a31ffa89144ad497a7bbf45faeadfd2c9b2b364265423a28b049f`;
SIMD measures 507788 bytes and remains unshipped. Both fit the unchanged
507904-byte budget. The six focused suites pass all 26 tests with no
skips; repository checks pass (699 packages, 1635 files). Logs are saved as
`ci-logs/merge-ab54493-wasm.log`, `ci-logs/merged-modes-fit-parity.log` and
`ci-logs/merged-check.log`. These merge checks do not establish recovery
accuracy or a passing full runtime matrix.

## Fresh merged-head failures and runtime scheduling

Run [44104176844](https://github.com/konard/voice-simulator/actions/runs/44104176844)
was created November 17 at 14:32:12 UTC for
`c96a9bd9926acadfe77b304793e1d2b4275241ba` and completed with failure.
All nine runtime jobs fail. The downloaded full log is
`ci-logs/ci-44104176844.log`; individual jobs use the prefix
`ci-logs/modes-merge-`. All infrastructure and the four other workflows pass.

| Runtime | Ubuntu | macOS | Windows |
| --- | --- | --- | --- |
| Node | 300 s deadline | 300 s deadline | 300 s deadline |
| Deno | 3223 pass, 5 fail, 301 s reported | 300 s deadline | 3103 pass, 5 fail, 299 s |
| Bun | 3226 pass, 5 fail, 222 s | 3214 pass, 7 fail, 369 s | 3103 pass, 6 fail, 372 s |

The five numerical errors are unchanged. Bun Ubuntu job 134112763531
records legacy rate/pitch/rate errors at lines 3261, 3372 and 3507;
transcript recovery and uncertainty fail at lines 4860 and 4878.
Node Ubuntu job 134112763651 reaches its deadline at line 4956 and
cancels the matching file at line 5198. Node macOS job 134112763607
reaches its deadline at line 4940; the matching file has run for only
85044 ms when cancelled (line 5183). Node Windows job 134112763993
reaches its deadline at line 4950. Deno macOS job 134112763649 reports
all five assertion failures before its deadline at line 4921.
Bun macOS job 134112763767 also times out female matching, breathiness
0.8 and the no-transcript preset comparison (lines 3248, 4018 and 4869);
female matching already fails accuracy. Bun Windows job 134112763565
times out female matching and breathiness 0.8 (lines 2971 and 3483).
Pipeline Status job 134122971628 says `Failing jobs: test` at line 269.

The new shared launcher changes scheduling while keeping the same test
files, native test runtimes and deadlines. Node and Deno start the expensive
matching file alongside the bulk queue; Bun runs matching alone before the
two native bulk shards, avoiding competing DSP work during its 30 s tests.
Both peers are reaped even after any preceding failure. The existing Bun
entry point and ordinary `npm test` command remain available.

```sh
node --test tests/bun-shards.test.js tests/ci-timeouts.test.js
bun test tests/bun-shards.test.js tests/ci-timeouts.test.js
deno test -A tests/bun-shards.test.js tests/ci-timeouts.test.js
node experiments/issue-63/test-order.mjs
```

All 23 fixture/budget checks pass on each runtime. Fixtures verify full
file selection, the required phase ordering, overlap, completion and
failure propagation for every phase. The finite native probe confirms
Node's alphabetic CLI discovery and that Bun's two shards select disjoint
files even with explicit paths: three files in the full selection, two in
shard one and one in shard two, without missing or duplicate files.
The bounded ordering regression also runs against the previous main-branch
launcher and this draft in disposable fixtures: the previous launcher exits
1 and the draft exits 0. `npm run check` passes (699 packages, 1629 files).
Actual runner timing still needs CI verification. Scheduling does not
correct the five accuracy assertions or the landmark/heavy requirements.
