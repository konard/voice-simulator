# Lowest settings: 8 kHz and one core

Every row runs on 8000 Hz audio in its own Node process with
`UV_THREADPOOL_SIZE=1`, no workers and no GPU. Input recordings are
converted with `resample`. The Rust engine runs with one thread and no
SIMD. Limits come from `tests/heavy/lowest-thresholds.json` and only ever
become stricter.

- Measured: 2026-11-28T02:42:13.131Z
- Commit: `ee65cd1b9ece6aa24b5a6f990dea38774d443ae6`
- Command: `node scripts/run-heavy.mjs --suite lowest`
- CPU: Intel(R) Xeon(R) 6975P-C
- Node: v24.22.3
- Pinning: pinned with `taskset -c 0`
- Heap cap: `--max-old-space-size=192`

| Row | quality | js-1 | rust-1 | memory |
| --- | --- | --- | --- | --- |
| synthesis | certified | certified | certified | [failed](https://github.com/konard/voice-simulator/issues/173) |
| recognition | certified | [failed](https://github.com/konard/voice-simulator/issues/174) | [failed](https://github.com/konard/voice-simulator/issues/174) | [failed](https://github.com/konard/voice-simulator/issues/173) |
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
| synthesis | js-1 | real-time factor | 0.0218 | ≤ 0.25 | yes |
| synthesis | rust-1 | real-time factor | 0.0166 | ≤ 0.25 | yes |
| synthesis | memory | peak RSS (MB) | 384.8242 | ≤ 256 | no |
| recognition | quality | PER increase over 16 kHz | 0.0001 | ≤ 0.05 | yes |
| recognition | quality | WER increase over 16 kHz | -0.0017 | ≤ 0.08 | yes |
| recognition | js-1 | real-time factor | 0.2945 | ≤ 0.25 | no |
| recognition | rust-1 | real-time factor | 0.277 | ≤ 0.25 | no |
| recognition | memory | peak RSS (MB) | 401.9609 | ≤ 256 | no |
| streaming | quality | stream text differing from batch (WER) | 0 | ≤ 0 | yes |
| streaming | js-1 | first partial with words (s) | 0.2764 | ≤ 1 | yes |
| streaming | js-1 | CPU load | 0.1145 | ≤ 0.25 | yes |
| streaming | rust-1 | first partial with words (s) | 0.2707 | ≤ 1 | yes |
| streaming | rust-1 | CPU load | 0.0947 | ≤ 0.25 | yes |
| streaming | memory | peak RSS (MB) | 219.0547 | ≤ 256 | yes |
| voice-fit | quality | vocal tract length error | 0.0275 | ≤ 0.05 | yes |
| voice-fit | quality | pitch error | 0.0214 | ≤ 0.03 | yes |
| voice-fit | js-1 | CPU time / audio time | 0.2634 | ≤ 1 | yes |
| voice-fit | rust-1 | CPU time / audio time | 0.2564 | ≤ 1 | yes |
| voice-fit | memory | peak RSS (MB) | 199.2773 | ≤ 256 | yes |
| session | quality | share of voices reaching stable | 1 | ≥ 1 | yes |
| session | quality | vocal tract length error | 0.0197 | ≤ 0.05 | yes |
| session | quality | pitch error | 0.0117 | ≤ 0.03 | yes |
| session | js-1 | CPU time / audio time | 0.127 | ≤ 0.5 | yes |
| session | rust-1 | CPU time / audio time | 0.1173 | ≤ 0.5 | yes |
| session | memory | peak RSS (MB) | 208.5234 | ≤ 256 | yes |
| copy | quality | mean f0 RMSE (semitones) | 6.0356 | ≤ 1.5 | no |
| copy | quality | mean timing error (ms) | 274.5 | ≤ 30 | no |
| copy | quality | phonemes of the copy agreeing | 0.4038 | ≥ 0.9 | no |
| copy | js-1 | reported, no limit: CPU time / audio time 2.2744 | — | — | certified |
| copy | rust-1 | reported, no limit: CPU time / audio time 1.531 | — | — | certified |
| copy | memory | peak RSS (MB) | 442.6133 | ≤ 256 | no |
| modes | quality | share of modes recognised | 0.9167 | ≥ 0.8 | yes |
| modes | js-1 | real-time factor | 0.1063 | ≤ 0.25 | yes |
| modes | rust-1 | real-time factor | 0.0963 | ≤ 0.25 | yes |
| modes | memory | peak RSS (MB) | 242.3594 | ≤ 256 | yes |
| app | quality | text recognised back | 0.6875 | ≥ 1 | no |
| app | js-1 | synthesis worker real-time factor | 0.0889 | ≤ 1 | yes |
| app | js-1 | first sound (s) | 0.208 | ≤ 1 | yes |

## Runs

| Row | Engine | CPU (s) | Audio (s) | Peak RSS (MB) | Heap cap | Other measurements |
| --- | --- | ---: | ---: | ---: | --- | --- |
| synthesis | js | 8.545 | 391.707 | 384.8242 | 192 MB | wer 0.3537, wer16k 0.3624, werIncrease -0.0087, rtf 0.0218, recognitionRtf 0.1675, utterances 160 |
| synthesis | rust | 6.505 | 391.707 | 345.1992 | 192 MB | wer 0.3537, rtf 0.0166, recognitionRtf 0.1601, utterances 160 |
| recognition | js | 315.621 | 1071.807 | 401.9609 | 192 MB | per 0.8665, wer 1.2967, per16k 0.8664, wer16k 1.2983, perIncrease 0.0001, werIncrease -0.0017, rtf 0.2945, utterances 127 |
| recognition | rust | 296.843 | 1071.807 | 381.832 | 192 MB | per 0.8665, wer 1.2967, rtf 0.277, utterances 127 |
| streaming | js | 6.868 | 60 | 203.957 | 192 MB | textMismatch 0, firstPartial 0.2764, load 0.1145, partials 240, streamText The quick brown fox jump sober the lady dog. She says she ce…, batchText The quick brown fox jump sober the lady dog. She says she ce… |
| streaming | rust | 5.681 | 60 | 219.0547 | 192 MB | textMismatch 0, firstPartial 0.2707, load 0.0947, partials 240, streamText The quick brown fox jump sober the lady dog. She says she ce…, batchText The quick brown fox jump sober the lady dog. She says she ce… |
| voice-fit | js | 7.901 | 30 | 195.75 | 192 MB | vocalTractLengthError 0.0275, pitchError 0.0214, cpuRatio 0.2634 |
| voice-fit | rust | 7.692 | 30 | 199.2773 | 192 MB | vocalTractLengthError 0.0275, pitchError 0.0214, cpuRatio 0.2564 |
| session | js | 7.623 | 60 | 200.5703 | 192 MB | stable 1, vocalTractLengthError 0.0197, pitchError 0.0117, cpuRatio 0.127 |
| session | rust | 7.038 | 60 | 208.5234 | 192 MB | stable 1, vocalTractLengthError 0.0197, pitchError 0.0117, cpuRatio 0.1173 |
| copy | js | 254.238 | 111.78 | 439.332 | 192 MB | f0RmseSemitones 6.0356, timingErrorMs 274.5, phonemeAgreement 0.4038, maxF0RmseSemitones 12.7403, maxTimingErrorMs 1098, cpuRatio 2.2744, recordings 24 |
| copy | rust | 171.135 | 111.78 | 442.6133 | 192 MB | f0RmseSemitones 6.0356, timingErrorMs 274.5, phonemeAgreement 0.4038, maxF0RmseSemitones 12.7403, maxTimingErrorMs 1098, cpuRatio 1.531, recordings 24 |
| modes | js | 11.634 | 109.405 | 236.6563 | 192 MB | modeShare 0.9167, rtf 0.1063, renderRtf 0.0231, utterances 60 |
| modes | rust | 10.54 | 109.405 | 242.3594 | 192 MB | modeShare 0.9167, rtf 0.0963, renderRtf 0.0179, utterances 60 |
| app | js | — | 11.289 | — | none | textBack 0.6875, workerRtf 0.0889, workerRtfMeasured 0.0148, firstSound 0.208, firstChunk 0.208, coldFirstSound 0.831, startDelay 0.207, sampleRate 8000, chunks 89, heard The quick brown fox jump solar the lady dog. She says she sh… |
