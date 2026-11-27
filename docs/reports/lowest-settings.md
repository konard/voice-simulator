# Lowest settings: 8 kHz and one core

Every row runs on 8000 Hz audio in its own Node process with
`UV_THREADPOOL_SIZE=1`, no workers and no GPU. Input recordings are
converted with `resample`. The Rust engine runs with one thread and no
SIMD. Limits come from `tests/heavy/lowest-thresholds.json` and only ever
become stricter.

- Measured: 2026-11-27T23:43:11.294Z
- Commit: `6364e63eb0912248b4f4960911d823db0a0a7222`
- Command: `node scripts/run-heavy.mjs --suite lowest`
- CPU: AMD EPYC 9V45 96-Core Processor
- Node: v24.22.3
- Pinning: pinned with `taskset -c 0`
- Heap cap: `--max-old-space-size=192`

| Row | quality | js-1 | rust-1 | memory |
| --- | --- | --- | --- | --- |
| synthesis | certified | certified | certified | [failed](https://github.com/konard/voice-simulator/issues/173) |
| recognition | certified | [failed](https://github.com/konard/voice-simulator/issues/174) | [failed](https://github.com/konard/voice-simulator/issues/174) | [failed](https://github.com/konard/voice-simulator/issues/173) |
| streaming | [failed](https://github.com/konard/voice-simulator/issues/175) | [failed](https://github.com/konard/voice-simulator/issues/175) | [failed](https://github.com/konard/voice-simulator/issues/175) | [failed](https://github.com/konard/voice-simulator/issues/173) |
| voice-fit | [failed](https://github.com/konard/voice-simulator/issues/176) | [failed](https://github.com/konard/voice-simulator/issues/176) | certified | certified |
| session | [failed](https://github.com/konard/voice-simulator/issues/177) | [failed](https://github.com/konard/voice-simulator/issues/177) | [failed](https://github.com/konard/voice-simulator/issues/177) | [failed](https://github.com/konard/voice-simulator/issues/173) |
| copy | [failed](https://github.com/konard/voice-simulator/issues/178) | certified | certified | [failed](https://github.com/konard/voice-simulator/issues/173) |
| modes | certified | certified | certified | [failed](https://github.com/konard/voice-simulator/issues/173) |
| app | [failed](https://github.com/konard/voice-simulator/issues/180) | certified | — | — |

## Values and limits

| Row | Column | Metric | Value | Limit | Pass |
| --- | --- | --- | ---: | ---: | --- |
| synthesis | quality | WER increase over 16 kHz | -0.0087 | ≤ 0.05 | yes |
| synthesis | js-1 | real-time factor | 0.0189 | ≤ 0.25 | yes |
| synthesis | rust-1 | real-time factor | 0.0137 | ≤ 0.25 | yes |
| synthesis | memory | peak RSS (MB) | 388.8594 | ≤ 256 | no |
| recognition | quality | PER increase over 16 kHz | 0.0001 | ≤ 0.05 | yes |
| recognition | quality | WER increase over 16 kHz | -0.0017 | ≤ 0.08 | yes |
| recognition | js-1 | real-time factor | 0.2523 | ≤ 0.25 | no |
| recognition | rust-1 | real-time factor | 0.3236 | ≤ 0.25 | no |
| recognition | memory | peak RSS (MB) | 428.582 | ≤ 256 | no |
| streaming | quality | stream text differing from batch (WER) | 0.2429 | ≤ 0 | no |
| streaming | js-1 | first partial with words (s) | 1.0296 | ≤ 1 | no |
| streaming | js-1 | CPU load | 0.5246 | ≤ 0.25 | no |
| streaming | rust-1 | first partial with words (s) | 0.9298 | ≤ 1 | yes |
| streaming | rust-1 | CPU load | 0.3989 | ≤ 0.25 | no |
| streaming | memory | peak RSS (MB) | 339.4883 | ≤ 256 | no |
| voice-fit | quality | vocal tract length error | 0.0828 | ≤ 0.05 | no |
| voice-fit | quality | pitch error | 0.0537 | ≤ 0.03 | no |
| voice-fit | js-1 | CPU time / audio time | 1.157 | ≤ 1 | no |
| voice-fit | rust-1 | CPU time / audio time | 0.9513 | ≤ 1 | yes |
| voice-fit | memory | peak RSS (MB) | 224.0234 | ≤ 256 | yes |
| session | quality | share of voices reaching stable | 0 | ≥ 1 | no |
| session | quality | vocal tract length error | 0.0226 | ≤ 0.05 | yes |
| session | quality | pitch error | 0.0097 | ≤ 0.03 | yes |
| session | js-1 | CPU time / audio time | 1.4538 | ≤ 0.5 | no |
| session | rust-1 | CPU time / audio time | 1.3088 | ≤ 0.5 | no |
| session | memory | peak RSS (MB) | 345.9688 | ≤ 256 | no |
| copy | quality | mean f0 RMSE (semitones) | 6.0086 | ≤ 1.5 | no |
| copy | quality | mean timing error (ms) | 271.4 | ≤ 30 | no |
| copy | quality | phonemes of the copy agreeing | 0.4716 | ≥ 0.9 | no |
| copy | js-1 | reported, no limit: CPU time / audio time 3.7029 | — | — | certified |
| copy | rust-1 | reported, no limit: CPU time / audio time 3.6126 | — | — | certified |
| copy | memory | peak RSS (MB) | 447.5273 | ≤ 256 | no |
| modes | quality | share of modes recognised | 0.9 | ≥ 0.8 | yes |
| modes | js-1 | real-time factor | 0.0883 | ≤ 0.25 | yes |
| modes | rust-1 | real-time factor | 0.0825 | ≤ 0.25 | yes |
| modes | memory | peak RSS (MB) | 331.6211 | ≤ 256 | no |
| app | quality | text recognised back | 0.6875 | ≥ 1 | no |
| app | js-1 | synthesis worker real-time factor | 0.0684 | ≤ 1 | yes |
| app | js-1 | first sound (s) | 0.153 | ≤ 1 | yes |

## Runs

| Row | Engine | CPU (s) | Audio (s) | Peak RSS (MB) | Heap cap | Other measurements |
| --- | --- | ---: | ---: | ---: | --- | --- |
| synthesis | js | 7.411 | 391.707 | 388.8594 | 192 MB | wer 0.3537, wer16k 0.3624, werIncrease -0.0087, rtf 0.0189, recognitionRtf 0.1421, utterances 160 |
| synthesis | rust | 5.365 | 391.707 | 357.3008 | 192 MB | wer 0.3537, rtf 0.0137, recognitionRtf 0.1367, utterances 160 |
| recognition | js | 270.412 | 1071.807 | 428.582 | 192 MB | per 0.8665, wer 1.2967, per16k 0.8664, wer16k 1.2983, perIncrease 0.0001, werIncrease -0.0017, rtf 0.2523, utterances 127 |
| recognition | rust | 346.803 | 1071.807 | 377.6211 | 192 MB | per 0.8665, wer 1.2967, rtf 0.3236, utterances 127 |
| streaming | js | 31.474 | 60 | 328.3906 | 192 MB | textMismatch 0.2429, firstPartial 1.0296, load 0.5246, partials 247, streamText The quick brown fox jump sober the lady dog. She says she ce…, batchText The quick bill fox jump sober the lady dog. She says she sha… |
| streaming | rust | 23.935 | 60 | 339.4883 | 192 MB | textMismatch 0.2429, firstPartial 0.9298, load 0.3989, partials 247, streamText The quick brown fox jump sober the lady dog. She says she ce…, batchText The quick bill fox jump sober the lady dog. She says she sha… |
| voice-fit | js | 34.71 | 30 | 222.4805 | 192 MB | vocalTractLengthError 0.0828, pitchError 0.0537, cpuRatio 1.157 |
| voice-fit | rust | 28.539 | 30 | 224.0234 | 192 MB | vocalTractLengthError 0.0828, pitchError 0.0537, cpuRatio 0.9513 |
| session | js | 87.231 | 60 | 345.9688 | 192 MB | stable 0, vocalTractLengthError 0.0226, pitchError 0.0097, cpuRatio 1.4538 |
| session | rust | 78.525 | 60 | 345.8008 | 192 MB | stable 0, vocalTractLengthError 0.0226, pitchError 0.0097, cpuRatio 1.3088 |
| copy | js | 413.905 | 111.78 | 447.5273 | 192 MB | f0RmseSemitones 6.0086, timingErrorMs 271.4, phonemeAgreement 0.4716, maxF0RmseSemitones 12.1282, maxTimingErrorMs 720, cpuRatio 3.7029, recordings 24 |
| copy | rust | 403.811 | 111.78 | 439.4766 | 192 MB | f0RmseSemitones 6.0086, timingErrorMs 271.4, phonemeAgreement 0.4716, maxF0RmseSemitones 12.1282, maxTimingErrorMs 720, cpuRatio 3.6126, recordings 24 |
| modes | js | 9.657 | 109.405 | 320.6445 | 192 MB | modeShare 0.9, rtf 0.0883, renderRtf 0.0169, utterances 60 |
| modes | rust | 9.029 | 109.405 | 331.6211 | 192 MB | modeShare 0.9, rtf 0.0825, renderRtf 0.013, utterances 60 |
| app | js | — | 11.289 | — | none | textBack 0.6875, workerRtf 0.0684, workerRtfMeasured 0.0114, firstSound 0.153, firstChunk 0.153, coldFirstSound 0.676, startDelay 0.151, sampleRate 8000, chunks 89, heard The quick brown fox jump solar the lady dog. She says she sh… |
