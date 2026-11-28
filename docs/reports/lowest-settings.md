# Lowest settings: 8 kHz and one core

Every row runs on 8000 Hz audio in its own Node process with
`UV_THREADPOOL_SIZE=1`, no workers and no GPU. Input recordings are
converted with `resample`. The Rust engine runs with one thread and no
SIMD. Limits come from `tests/heavy/lowest-thresholds.json` and only ever
become stricter.

- Measured: 2026-11-26T01:22:10.504Z
- Commit: `56797cd5577e0dfffbdd1e5b4804c8752278950e`
- Command: `node scripts/run-heavy.mjs --suite lowest`
- CPU: AMD EPYC 7763 64-Core Processor
- Node: v24.22.3
- Pinning: pinned with `taskset -c 0`
- Heap cap: `--max-old-space-size=192`

| Row | quality | js-1 | rust-1 | memory |
| --- | --- | --- | --- | --- |
| synthesis | certified | certified | certified | [failed](https://github.com/konard/voice-simulator/issues/173) |
| recognition | certified | [failed](https://github.com/konard/voice-simulator/issues/174) | [failed](https://github.com/konard/voice-simulator/issues/174) | [failed](https://github.com/konard/voice-simulator/issues/173) |
| streaming | certified | certified | certified | [failed](https://github.com/konard/voice-simulator/issues/173) |
| voice-fit | certified | certified | certified | [failed](https://github.com/konard/voice-simulator/issues/173) |
| session | certified | certified | certified | [failed](https://github.com/konard/voice-simulator/issues/173) |
| copy | [failed](https://github.com/konard/voice-simulator/issues/178) | certified | certified | [failed](https://github.com/konard/voice-simulator/issues/173) |
| modes | certified | [failed](https://github.com/konard/voice-simulator/issues/179) | certified | [failed](https://github.com/konard/voice-simulator/issues/173) |
| app | [failed](https://github.com/konard/voice-simulator/issues/180) | certified | — | — |

## Values and limits

| Row | Column | Metric | Value | Limit | Pass |
| --- | --- | --- | ---: | ---: | --- |
| synthesis | quality | WER increase over 16 kHz | -0.0076 | ≤ 0.05 | yes |
| synthesis | js-1 | real-time factor | 0.0439 | ≤ 0.25 | yes |
| synthesis | rust-1 | real-time factor | 0.0267 | ≤ 0.25 | yes |
| synthesis | memory | peak RSS (MB) | 813.4 | ≤ 256 | no |
| recognition | quality | PER increase over 16 kHz | 0.0005 | ≤ 0.05 | yes |
| recognition | quality | WER increase over 16 kHz | -0.0004 | ≤ 0.08 | yes |
| recognition | js-1 | real-time factor | 1.4237 | ≤ 0.25 | no |
| recognition | rust-1 | real-time factor | 1.5811 | ≤ 0.25 | no |
| recognition | memory | peak RSS (MB) | 1346.3 | ≤ 256 | no |
| streaming | quality | stream text differing from batch (WER) | 0 | ≤ 0 | yes |
| streaming | js-1 | first partial with words (s) | 0.2751 | ≤ 1 | yes |
| streaming | js-1 | CPU load | 0.1001 | ≤ 0.25 | yes |
| streaming | rust-1 | first partial with words (s) | 0.2739 | ≤ 1 | yes |
| streaming | rust-1 | CPU load | 0.0961 | ≤ 0.25 | yes |
| streaming | memory | peak RSS (MB) | 330.8 | ≤ 256 | no |
| voice-fit | quality | vocal tract length error | 0.0275 | ≤ 0.05 | yes |
| voice-fit | quality | pitch error | 0.0214 | ≤ 0.03 | yes |
| voice-fit | js-1 | CPU time / audio time | 0.5464 | ≤ 1 | yes |
| voice-fit | rust-1 | CPU time / audio time | 0.5258 | ≤ 1 | yes |
| voice-fit | memory | peak RSS (MB) | 327.6 | ≤ 256 | no |
| session | quality | share of voices reaching stable | 1 | ≥ 1 | yes |
| session | quality | vocal tract length error | 0.0197 | ≤ 0.05 | yes |
| session | quality | pitch error | 0.0117 | ≤ 0.03 | yes |
| session | js-1 | CPU time / audio time | 0.1596 | ≤ 0.5 | yes |
| session | rust-1 | CPU time / audio time | 0.1624 | ≤ 0.5 | yes |
| session | memory | peak RSS (MB) | 357.3 | ≤ 256 | no |
| copy | quality | mean f0 RMSE (semitones) | 6.0239 | ≤ 1.5 | no |
| copy | quality | mean timing error (ms) | 229.4 | ≤ 30 | no |
| copy | quality | phonemes of the copy agreeing | 0.4615 | ≥ 0.9 | no |
| copy | js-1 | reported, no limit: CPU time / audio time 16.1803 | — | — | certified |
| copy | rust-1 | reported, no limit: CPU time / audio time 15.7606 | — | — | certified |
| copy | memory | peak RSS (MB) | 1184.1 | ≤ 256 | no |
| modes | quality | share of modes recognised | 0.8833 | ≥ 0.8 | yes |
| modes | js-1 | real-time factor | 0.2598 | ≤ 0.25 | no |
| modes | rust-1 | real-time factor | 0.2268 | ≤ 0.25 | yes |
| modes | memory | peak RSS (MB) | 725.8 | ≤ 256 | no |
| app | quality | text recognised back | 0.7188 | ≥ 1 | no |
| app | js-1 | synthesis worker real-time factor | 0.235 | ≤ 1 | yes |
| app | js-1 | first sound (s) | 0.314 | ≤ 1 | yes |

## Runs

| Row | Engine | CPU (s) | Audio (s) | Peak RSS (MB) | Heap cap | Other measurements |
| --- | --- | ---: | ---: | ---: | --- | --- |
| synthesis | js | 17.193 | 391.707 | 813.4 | crashed at 192 MB (JavaScript heap out of memory); rerun without the cap | wer 0.3537, wer16k 0.3614, werIncrease -0.0076, rtf 0.0439, recognitionRtf 0.6327, utterances 160 |
| synthesis | rust | 10.456 | 391.707 | 795.5 | crashed at 192 MB (JavaScript heap out of memory); rerun without the cap | wer 0.3537, rtf 0.0267, recognitionRtf 0.6398, utterances 160 |
| recognition | js | 1525.964 | 1071.807 | 1346.3 | crashed at 192 MB (JavaScript heap out of memory); rerun without the cap | per 0.8674, wer 1.2979, per16k 0.8669, wer16k 1.2983, perIncrease 0.0005, werIncrease -0.0004, rtf 1.4237, utterances 127 |
| recognition | rust | 1694.653 | 1071.807 | 1122.7 | crashed at 192 MB (JavaScript heap out of memory); rerun without the cap | per 0.8674, wer 1.2979, rtf 1.5811, utterances 127 |
| streaming | js | 6.006 | 60 | 326.1 | 192 MB | textMismatch 0, firstPartial 0.2751, load 0.1001, partials 240, streamText The quick brown fox jump sober the lady dog. She says she ce…, batchText The quick brown fox jump sober the lady dog. She says she ce… |
| streaming | rust | 5.763 | 60 | 330.8 | 192 MB | textMismatch 0, firstPartial 0.2739, load 0.0961, partials 240, streamText The quick brown fox jump sober the lady dog. She says she ce…, batchText The quick brown fox jump sober the lady dog. She says she ce… |
| voice-fit | js | 16.393 | 30 | 326.4 | 192 MB | vocalTractLengthError 0.0275, pitchError 0.0214, cpuRatio 0.5464 |
| voice-fit | rust | 15.775 | 30 | 327.6 | 192 MB | vocalTractLengthError 0.0275, pitchError 0.0214, cpuRatio 0.5258 |
| session | js | 9.577 | 60 | 330.9 | 192 MB | stable 1, vocalTractLengthError 0.0197, pitchError 0.0117, cpuRatio 0.1596 |
| session | rust | 9.746 | 60 | 357.3 | 192 MB | stable 1, vocalTractLengthError 0.0197, pitchError 0.0117, cpuRatio 0.1624 |
| copy | js | 1808.629 | 111.78 | 1184.1 | crashed at 192 MB (JavaScript heap out of memory); rerun without the cap | f0RmseSemitones 6.0239, timingErrorMs 229.4, phonemeAgreement 0.4615, maxF0RmseSemitones 13.5423, maxTimingErrorMs 891.8, cpuRatio 16.1803, recordings 24 |
| copy | rust | 1761.718 | 111.78 | 1165.1 | crashed at 192 MB (JavaScript heap out of memory); rerun without the cap | f0RmseSemitones 6.0239, timingErrorMs 229.4, phonemeAgreement 0.4615, maxF0RmseSemitones 13.5423, maxTimingErrorMs 891.8, cpuRatio 15.7606, recordings 24 |
| modes | js | 28.419 | 109.405 | 673.2 | crashed at 192 MB (JavaScript heap out of memory); rerun without the cap | modeShare 0.8833, rtf 0.2598, renderRtf 0.0384, utterances 60 |
| modes | rust | 24.812 | 109.405 | 725.8 | crashed at 192 MB (JavaScript heap out of memory); rerun without the cap | modeShare 0.8833, rtf 0.2268, renderRtf 0.0254, utterances 60 |
| app | js | — | 11.289 | — | none | textBack 0.7188, workerRtf 0.235, workerRtfMeasured 0.0392, firstSound 0.314, firstChunk 0.314, coldFirstSound 1.45, startDelay 0.314, sampleRate 8000, chunks 89, heard The quick brown fox jump solar the lady dog. She says she sh… |

## Targeted reruns

- **voice-fit** at commit `cb6806f621082cd5cc9336f3a41b078728c416e4` on AMD EPYC Processor (with IBPB), Node v24.22.3, measured 2026-11-28T00:13:10.556Z.
  Pinned with `taskset -c 0`. Command `node --test --test-name-pattern 'voice-fit with' tests/heavy/lowest-settings.test.js`.
- **session** at commit `336df9f4069def2bfdf385859008df98c2138bf0` on AMD EPYC 9V74 80-Core Processor, Node v24.22.3, measured 2026-11-28T01:13:16.430Z.
  Pinned with `taskset -c 0`. Command `LOWEST_ROW=session node --test tests/heavy/lowest-settings.test.js`.
- **streaming** at commit `ec44eefef653c0ebeaa56fbd421b5f545a82017f` on Intel(R) Xeon(R) 6975P-C, Node v24.22.3, measured 2026-11-28T01:46:10.008Z.
  Pinned with `taskset -c 0`. Command `LOWEST_ROW=streaming node --test tests/heavy/lowest-settings.test.js`.
