# Lowest settings: 8 kHz and one core

Every row runs on 8000 Hz audio in its own Node process with
`UV_THREADPOOL_SIZE=1`, no workers and no GPU. Input recordings are
converted with `resample`. The Rust engine runs with one thread and no
SIMD. Limits come from `tests/heavy/lowest-thresholds.json` and only ever
become stricter.

- Measured: 2026-11-28T01:29:33.586Z
- Commit: `4bc0a83f29fb04c65a5e1f7f0f153e408afac427`
- Command: `node scripts/run-heavy.mjs --suite lowest`
- CPU: Intel(R) Xeon(R) 6975P-C
- Node: v24.22.3
- Pinning: pinned with `taskset -c 0`
- Heap cap: `--max-old-space-size=192`

| Row | quality | js-1 | rust-1 | memory |
| --- | --- | --- | --- | --- |
| synthesis | certified | certified | certified | [failed](https://github.com/konard/voice-simulator/issues/173) |
| recognition | certified | certified | certified | [failed](https://github.com/konard/voice-simulator/issues/173) |
| streaming | [failed](https://github.com/konard/voice-simulator/issues/175) | [failed](https://github.com/konard/voice-simulator/issues/175) | [failed](https://github.com/konard/voice-simulator/issues/175) | [failed](https://github.com/konard/voice-simulator/issues/173) |
| voice-fit | certified | certified | certified | [failed](https://github.com/konard/voice-simulator/issues/173) |
| session | [failed](https://github.com/konard/voice-simulator/issues/177) | [failed](https://github.com/konard/voice-simulator/issues/177) | [failed](https://github.com/konard/voice-simulator/issues/177) | [failed](https://github.com/konard/voice-simulator/issues/173) |
| copy | [failed](https://github.com/konard/voice-simulator/issues/178) | certified | certified | [failed](https://github.com/konard/voice-simulator/issues/173) |
| modes | certified | certified | certified | [failed](https://github.com/konard/voice-simulator/issues/173) |
| app | [failed](https://github.com/konard/voice-simulator/issues/180) | certified | — | — |

## Values and limits

| Row | Column | Metric | Value | Limit | Pass |
| --- | --- | --- | ---: | ---: | --- |
| synthesis | quality | WER increase over 16 kHz | 0.0033 | ≤ 0.05 | yes |
| synthesis | js-1 | real-time factor | 0.1856 | ≤ 0.25 | yes |
| synthesis | rust-1 | real-time factor | 0.0523 | ≤ 0.25 | yes |
| synthesis | memory | peak RSS (MB) | 446 | ≤ 256 | no |
| recognition | quality | PER increase over 16 kHz | 0.0112 | ≤ 0.05 | yes |
| recognition | quality | WER increase over 16 kHz | -0.082 | ≤ 0.08 | yes |
| recognition | js-1 | real-time factor | 0.1817 | ≤ 0.25 | yes |
| recognition | rust-1 | real-time factor | 0.1591 | ≤ 0.25 | yes |
| recognition | memory | peak RSS (MB) | 549.2 | ≤ 256 | no |
| streaming | quality | stream text differing from batch (WER) | 0.4357 | ≤ 0 | no |
| streaming | js-1 | first partial with words (s) | 1.1662 | ≤ 1 | no |
| streaming | js-1 | CPU load | 0.916 | ≤ 0.25 | no |
| streaming | rust-1 | first partial with words (s) | 0.9916 | ≤ 1 | yes |
| streaming | rust-1 | CPU load | 0.7827 | ≤ 0.25 | no |
| streaming | memory | peak RSS (MB) | 436.5 | ≤ 256 | no |
| voice-fit | quality | vocal tract length error | 0.0275 | ≤ 0.05 | yes |
| voice-fit | quality | pitch error | 0.0214 | ≤ 0.03 | yes |
| voice-fit | js-1 | CPU time / audio time | 0.3093 | ≤ 1 | yes |
| voice-fit | rust-1 | CPU time / audio time | 0.2773 | ≤ 1 | yes |
| voice-fit | memory | peak RSS (MB) | 348.7 | ≤ 256 | no |
| session | quality | share of voices reaching stable | 0 | ≥ 1 | no |
| session | quality | vocal tract length error | 0.0226 | ≤ 0.05 | yes |
| session | quality | pitch error | 0.0742 | ≤ 0.03 | no |
| session | js-1 | CPU time / audio time | 2.7687 | ≤ 0.5 | no |
| session | rust-1 | CPU time / audio time | 2.2327 | ≤ 0.5 | no |
| session | memory | peak RSS (MB) | 457.3 | ≤ 256 | no |
| copy | quality | mean f0 RMSE (semitones) | 6.0356 | ≤ 1.5 | no |
| copy | quality | mean timing error (ms) | 274.5 | ≤ 30 | no |
| copy | quality | phonemes of the copy agreeing | 0.4401 | ≥ 0.9 | no |
| copy | js-1 | reported, no limit: CPU time / audio time 5.4922 | — | — | certified |
| copy | rust-1 | reported, no limit: CPU time / audio time 5.3387 | — | — | certified |
| copy | memory | peak RSS (MB) | 913 | ≤ 256 | no |
| modes | quality | share of modes recognised | 0.9 | ≥ 0.8 | yes |
| modes | js-1 | real-time factor | 0.1831 | ≤ 0.25 | yes |
| modes | rust-1 | real-time factor | 0.1663 | ≤ 0.25 | yes |
| modes | memory | peak RSS (MB) | 435.1 | ≤ 256 | no |
| app | quality | text recognised back | 0.6875 | ≥ 1 | no |
| app | js-1 | synthesis worker real-time factor | 0.09 | ≤ 1 | yes |
| app | js-1 | first sound (s) | 0.217 | ≤ 1 | yes |

## Runs

| Row | Engine | CPU (s) | Audio (s) | Peak RSS (MB) | Heap cap | Other measurements |
| --- | --- | ---: | ---: | ---: | --- | --- |
| synthesis | js | 72.707 | 391.707 | 446 | 192 MB | wer 0.3657, wer16k 0.3624, werIncrease 0.0033, rtf 0.1856, recognitionRtf 0.3966, utterances 160 |
| synthesis | rust | 20.489 | 391.707 | 438.6 | 192 MB | wer 0.3657, rtf 0.0523, recognitionRtf 0.2953, utterances 160 |
| recognition | js | 194.758 | 1071.807 | 549.2 | 192 MB | per 0.8777, wer 1.2163, per16k 0.8664, wer16k 1.2983, perIncrease 0.0112, werIncrease -0.082, rtf 0.1817, utterances 127 |
| recognition | rust | 170.5 | 1071.807 | 519.8 | 192 MB | per 0.8777, wer 1.2163, rtf 0.1591, utterances 127 |
| streaming | js | 54.96 | 60 | 436.5 | 192 MB | textMismatch 0.4357, firstPartial 1.1662, load 0.916, partials 247, streamText The quick brown fox jump sober the lady dog. She says she ce…, batchText The quick breach arcs jump sober the lady dog. She says she …, batchLastWord 59.9875 |
| streaming | rust | 46.964 | 60 | 416.6 | 192 MB | textMismatch 0.4357, firstPartial 0.9916, load 0.7827, partials 247, streamText The quick brown fox jump sober the lady dog. She says she ce…, batchText The quick breach arcs jump sober the lady dog. She says she …, batchLastWord 59.9875 |
| voice-fit | js | 9.279 | 30 | 331.3 | 192 MB | vocalTractLengthError 0.0275, pitchError 0.0214, cpuRatio 0.3093 |
| voice-fit | rust | 8.318 | 30 | 348.7 | 192 MB | vocalTractLengthError 0.0275, pitchError 0.0214, cpuRatio 0.2773 |
| session | js | 166.12 | 60 | 441.6 | 192 MB | stable 0, vocalTractLengthError 0.0226, pitchError 0.0742, cpuRatio 2.7687 |
| session | rust | 133.963 | 60 | 457.3 | 192 MB | stable 0, vocalTractLengthError 0.0226, pitchError 0.0742, cpuRatio 2.2327 |
| copy | js | 613.915 | 111.78 | 645.2 | crashed at 192 MB (JavaScript heap out of memory); rerun without the cap | f0RmseSemitones 6.0356, timingErrorMs 274.5, phonemeAgreement 0.4401, maxF0RmseSemitones 12.7403, maxTimingErrorMs 1098, cpuRatio 5.4922, recordings 24 |
| copy | rust | 596.763 | 111.78 | 913 | crashed at 192 MB (JavaScript heap out of memory); rerun without the cap | f0RmseSemitones 6.0356, timingErrorMs 274.5, phonemeAgreement 0.4401, maxF0RmseSemitones 12.7403, maxTimingErrorMs 1098, cpuRatio 5.3387, recordings 24 |
| modes | js | 20.027 | 109.405 | 431.6 | 192 MB | modeShare 0.9, rtf 0.1831, renderRtf 0.072, utterances 60 |
| modes | rust | 18.199 | 109.405 | 435.1 | 192 MB | modeShare 0.9, rtf 0.1663, renderRtf 0.0222, utterances 60 |
| app | js | — | 11.289 | — | none | textBack 0.6875, workerRtf 0.09, workerRtfMeasured 0.015, firstSound 0.217, firstChunk 0.217, coldFirstSound 0.873, startDelay 0.217, sampleRate 8000, chunks 89, heard The quick brown fox jump solar the lady dog. She says she sh… |
