# Lowest settings: 8 kHz and one core

Every row runs on 8000 Hz audio in its own Node process with
`UV_THREADPOOL_SIZE=1`, no workers and no GPU. Input recordings are
converted with `resample`. The Rust engine runs with one thread and no
SIMD. Limits come from `tests/heavy/lowest-thresholds.json` and only ever
become stricter.

- Measured: 2026-11-28T03:28:33.110Z
- Commit: `42b7f28b1bffb542238b42d1982047b2436f1f3c`
- Command: `node scripts/run-heavy.mjs --suite lowest`
- CPU: AMD EPYC 9V45 96-Core Processor
- Node: v24.22.3
- Pinning: pinned with `taskset -c 0`
- Heap cap: `--max-old-space-size=192`

| Row | quality | js-1 | rust-1 | memory |
| --- | --- | --- | --- | --- |
| synthesis | certified | certified | certified | [failed](https://github.com/konard/voice-simulator/issues/173) |
| recognition | certified | certified | [failed](https://github.com/konard/voice-simulator/issues/174) | [failed](https://github.com/konard/voice-simulator/issues/173) |
| streaming | certified | certified | certified | certified |
| voice-fit | certified | certified | certified | certified |
| session | certified | certified | certified | certified |
| copy | [failed](https://github.com/konard/voice-simulator/issues/178) | certified | certified | [failed](https://github.com/konard/voice-simulator/issues/173) |
| modes | certified | certified | certified | certified |
| app | [failed](https://github.com/konard/voice-simulator/issues/180) | certified | — | — |

## Values and limits

| Row | Column | Metric | Value | Limit | Pass |
| --- | --- | --- | ---: | ---: | --- |
| synthesis | quality | WER increase over 16 kHz | -0.0087 | ≤ 0.05 | yes |
| synthesis | js-1 | real-time factor | 0.0202 | ≤ 0.25 | yes |
| synthesis | rust-1 | real-time factor | 0.0152 | ≤ 0.25 | yes |
| synthesis | memory | peak RSS (MB) | 374.3828 | ≤ 256 | no |
| recognition | quality | PER increase over 16 kHz | 0.0001 | ≤ 0.05 | yes |
| recognition | quality | WER increase over 16 kHz | -0.0017 | ≤ 0.08 | yes |
| recognition | js-1 | real-time factor | 0.2355 | ≤ 0.25 | yes |
| recognition | rust-1 | real-time factor | 0.2945 | ≤ 0.25 | no |
| recognition | memory | peak RSS (MB) | 393.3125 | ≤ 256 | no |
| streaming | quality | stream text differing from batch (WER) | 0 | ≤ 0 | yes |
| streaming | js-1 | first partial with words (s) | 0.2666 | ≤ 1 | yes |
| streaming | js-1 | CPU load | 0.0824 | ≤ 0.25 | yes |
| streaming | rust-1 | first partial with words (s) | 0.2555 | ≤ 1 | yes |
| streaming | rust-1 | CPU load | 0.0607 | ≤ 0.25 | yes |
| streaming | memory | peak RSS (MB) | 217.8594 | ≤ 256 | yes |
| voice-fit | quality | vocal tract length error | 0.0275 | ≤ 0.05 | yes |
| voice-fit | quality | pitch error | 0.0214 | ≤ 0.03 | yes |
| voice-fit | js-1 | CPU time / audio time | 0.1563 | ≤ 1 | yes |
| voice-fit | rust-1 | CPU time / audio time | 0.1483 | ≤ 1 | yes |
| voice-fit | memory | peak RSS (MB) | 202.2227 | ≤ 256 | yes |
| session | quality | share of voices reaching stable | 1 | ≥ 1 | yes |
| session | quality | vocal tract length error | 0.0188 | ≤ 0.05 | yes |
| session | quality | pitch error | 0.0112 | ≤ 0.03 | yes |
| session | js-1 | CPU time / audio time | 0.0785 | ≤ 0.5 | yes |
| session | rust-1 | CPU time / audio time | 0.0863 | ≤ 0.5 | yes |
| session | memory | peak RSS (MB) | 209.7617 | ≤ 256 | yes |
| copy | quality | mean f0 RMSE (semitones) | 4.7335 | ≤ 1.5 | no |
| copy | quality | mean timing error (ms) | 305.2 | ≤ 30 | no |
| copy | quality | phonemes of the copy agreeing | 0.3612 | ≥ 0.9 | no |
| copy | js-1 | reported, no limit: CPU time / audio time 1.1274 | — | — | certified |
| copy | rust-1 | reported, no limit: CPU time / audio time 1.1234 | — | — | certified |
| copy | memory | peak RSS (MB) | 405.5313 | ≤ 256 | no |
| modes | quality | share of modes recognised | 0.9167 | ≥ 0.8 | yes |
| modes | js-1 | real-time factor | 0.0815 | ≤ 0.25 | yes |
| modes | rust-1 | real-time factor | 0.0752 | ≤ 0.25 | yes |
| modes | memory | peak RSS (MB) | 239.5117 | ≤ 256 | yes |
| app | quality | text recognised back | 0.6875 | ≥ 1 | no |
| app | js-1 | synthesis worker real-time factor | 0.0797 | ≤ 1 | yes |
| app | js-1 | first sound (s) | 0.183 | ≤ 1 | yes |

## Runs

| Row | Engine | CPU (s) | Audio (s) | Peak RSS (MB) | Heap cap | Other measurements |
| --- | --- | ---: | ---: | ---: | --- | --- |
| synthesis | js | 7.917 | 391.707 | 374.3828 | 192 MB | wer 0.3537, wer16k 0.3624, werIncrease -0.0087, rtf 0.0202, recognitionRtf 0.1301, utterances 160 |
| synthesis | rust | 5.953 | 391.707 | 342.0508 | 192 MB | wer 0.3537, rtf 0.0152, recognitionRtf 0.1259, utterances 160 |
| recognition | js | 252.414 | 1071.807 | 393.3125 | 192 MB | per 0.8665, wer 1.2967, per16k 0.8664, wer16k 1.2983, perIncrease 0.0001, werIncrease -0.0017, rtf 0.2355, utterances 127 |
| recognition | rust | 315.682 | 1071.807 | 377.6445 | 192 MB | per 0.8665, wer 1.2967, rtf 0.2945, utterances 127 |
| streaming | js | 4.945 | 60 | 169.9414 | 192 MB | textMismatch 0, firstPartial 0.2666, load 0.0824, partials 240, streamText The quick brown fox jump sober the lady dog. She says she ce…, batchText The quick brown fox jump sober the lady dog. She says she ce… |
| streaming | rust | 3.644 | 60 | 217.8594 | 192 MB | textMismatch 0, firstPartial 0.2555, load 0.0607, partials 240, streamText The quick brown fox jump sober the lady dog. She says she ce…, batchText The quick brown fox jump sober the lady dog. She says she ce… |
| voice-fit | js | 4.69 | 30 | 198.2539 | 192 MB | vocalTractLengthError 0.0275, pitchError 0.0214, cpuRatio 0.1563 |
| voice-fit | rust | 4.45 | 30 | 202.2227 | 192 MB | vocalTractLengthError 0.0275, pitchError 0.0214, cpuRatio 0.1483 |
| session | js | 4.712 | 60 | 201.0547 | 192 MB | stable 1, vocalTractLengthError 0.0188, pitchError 0.0112, cpuRatio 0.0785 |
| session | rust | 5.18 | 60 | 209.7617 | 192 MB | stable 1, vocalTractLengthError 0.0188, pitchError 0.0112, cpuRatio 0.0863 |
| copy | js | 126.022 | 111.78 | 404.5508 | 192 MB | f0RmseSemitones 4.7335, timingErrorMs 305.2, phonemeAgreement 0.3612, maxF0RmseSemitones 8.7262, maxTimingErrorMs 1122.5, cpuRatio 1.1274, recordings 24 |
| copy | rust | 125.568 | 111.78 | 405.5313 | 192 MB | f0RmseSemitones 4.7335, timingErrorMs 305.2, phonemeAgreement 0.3612, maxF0RmseSemitones 8.7262, maxTimingErrorMs 1122.5, cpuRatio 1.1234, recordings 24 |
| modes | js | 8.914 | 109.405 | 233.0508 | 192 MB | modeShare 0.9167, rtf 0.0815, renderRtf 0.0222, utterances 60 |
| modes | rust | 8.223 | 109.405 | 239.5117 | 192 MB | modeShare 0.9167, rtf 0.0752, renderRtf 0.0161, utterances 60 |
| app | js | — | 11.289 | — | none | textBack 0.6875, workerRtf 0.0797, workerRtfMeasured 0.0133, firstSound 0.183, firstChunk 0.183, coldFirstSound 0.74, startDelay 0.183, sampleRate 8000, chunks 89, heard The quick brown fox jump solar the lady dog. She says she sh… |
