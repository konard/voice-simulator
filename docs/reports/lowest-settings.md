# Lowest settings: 8 kHz and one core

Every row runs on 8000 Hz audio in its own Node process with
`UV_THREADPOOL_SIZE=1`, no workers and no GPU. Input recordings are
converted with `resample`. The Rust engine runs with one thread and no
SIMD. Limits come from `tests/heavy/lowest-thresholds.json` and only ever
become stricter.

- Measured: 2026-11-27T23:25:01.989Z
- Commit: `4aa227e6d9b5a5ee52bfe0865cf77a7bdaea77f9`
- Command: `node scripts/run-heavy.mjs --suite lowest`
- CPU: Intel(R) Xeon(R) 6975P-C
- Node: v24.22.3
- Pinning: pinned with `taskset -c 0`
- Heap cap: `--max-old-space-size=192`

| Row | quality | js-1 | rust-1 | memory |
| --- | --- | --- | --- | --- |
| synthesis | certified | certified | certified | [failed](https://github.com/konard/voice-simulator/issues/173) |
| recognition | certified | [failed](https://github.com/konard/voice-simulator/issues/174) | [failed](https://github.com/konard/voice-simulator/issues/174) | [failed](https://github.com/konard/voice-simulator/issues/173) |
| streaming | [failed](https://github.com/konard/voice-simulator/issues/175) | [failed](https://github.com/konard/voice-simulator/issues/175) | [failed](https://github.com/konard/voice-simulator/issues/175) | [failed](https://github.com/konard/voice-simulator/issues/173) |
| voice-fit | [failed](https://github.com/konard/voice-simulator/issues/176) | [failed](https://github.com/konard/voice-simulator/issues/176) | [failed](https://github.com/konard/voice-simulator/issues/176) | [failed](https://github.com/konard/voice-simulator/issues/173) |
| session | [failed](https://github.com/konard/voice-simulator/issues/177) | [failed](https://github.com/konard/voice-simulator/issues/177) | [failed](https://github.com/konard/voice-simulator/issues/177) | [failed](https://github.com/konard/voice-simulator/issues/173) |
| copy | [failed](https://github.com/konard/voice-simulator/issues/178) | certified | certified | [failed](https://github.com/konard/voice-simulator/issues/173) |
| modes | certified | certified | certified | [failed](https://github.com/konard/voice-simulator/issues/173) |
| app | [failed](https://github.com/konard/voice-simulator/issues/180) | certified | — | — |

## Values and limits

| Row | Column | Metric | Value | Limit | Pass |
| --- | --- | --- | ---: | ---: | --- |
| synthesis | quality | WER increase over 16 kHz | -0.0087 | ≤ 0.05 | yes |
| synthesis | js-1 | real-time factor | 0.0225 | ≤ 0.25 | yes |
| synthesis | rust-1 | real-time factor | 0.0164 | ≤ 0.25 | yes |
| synthesis | memory | peak RSS (MB) | 386.7734 | ≤ 256 | no |
| recognition | quality | PER increase over 16 kHz | 0.0001 | ≤ 0.05 | yes |
| recognition | quality | WER increase over 16 kHz | -0.0017 | ≤ 0.08 | yes |
| recognition | js-1 | real-time factor | 0.3797 | ≤ 0.25 | no |
| recognition | rust-1 | real-time factor | 0.3528 | ≤ 0.25 | no |
| recognition | memory | peak RSS (MB) | 423.1836 | ≤ 256 | no |
| streaming | quality | stream text differing from batch (WER) | 0.2429 | ≤ 0 | no |
| streaming | js-1 | first partial with words (s) | 1.07 | ≤ 1 | no |
| streaming | js-1 | CPU load | 0.6629 | ≤ 0.25 | no |
| streaming | rust-1 | first partial with words (s) | 0.9482 | ≤ 1 | yes |
| streaming | rust-1 | CPU load | 0.5197 | ≤ 0.25 | no |
| streaming | memory | peak RSS (MB) | 347.5859 | ≤ 256 | no |
| voice-fit | quality | vocal tract length error | 0.0828 | ≤ 0.05 | no |
| voice-fit | quality | pitch error | 0.0537 | ≤ 0.03 | no |
| voice-fit | js-1 | CPU time / audio time | 1.9979 | ≤ 1 | no |
| voice-fit | rust-1 | CPU time / audio time | 1.5781 | ≤ 1 | no |
| voice-fit | memory | peak RSS (MB) | 285.3477 | ≤ 256 | no |
| session | quality | share of voices reaching stable | 0 | ≥ 1 | no |
| session | quality | vocal tract length error | 0.0226 | ≤ 0.05 | yes |
| session | quality | pitch error | 0.0097 | ≤ 0.03 | yes |
| session | js-1 | CPU time / audio time | 2.1144 | ≤ 0.5 | no |
| session | rust-1 | CPU time / audio time | 1.8248 | ≤ 0.5 | no |
| session | memory | peak RSS (MB) | 375.8203 | ≤ 256 | no |
| copy | quality | mean f0 RMSE (semitones) | 6.0086 | ≤ 1.5 | no |
| copy | quality | mean timing error (ms) | 271.4 | ≤ 30 | no |
| copy | quality | phonemes of the copy agreeing | 0.4716 | ≥ 0.9 | no |
| copy | js-1 | reported, no limit: CPU time / audio time 3.4809 | — | — | certified |
| copy | rust-1 | reported, no limit: CPU time / audio time 4.8263 | — | — | certified |
| copy | memory | peak RSS (MB) | 452.0313 | ≤ 256 | no |
| modes | quality | share of modes recognised | 0.9 | ≥ 0.8 | yes |
| modes | js-1 | real-time factor | 0.1264 | ≤ 0.25 | yes |
| modes | rust-1 | real-time factor | 0.117 | ≤ 0.25 | yes |
| modes | memory | peak RSS (MB) | 328.875 | ≤ 256 | no |
| app | quality | text recognised back | 0.6875 | ≥ 1 | no |
| app | js-1 | synthesis worker real-time factor | 0.0955 | ≤ 1 | yes |
| app | js-1 | first sound (s) | 0.218 | ≤ 1 | yes |

## Runs

| Row | Engine | CPU (s) | Audio (s) | Peak RSS (MB) | Heap cap | Other measurements |
| --- | --- | ---: | ---: | ---: | --- | --- |
| synthesis | js | 8.829 | 391.707 | 386.7734 | 192 MB | wer 0.3537, wer16k 0.3624, werIncrease -0.0087, rtf 0.0225, recognitionRtf 0.1906, utterances 160 |
| synthesis | rust | 6.429 | 391.707 | 355.0859 | 192 MB | wer 0.3537, rtf 0.0164, recognitionRtf 0.184, utterances 160 |
| recognition | js | 407.005 | 1071.807 | 423.1836 | 192 MB | per 0.8665, wer 1.2967, per16k 0.8664, wer16k 1.2983, perIncrease 0.0001, werIncrease -0.0017, rtf 0.3797, utterances 127 |
| recognition | rust | 378.084 | 1071.807 | 383.5508 | 192 MB | per 0.8665, wer 1.2967, rtf 0.3528, utterances 127 |
| streaming | js | 39.773 | 60 | 321.5664 | 192 MB | textMismatch 0.2429, firstPartial 1.07, load 0.6629, partials 247, streamText The quick brown fox jump sober the lady dog. She says she ce…, batchText The quick bill fox jump sober the lady dog. She says she sha… |
| streaming | rust | 31.18 | 60 | 347.5859 | 192 MB | textMismatch 0.2429, firstPartial 0.9482, load 0.5197, partials 247, streamText The quick brown fox jump sober the lady dog. She says she ce…, batchText The quick bill fox jump sober the lady dog. She says she sha… |
| voice-fit | js | 59.936 | 30 | 285.3477 | 192 MB | vocalTractLengthError 0.0828, pitchError 0.0537, cpuRatio 1.9979 |
| voice-fit | rust | 47.342 | 30 | 224.6797 | 192 MB | vocalTractLengthError 0.0828, pitchError 0.0537, cpuRatio 1.5781 |
| session | js | 126.867 | 60 | 349.9727 | 192 MB | stable 0, vocalTractLengthError 0.0226, pitchError 0.0097, cpuRatio 2.1144 |
| session | rust | 109.485 | 60 | 375.8203 | 192 MB | stable 0, vocalTractLengthError 0.0226, pitchError 0.0097, cpuRatio 1.8248 |
| copy | js | 389.095 | 111.78 | 433.5742 | 192 MB | f0RmseSemitones 6.0086, timingErrorMs 271.4, phonemeAgreement 0.4716, maxF0RmseSemitones 12.1282, maxTimingErrorMs 720, cpuRatio 3.4809, recordings 24 |
| copy | rust | 539.48 | 111.78 | 452.0313 | 192 MB | f0RmseSemitones 6.0086, timingErrorMs 271.4, phonemeAgreement 0.4716, maxF0RmseSemitones 12.1282, maxTimingErrorMs 720, cpuRatio 4.8263, recordings 24 |
| modes | js | 13.832 | 109.405 | 323.5352 | 192 MB | modeShare 0.9, rtf 0.1264, renderRtf 0.0208, utterances 60 |
| modes | rust | 12.803 | 109.405 | 328.875 | 192 MB | modeShare 0.9, rtf 0.117, renderRtf 0.0162, utterances 60 |
| app | js | — | 11.289 | — | none | textBack 0.6875, workerRtf 0.0955, workerRtfMeasured 0.0159, firstSound 0.218, firstChunk 0.218, coldFirstSound 0.84, startDelay 0.217, sampleRate 8000, chunks 89, heard The quick brown fox jump solar the lady dog. She says she sh… |
