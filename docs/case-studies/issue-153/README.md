# Golden-set IPA decoding accuracy

[Issue #153](https://github.com/konard/voice-simulator/issues/153) and [PR #159](https://github.com/konard/voice-simulator/pull/159)

Both accuracy requirements remain open. The boundary fix recovers a complete decoding for the 16 kHz English clip `en-06`, which had returned no phones. The benchmark uses the same 24 recordings and reference transcriptions as the baseline, known language, and both 16 and 8 kHz working rates. Each speaker has one head fitted to their recordings with `refine: false`. The evaluator uses the reference IPA for edit-distance scoring. All 24 references are unreviewed.

| Requirement            | PR #152 baseline | With boundary fix |         Target |
| ---------------------- | ---------------: | ----------------: | -------------: |
| Mean phone error       |           86.63% |            86.38% | At most 60.00% |
| Mean broad-class error |           50.99% |            50.07% | At most 35.00% |

## Disconnected decoding path

The last boundary before a 475 ms stretch of steady speech in `en-06` was at 0.540 s. The next candidate was at 1.015 s. The decoder accepts phone spans up to 400 ms, so the search could never cross that gap. Both implementations now interpolate additional boundary candidates where consecutive speech candidates would exceed this interval. A single pause arc still represents a detected pause of at least 150 ms.

The regression test uses flat articulation tracks on either side of a 900 ms pause. With the original boundary code, the test finds candidates at 0, 500, 1400 and 1900 ms. It now verifies intermediate candidates at 250 and 1650 ms, a complete decoding path and the unsplit pause. The Rust/WASM parity test also covers uninterrupted steady speech.

## Results by language

These numbers average the two rates for each of the six recordings per language.

| Language | Phone error | Broad-class error |
| -------- | ----------: | ----------------: |
| English  |      82.39% |            56.60% |
| Russian  |      85.81% |            49.48% |
| Hindi    |      82.30% |            40.16% |
| Mandarin |      95.04% |            54.02% |

## What limits further improvement

The oracle computes the minimum edit distance over paths through the existing candidate graph. It ranks labels by the existing span score before phonotactics and uses the reference only to select an optimal path for each metric.

| Oracle choices                               | Minimum phone error | Minimum broad-class error |
| -------------------------------------------- | ------------------: | ------------------------: |
| Decoded boundaries and all labels            |              25.90% |                    25.11% |
| All boundaries and top label per span        |              84.56% |                    47.24% |
| All boundaries and top three labels per span |              69.88% |                    38.69% |
| All boundaries and top five labels per span  |              58.97% |                    25.55% |
| All boundaries and all labels                |              10.74% |                     3.79% |

The top three span labels would miss both targets even if the search could choose the best boundaries and labels with the reference. The graph has paths that meet the targets once the oracle can select from more labels. The observed scores seldom put those labels first. The [synthetic rank diagnostic](../../CODEBOOK.md#audio-to-ipa) also found that supplying the planner's articulation at the exact phone times raised the number of first-place labels from 90 to 401 out of 650.

The duration and score-weight probes, including the use of raw periodicity, spectral gravity, local energy and formants, reached 84.5% phone and 48.3% broad-class error in their best shared trial. A text-only prior weighted by lexicon frequency gave 82.6% and 47.5% in its best shared trial with those acoustic features. These comparisons use exploratory scores. The production decoder uses its existing acoustic and phonotactic weights.

## Reproduce

```sh
node --test --test-name-pattern='decodes steady speech' tests/recognition-decode.test.js
CARGO_BUILD_JOBS=1 node scripts/build-wasm.mjs --require --check-size
REQUIRE_WASM=1 node --test tests/rust-decode.test.js
HEAVY_OUT=/tmp/issue-153 node --test --test-name-pattern=golden tests/heavy/recognition-decode.test.js
node experiments/issue-153-decoder-diagnostics.mjs
node experiments/issue-153-evidence.mjs
LEXICAL_PRIOR=1 node experiments/issue-153-evidence.mjs
```

See the [PR #152 baseline report](../../../reports/heavy/recognition-decode.md) for the original synthetic and golden results.
