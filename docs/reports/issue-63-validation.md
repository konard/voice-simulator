# Issue 63 validation and remaining failures

This is an unfinished implementation in [PR 146](https://github.com/konard/voice-simulator/pull/146).
The PR remains a draft and must remain unmerged. Accuracy thresholds and the
existing matching tests have not been relaxed.

## Requirement inventory

The complete issue and all PR comment types were read; none contained comments
at the latest review. Required prerequisites 59, 60, 61, 17 and 32 are closed.
Optional fold source 33 and voice files 41 are merged. Landmark issue 62 is
open and its module is absent, so the specified envelope fallback is used.

| Requirement | Implementation and verification | Status |
| --- | --- | --- |
| Shared frame, pitch, formant and inverse-filter analysis | `voice-fit-statistics.js`; fixed-bin numerical tests | Implemented |
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
passes. Legacy failures at lines 4226, 4234 and 4242 report female tract
error 0.119755, male pitch error 0.156910 and small-female tract error
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
