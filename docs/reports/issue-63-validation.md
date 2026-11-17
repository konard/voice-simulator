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
| Full result, progress generator and incremental API | Public declarations and API tests; JSON round trip | Implemented; head B split agreement fails |
| Fold-source search and voice-file interoperability | Conditional fold coordinates; save/load voice API assertion | Implemented |
| Legacy matching and analysis API | Wrappers keep five result keys; existing matching tests unchanged | Protocol passes; three accuracy regressions remain |
| Rust numerical port | Histogram, MAD, calibration inversion, objective, centered mel and simplex core; WASM parity tests | Implemented primitives; orchestration stays in JS |
| Production example app | Existing chunk tests/build and actual worker in Playwright | Verified before final mel correction; current CI tracked in PR |
| Documentation, CLI and release trigger | README, declarations, CLI help, roadmap and minor changeset | Implemented |
| Two-head unit accuracy and uncertainty | `tests/voice-fit.test.js` | Failing |
| Twenty-head synthetic accuracy and coverage | Full heavy run and archived raw data | Failing on measured revision |
| Every golden recording, both modes, SD/distance/MCD and manifest sex | 48 rows in `copy-voice-fit.md/json`; unreviewed rows marked `*` | Report complete; one distance gate fails on measured revision |
| Stage A and default-fit performance | `performance.mjs`, measured below | Passing on local machine |
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
Head B returns tract 19.662921 cm (6.286% error), pitch 126 Hz (26% error),
tenseness 0.816667 and rate 0.967456. Its tract and pitch gates fail.
After correcting mel units to dB, the ten-render distances are 5.916503 and
9.638724, respectively; the same heads are selected.

Head A's f0 histogram has 263 voiced frames, median 208.854756 Hz and
MAD 14.548368 Hz. The issue's formula gives
`1.4826 * 14.548368 / sqrt(263 / 20) = 5.948061 Hz`, exceeding the requested
5 Hz. Refinement can only increase this SD under the specified maximum rule.
The half-bin floor does not determine this value. Altering the voicing
threshold from 0 to 0.9 retains 261–263 frames and does not resolve the gate.
The required formula and this tracker output cannot also produce SD below 5.

Splitting head A gives matching stage A point estimates. For head B the
whole tract estimate is 19.662921 cm and the split estimate is 18.918919 cm:
3.784% disagreement, above 2%. Independent temporal tracking at the stretch
boundary changes the accepted formant distribution. The acceptance test
checks both heads so this limitation remains visible.

## Search and source investigation

With `maxRenders: 10`, round one's 60% budget is exactly six evaluations:
the initial vertex and one perturbation of each of its five coordinates.
There is no remaining reflection step. Round two has four evaluations,
insufficient to initialize its full six-dimensional transcript simplex.
The implementation returns the measured best point within the budget.

On head B, the original exact objective gives these round-one costs:

| Vertex | J | Aligned MCD (dB) |
| --- | --- | --- |
| Stage A | 12.873759 | 38.585606 |
| Tract 18.762921 cm | 11.959190 | 37.614472 |
| Pitch 126 Hz | 11.575915 | 34.013076 |

These diagnostic values precede the mel-unit correction. That correction
was verified by a new regression that fails before the fix and passes after;
it leaves the selected pitch unchanged. The stage A source is strongly biased:
head B's true breathiness is 0.2 but the default-head HNR table gives 0.659490.
Holding other stage A estimates fixed and supplying the known source reduces
the diagnostic distance from 12.873759 to 5.872068; restoring only jitter and
shimmer gives 12.852058. This is evidence that source error dominates the
compensating pitch step, not proof that the remaining optimizer is sufficient.

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

## Full heavy measurements

The archived [Markdown](copy-voice-fit.md) and [JSON](copy-voice-fit.json)
identify measured SHA 4d0737d and [run 44062254770](https://github.com/konard/voice-simulator/actions/runs/44062254770).
All 40 synthetic fits and 48 golden fits completed. These are measurements
of that revision, before later fixes and the mel-unit correction.

| Metric | With transcript | Without transcript | Required |
| --- | --- | --- | --- |
| Median tract error | 0.848% | 8.918% | 4% / 6% |
| Maximum tract error | 3.083% | 13.604% | 10% |
| Median pitch error | 4.191% | 2.771% | 2% |
| Median rate error | 18.745% | 12.706% | 8% |
| Median tenseness absolute error | 0.07167 | 0.07227 | 0.15 |
| Median breathiness absolute error | 0.08404 | 0.09988 | 0.2 |
| Tract 3 SD coverage | 20/20 | 0/20 | At least 16/20 |

Golden distance passes 47/48 comparisons. `hi-02` with text gives 17.561212
versus preset 17.515151. The ungated half-preset-distance target is met by
11/48 fits (22.92%); MCD improves by at least 0.5 dB for 37/48 (77.08%).
The manifest says `unknown` for speaker sex; the report preserves that value.

## Performance and CI evidence

`node experiments/issue-63/performance.mjs`, Node v26.13.0 on AMD EPYC
(with IBPB), 10 s input: statistics 1.981661 s, RTF 0.198166; default fit
55.922377 s, 34 renders after spread stopping, RSS 234,975,232 bytes.
This measurement precedes the final mel-unit correction.

Logs are saved under ignored `ci-logs/` and `experiments/issue-63/*.log`.
For run 44066232172 at c61c1b3, job 133982794439 (Node/Ubuntu), saved log
`test-node-ubuntu-133982794439.log` has unit failures at lines 4639–4664.
Legacy failures at lines 4665–4704 report female tract error 0.119755,
male pitch error 0.166478 and small-female tract error 0.176207, all above
the unchanged 0.1 gates. Other OS jobs also encounter the existing five-minute
suite budget; increasing it has not been used as a solution.

Earlier CI exposed a worker chunk above 500 kB, an obsolete WASM size
assertion, narrow-band F4 and a CodeQL source-factory guard. Those were fixed;
Rust Engine, example app and security passed at 49f1aa7. These infrastructure
passes do not satisfy the outstanding acoustic gates.
