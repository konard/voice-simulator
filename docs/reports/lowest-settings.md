# Lowest settings: 8 kHz and one core

Every row runs on 8000 Hz audio in its own Node process with
`UV_THREADPOOL_SIZE=1`, no workers and no GPU. Input recordings are
converted with `resample`. The Rust engine runs with one thread and no
SIMD. Limits come from `tests/heavy/lowest-thresholds.json` and only ever
become stricter.

- Measured: 2026-11-27T23:05:44.006Z
- Commit: `1ad1bca1e6289f1ff2d0e11047d4d1e7b926ac70`
- Command: `node scripts/run-heavy.mjs --suite lowest`
- CPU: AMD EPYC 7763 64-Core Processor
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
| synthesis | js-1 | real-time factor | 0.0394 | ≤ 0.25 | yes |
| synthesis | rust-1 | real-time factor | 0.0246 | ≤ 0.25 | yes |
| synthesis | memory | peak RSS (MB) | 396.3672 | ≤ 256 | no |
| recognition | quality | PER increase over 16 kHz | 0.0001 | ≤ 0.05 | yes |
| recognition | quality | WER increase over 16 kHz | -0.0017 | ≤ 0.08 | yes |
| recognition | js-1 | real-time factor | 0.4133 | ≤ 0.25 | no |
| recognition | rust-1 | real-time factor | 0.499 | ≤ 0.25 | no |
| recognition | memory | peak RSS (MB) | 427.8164 | ≤ 256 | no |
| streaming | quality | stream text differing from batch (WER) | 0.2429 | ≤ 0 | no |
| streaming | js-1 | first partial with words (s) | 1.316 | ≤ 1 | no |
| streaming | js-1 | CPU load | 0.8368 | ≤ 0.25 | no |
| streaming | rust-1 | first partial with words (s) | 1.1529 | ≤ 1 | no |
| streaming | rust-1 | CPU load | 0.7079 | ≤ 0.25 | no |
| streaming | memory | peak RSS (MB) | 346.8867 | ≤ 256 | no |
| voice-fit | quality | vocal tract length error | 0.0828 | ≤ 0.05 | no |
| voice-fit | quality | pitch error | 0.0537 | ≤ 0.03 | no |
| voice-fit | js-1 | CPU time / audio time | 3.2196 | ≤ 1 | no |
| voice-fit | rust-1 | CPU time / audio time | 2.3528 | ≤ 1 | no |
| voice-fit | memory | peak RSS (MB) | 284.7891 | ≤ 256 | no |
| session | quality | share of voices reaching stable | 0 | ≥ 1 | no |
| session | quality | vocal tract length error | 0.0226 | ≤ 0.05 | yes |
| session | quality | pitch error | 0.0097 | ≤ 0.03 | yes |
| session | js-1 | CPU time / audio time | 3.7535 | ≤ 0.5 | no |
| session | rust-1 | CPU time / audio time | 3.3779 | ≤ 0.5 | no |
| session | memory | peak RSS (MB) | 384.6328 | ≤ 256 | no |
| copy | quality | mean f0 RMSE (semitones) | 6.0086 | ≤ 1.5 | no |
| copy | quality | mean timing error (ms) | 271.4 | ≤ 30 | no |
| copy | quality | phonemes of the copy agreeing | 0.4716 | ≥ 0.9 | no |
| copy | js-1 | reported, no limit: CPU time / audio time 6.8901 | — | — | certified |
| copy | rust-1 | reported, no limit: CPU time / audio time 6.6734 | — | — | certified |
| copy | memory | peak RSS (MB) | 448.0938 | ≤ 256 | no |
| modes | quality | share of modes recognised | 0.9 | ≥ 0.8 | yes |
| modes | js-1 | real-time factor | 0.1618 | ≤ 0.25 | yes |
| modes | rust-1 | real-time factor | 0.1499 | ≤ 0.25 | yes |
| modes | memory | peak RSS (MB) | 325.1719 | ≤ 256 | no |
| app | quality | text recognised back | 0.6875 | ≥ 1 | no |
| app | js-1 | synthesis worker real-time factor | 0.192 | ≤ 1 | yes |
| app | js-1 | first sound (s) | 0.376 | ≤ 1 | yes |

## Runs

| Row | Engine | CPU (s) | Audio (s) | Peak RSS (MB) | Heap cap | Other measurements |
| --- | --- | ---: | ---: | ---: | --- | --- |
| synthesis | js | 15.415 | 391.707 | 396.3672 | 192 MB | wer 0.3537, wer16k 0.3624, werIncrease -0.0087, rtf 0.0394, recognitionRtf 0.2422, utterances 160 |
| synthesis | rust | 9.642 | 391.707 | 357.4219 | 192 MB | wer 0.3537, rtf 0.0246, recognitionRtf 0.231, utterances 160 |
| recognition | js | 442.928 | 1071.807 | 427.8164 | 192 MB | per 0.8665, wer 1.2967, per16k 0.8664, wer16k 1.2983, perIncrease 0.0001, werIncrease -0.0017, rtf 0.4133, utterances 127 |
| recognition | rust | 534.798 | 1071.807 | 380.3828 | 192 MB | per 0.8665, wer 1.2967, rtf 0.499, utterances 127 |
| streaming | js | 50.205 | 60 | 335.0234 | 192 MB | textMismatch 0.2429, firstPartial 1.316, load 0.8368, partials 247, streamText The quick brown fox jump sober the lady dog. She says she ce…, batchText The quick bill fox jump sober the lady dog. She says she sha… |
| streaming | rust | 42.473 | 60 | 346.8867 | 192 MB | textMismatch 0.2429, firstPartial 1.1529, load 0.7079, partials 247, streamText The quick brown fox jump sober the lady dog. She says she ce…, batchText The quick bill fox jump sober the lady dog. She says she sha… |
| voice-fit | js | 96.589 | 30 | 284.7891 | 192 MB | vocalTractLengthError 0.0828, pitchError 0.0537, cpuRatio 3.2196 |
| voice-fit | rust | 70.584 | 30 | 225.2305 | 192 MB | vocalTractLengthError 0.0828, pitchError 0.0537, cpuRatio 2.3528 |
| session | js | 225.213 | 60 | 377.5352 | 192 MB | stable 0, vocalTractLengthError 0.0226, pitchError 0.0097, cpuRatio 3.7535 |
| session | rust | 202.672 | 60 | 384.6328 | 192 MB | stable 0, vocalTractLengthError 0.0226, pitchError 0.0097, cpuRatio 3.3779 |
| copy | js | 770.171 | 111.78 | 440.4531 | 192 MB | f0RmseSemitones 6.0086, timingErrorMs 271.4, phonemeAgreement 0.4716, maxF0RmseSemitones 12.1282, maxTimingErrorMs 720, cpuRatio 6.8901, recordings 24 |
| copy | rust | 745.954 | 111.78 | 448.0938 | 192 MB | f0RmseSemitones 6.0086, timingErrorMs 271.4, phonemeAgreement 0.4716, maxF0RmseSemitones 12.1282, maxTimingErrorMs 720, cpuRatio 6.6734, recordings 24 |
| modes | js | 17.702 | 109.405 | 316.4063 | 192 MB | modeShare 0.9, rtf 0.1618, renderRtf 0.0374, utterances 60 |
| modes | rust | 16.405 | 109.405 | 325.1719 | 192 MB | modeShare 0.9, rtf 0.1499, renderRtf 0.0244, utterances 60 |
| app | js | — | 11.289 | — | none | textBack 0.6875, workerRtf 0.192, workerRtfMeasured 0.032, firstSound 0.376, firstChunk 0.376, coldFirstSound 1.313, startDelay 0.375, sampleRate 8000, chunks 89, heard The quick brown fox jump solar the lady dog. She says she sh… |
