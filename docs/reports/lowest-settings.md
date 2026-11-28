# Lowest settings: 8 kHz and one core

Every row runs on 8000 Hz audio in its own Node process with
`UV_THREADPOOL_SIZE=1`, no workers and no GPU. Input recordings are
converted with `resample`. The Rust engine runs with one thread and no
SIMD. Limits come from `tests/heavy/lowest-thresholds.json` and only ever
become stricter.

- Measured: 2026-11-28T02:00:03.167Z
- Commit: `bb98a84faeaca4f11c5fa6c7355db7d5d0512cea`
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
| session | certified | certified | certified | [failed](https://github.com/konard/voice-simulator/issues/173) |
| copy | [failed](https://github.com/konard/voice-simulator/issues/178) | certified | certified | [failed](https://github.com/konard/voice-simulator/issues/173) |
| modes | certified | certified | certified | [failed](https://github.com/konard/voice-simulator/issues/173) |
| app | [failed](https://github.com/konard/voice-simulator/issues/180) | certified | — | — |

## Values and limits

| Row | Column | Metric | Value | Limit | Pass |
| --- | --- | --- | ---: | ---: | --- |
| synthesis | quality | WER increase over 16 kHz | 0.0033 | ≤ 0.05 | yes |
| synthesis | js-1 | real-time factor | 0.187 | ≤ 0.25 | yes |
| synthesis | rust-1 | real-time factor | 0.0514 | ≤ 0.25 | yes |
| synthesis | memory | peak RSS (MB) | 443.2 | ≤ 256 | no |
| recognition | quality | PER increase over 16 kHz | 0.0112 | ≤ 0.05 | yes |
| recognition | quality | WER increase over 16 kHz | -0.082 | ≤ 0.08 | yes |
| recognition | js-1 | real-time factor | 0.1764 | ≤ 0.25 | yes |
| recognition | rust-1 | real-time factor | 0.1709 | ≤ 0.25 | yes |
| recognition | memory | peak RSS (MB) | 525.3 | ≤ 256 | no |
| streaming | quality | stream text differing from batch (WER) | 0.4357 | ≤ 0 | no |
| streaming | js-1 | first partial with words (s) | 1.2955 | ≤ 1 | no |
| streaming | js-1 | CPU load | 0.8808 | ≤ 0.25 | no |
| streaming | rust-1 | first partial with words (s) | 0.9473 | ≤ 1 | yes |
| streaming | rust-1 | CPU load | 0.7149 | ≤ 0.25 | no |
| streaming | memory | peak RSS (MB) | 418.1 | ≤ 256 | no |
| voice-fit | quality | vocal tract length error | 0.0275 | ≤ 0.05 | yes |
| voice-fit | quality | pitch error | 0.0214 | ≤ 0.03 | yes |
| voice-fit | js-1 | CPU time / audio time | 0.2628 | ≤ 1 | yes |
| voice-fit | rust-1 | CPU time / audio time | 0.2671 | ≤ 1 | yes |
| voice-fit | memory | peak RSS (MB) | 312.8 | ≤ 256 | no |
| session | quality | share of voices reaching stable | 1 | ≥ 1 | yes |
| session | quality | vocal tract length error | 0.0197 | ≤ 0.05 | yes |
| session | quality | pitch error | 0.0117 | ≤ 0.03 | yes |
| session | js-1 | CPU time / audio time | 0.1287 | ≤ 0.5 | yes |
| session | rust-1 | CPU time / audio time | 0.1212 | ≤ 0.5 | yes |
| session | memory | peak RSS (MB) | 319.3 | ≤ 256 | no |
| copy | quality | mean f0 RMSE (semitones) | 6.0356 | ≤ 1.5 | no |
| copy | quality | mean timing error (ms) | 274.5 | ≤ 30 | no |
| copy | quality | phonemes of the copy agreeing | 0.4401 | ≥ 0.9 | no |
| copy | js-1 | reported, no limit: CPU time / audio time 5.4791 | — | — | certified |
| copy | rust-1 | reported, no limit: CPU time / audio time 5.1965 | — | — | certified |
| copy | memory | peak RSS (MB) | 912.8 | ≤ 256 | no |
| modes | quality | share of modes recognised | 0.9 | ≥ 0.8 | yes |
| modes | js-1 | real-time factor | 0.1816 | ≤ 0.25 | yes |
| modes | rust-1 | real-time factor | 0.1592 | ≤ 0.25 | yes |
| modes | memory | peak RSS (MB) | 421.8 | ≤ 256 | no |
| app | quality | text recognised back | 0.6875 | ≥ 1 | no |
| app | js-1 | synthesis worker real-time factor | 0.0956 | ≤ 1 | yes |
| app | js-1 | first sound (s) | 0.235 | ≤ 1 | yes |

## Runs

| Row | Engine | CPU (s) | Audio (s) | Peak RSS (MB) | Heap cap | Other measurements |
| --- | --- | ---: | ---: | ---: | --- | --- |
| synthesis | js | 73.24 | 391.707 | 421.6 | 192 MB | wer 0.3657, wer16k 0.3624, werIncrease 0.0033, rtf 0.187, recognitionRtf 0.3839, utterances 160 |
| synthesis | rust | 20.138 | 391.707 | 443.2 | 192 MB | wer 0.3657, rtf 0.0514, recognitionRtf 0.3009, utterances 160 |
| recognition | js | 189.031 | 1071.807 | 520.6 | 192 MB | per 0.8777, wer 1.2163, per16k 0.8664, wer16k 1.2983, perIncrease 0.0112, werIncrease -0.082, rtf 0.1764, utterances 127 |
| recognition | rust | 183.21 | 1071.807 | 525.3 | 192 MB | per 0.8777, wer 1.2163, rtf 0.1709, utterances 127 |
| streaming | js | 52.848 | 60 | 418.1 | 192 MB | textMismatch 0.4357, firstPartial 1.2955, load 0.8808, partials 247, streamText The quick brown fox jump sober the lady dog. She says she ce…, batchText The quick breach arcs jump sober the lady dog. She says she …, batchLastWord 59.9875 |
| streaming | rust | 42.892 | 60 | 412.4 | 192 MB | textMismatch 0.4357, firstPartial 0.9473, load 0.7149, partials 247, streamText The quick brown fox jump sober the lady dog. She says she ce…, batchText The quick breach arcs jump sober the lady dog. She says she …, batchLastWord 59.9875 |
| voice-fit | js | 7.885 | 30 | 295.1 | 192 MB | vocalTractLengthError 0.0275, pitchError 0.0214, cpuRatio 0.2628 |
| voice-fit | rust | 8.014 | 30 | 312.8 | 192 MB | vocalTractLengthError 0.0275, pitchError 0.0214, cpuRatio 0.2671 |
| session | js | 7.724 | 60 | 310.9 | 192 MB | stable 1, vocalTractLengthError 0.0197, pitchError 0.0117, cpuRatio 0.1287 |
| session | rust | 7.269 | 60 | 319.3 | 192 MB | stable 1, vocalTractLengthError 0.0197, pitchError 0.0117, cpuRatio 0.1212 |
| copy | js | 612.458 | 111.78 | 737.6 | crashed at 192 MB (JavaScript heap out of memory); rerun without the cap | f0RmseSemitones 6.0356, timingErrorMs 274.5, phonemeAgreement 0.4401, maxF0RmseSemitones 12.7403, maxTimingErrorMs 1098, cpuRatio 5.4791, recordings 24 |
| copy | rust | 580.861 | 111.78 | 912.8 | crashed at 192 MB (JavaScript heap out of memory); rerun without the cap | f0RmseSemitones 6.0356, timingErrorMs 274.5, phonemeAgreement 0.4401, maxF0RmseSemitones 12.7403, maxTimingErrorMs 1098, cpuRatio 5.1965, recordings 24 |
| modes | js | 19.872 | 109.405 | 420 | 192 MB | modeShare 0.9, rtf 0.1816, renderRtf 0.0747, utterances 60 |
| modes | rust | 17.421 | 109.405 | 421.8 | 192 MB | modeShare 0.9, rtf 0.1592, renderRtf 0.0321, utterances 60 |
| app | js | — | 11.289 | — | none | textBack 0.6875, workerRtf 0.0956, workerRtfMeasured 0.0159, firstSound 0.235, firstChunk 0.235, coldFirstSound 0.863, startDelay 0.235, sampleRate 8000, chunks 89, heard The quick brown fox jump solar the lady dog. She says she sh… |
