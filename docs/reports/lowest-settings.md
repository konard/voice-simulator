# Lowest settings: 8 kHz and one core

The matrix runs on 8000 Hz audio with `UV_THREADPOOL_SIZE=1`. The app row
runs in Chromium and uses its normal synthesis and recognition workers.
The other rows run in Node with no workers and no GPU. Input recordings
are converted with `resample`. The Rust engine runs with one thread and
no SIMD. Limits come from `tests/heavy/lowest-thresholds.json` and only
ever become stricter.

- Measured: 2026-11-28T05:55:41.181Z
- Commit: `93d7355e98d6867d0dc8180309c4dbf22bac152a`
- Command: `node scripts/run-heavy.mjs --suite lowest`
- CPU: Intel(R) Xeon(R) 6975P-C
- Node: v24.22.3
- Pinning: pinned with `taskset -c 0`
- Heap cap: `--max-old-space-size=192`

| Row | quality | js-1 | rust-1 | memory |
| --- | --- | --- | --- | --- |
| synthesis | certified | certified | certified | [failed](https://github.com/konard/voice-simulator/issues/173) |
| recognition | certified | certified | certified | [failed](https://github.com/konard/voice-simulator/issues/173) |
| streaming | certified | certified | certified | certified |
| voice-fit | certified | certified | certified | certified |
| session | certified | certified | certified | certified |
| copy | [failed](https://github.com/konard/voice-simulator/issues/178) | certified | certified | [failed](https://github.com/konard/voice-simulator/issues/173) |
| modes | certified | certified | certified | certified |
| app | certified | certified | — | — |

## Values and limits

| Row | Column | Metric | Value | Limit | Pass |
| --- | --- | --- | ---: | ---: | --- |
| synthesis | quality | WER increase over 16 kHz | 0.0022 | ≤ 0.05 | yes |
| synthesis | js-1 | real-time factor | 0.0211 | ≤ 0.25 | yes |
| synthesis | rust-1 | real-time factor | 0.0166 | ≤ 0.25 | yes |
| synthesis | memory | peak RSS (MB) | 364.707 | ≤ 256 | no |
| recognition | quality | PER increase over 16 kHz | 0.0125 | ≤ 0.05 | yes |
| recognition | quality | WER increase over 16 kHz | -0.0732 | ≤ 0.08 | yes |
| recognition | js-1 | real-time factor | 0.0813 | ≤ 0.25 | yes |
| recognition | rust-1 | real-time factor | 0.077 | ≤ 0.25 | yes |
| recognition | memory | peak RSS (MB) | 388.4141 | ≤ 256 | no |
| streaming | quality | stream text differing from batch (WER) | 0 | ≤ 0 | yes |
| streaming | js-1 | first partial with words (s) | 0.2541 | ≤ 1 | yes |
| streaming | js-1 | CPU load | 0.0829 | ≤ 0.25 | yes |
| streaming | rust-1 | first partial with words (s) | 0.2587 | ≤ 1 | yes |
| streaming | rust-1 | CPU load | 0.0694 | ≤ 0.25 | yes |
| streaming | memory | peak RSS (MB) | 230.3242 | ≤ 256 | yes |
| voice-fit | quality | vocal tract length error | 0.0275 | ≤ 0.05 | yes |
| voice-fit | quality | pitch error | 0.0214 | ≤ 0.03 | yes |
| voice-fit | js-1 | CPU time / audio time | 0.1759 | ≤ 1 | yes |
| voice-fit | rust-1 | CPU time / audio time | 0.1681 | ≤ 1 | yes |
| voice-fit | memory | peak RSS (MB) | 200.8438 | ≤ 256 | yes |
| session | quality | share of voices reaching stable | 1 | ≥ 1 | yes |
| session | quality | vocal tract length error | 0.0197 | ≤ 0.05 | yes |
| session | quality | pitch error | 0.0112 | ≤ 0.03 | yes |
| session | js-1 | CPU time / audio time | 0.0892 | ≤ 0.5 | yes |
| session | rust-1 | CPU time / audio time | 0.0833 | ≤ 0.5 | yes |
| session | memory | peak RSS (MB) | 203.2461 | ≤ 256 | yes |
| copy | quality | mean f0 RMSE (semitones) | 4.7335 | ≤ 1.5 | no |
| copy | quality | mean timing error (ms) | 305.2 | ≤ 30 | no |
| copy | quality | phonemes of the copy agreeing | 0.3628 | ≥ 0.9 | no |
| copy | js-1 | reported, no limit: CPU time / audio time 1.123 | — | — | certified |
| copy | rust-1 | reported, no limit: CPU time / audio time 0.8078 | — | — | certified |
| copy | memory | peak RSS (MB) | 382.1211 | ≤ 256 | no |
| modes | quality | share of modes recognised | 0.9167 | ≥ 0.8 | yes |
| modes | js-1 | real-time factor | 0.0988 | ≤ 0.25 | yes |
| modes | rust-1 | real-time factor | 0.0875 | ≤ 0.25 | yes |
| modes | memory | peak RSS (MB) | 234.4883 | ≤ 256 | yes |
| app | quality | text recognised back | 1 | ≥ 1 | yes |
| app | js-1 | synthesis worker real-time factor | 0.089 | < 1 | yes |
| app | js-1 | first sound (s) | 0.22 | ≤ 1 | yes |

## Runs

| Row | Engine | CPU (s) | Audio (s) | Peak RSS (MB) | Heap cap | Other measurements |
| --- | --- | ---: | ---: | ---: | --- | --- |
| synthesis | js | 8.266 | 391.707 | 364.707 | 192 MB | wer 0.3603, wer16k 0.3581, werIncrease 0.0022, rtf 0.0211, recognitionRtf 0.1545, utterances 160 |
| synthesis | rust | 6.501 | 391.707 | 322.9805 | 192 MB | wer 0.3603, rtf 0.0166, recognitionRtf 0.1441, utterances 160 |
| recognition | js | 87.119 | 1071.807 | 388.4141 | 192 MB | per 0.8782, wer 1.2264, per16k 0.8656, wer16k 1.2996, perIncrease 0.0125, werIncrease -0.0732, rtf 0.0813, utterances 127 |
| recognition | rust | 82.533 | 1071.807 | 345.125 | 192 MB | per 0.8782, wer 1.2264, rtf 0.077, utterances 127 |
| streaming | js | 4.976 | 60 | 185.6094 | 192 MB | textMismatch 0, firstPartial 0.2541, load 0.0829, partials 240, streamText The quick brown fox jumps over the lady dog. She says she ce…, batchText The quick brown fox jumps over the lady dog. She says she ce…, batchLastWord 59.9875, wholeInputLastWord 59.9875 |
| streaming | rust | 4.164 | 60 | 230.3242 | 192 MB | textMismatch 0, firstPartial 0.2587, load 0.0694, partials 240, streamText The quick brown fox jumps over the lady dog. She says she ce…, batchText The quick brown fox jumps over the lady dog. She says she ce…, batchLastWord 59.9875, wholeInputLastWord 59.9875 |
| voice-fit | js | 5.277 | 30 | 197.3242 | 192 MB | vocalTractLengthError 0.0275, pitchError 0.0214, cpuRatio 0.1759 |
| voice-fit | rust | 5.044 | 30 | 200.8438 | 192 MB | vocalTractLengthError 0.0275, pitchError 0.0214, cpuRatio 0.1681 |
| session | js | 5.351 | 60 | 198.2969 | 192 MB | stable 1, vocalTractLengthError 0.0197, pitchError 0.0112, cpuRatio 0.0892 |
| session | rust | 4.996 | 60 | 203.2461 | 192 MB | stable 1, vocalTractLengthError 0.0188, pitchError 0.0117, cpuRatio 0.0833 |
| copy | js | 125.53 | 111.78 | 376.8281 | 192 MB | f0RmseSemitones 4.7335, timingErrorMs 305.2, phonemeAgreement 0.3628, maxF0RmseSemitones 8.7262, maxTimingErrorMs 1122.5, cpuRatio 1.123, recordings 24 |
| copy | rust | 90.299 | 111.78 | 382.1211 | 192 MB | f0RmseSemitones 4.7335, timingErrorMs 305.2, phonemeAgreement 0.3628, maxF0RmseSemitones 8.7262, maxTimingErrorMs 1122.5, cpuRatio 0.8078, recordings 24 |
| modes | js | 10.81 | 109.405 | 233.9766 | 192 MB | modeShare 0.9167, rtf 0.0988, renderRtf 0.0229, utterances 60 |
| modes | rust | 9.571 | 109.405 | 234.4883 | 192 MB | modeShare 0.9167, rtf 0.0875, renderRtf 0.0172, utterances 60 |
| app | js | — | 11.289 | — | none | textBack 1, workerRtf 0.089, workerRtfMeasured 0.0148, firstSound 0.22, firstChunk 0.22, coldFirstSound 0.624, startDelay 0.219, sampleRate 8000, chunks 89, heard The quick brown fox jumps over the lazy dog. She sells sea s… |
