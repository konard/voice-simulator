# Lowest settings: 8 kHz and one core

Every row runs on 8000 Hz audio in its own Node process with
`UV_THREADPOOL_SIZE=1`, no workers and no GPU. Input recordings are
converted with `resample`. The Rust engine runs with one thread and no
SIMD. Limits come from `tests/heavy/lowest-thresholds.json` and only ever
become stricter.

- Measured: 2026-11-28T03:42:50.228Z
- Commit: `ac5ecc748387603862e5f1ca7a34114445115882`
- Command: `node scripts/run-heavy.mjs --suite lowest`
- CPU: Intel(R) Xeon(R) 6975P-C
- Node: v24.22.3
- Pinning: pinned with `taskset -c 0`
- Heap cap: `--max-old-space-size=192`

| Row | quality | js-1 | rust-1 | memory |
| --- | --- | --- | --- | --- |
| synthesis | certified | certified | certified | [failed](https://github.com/konard/voice-simulator/issues/173) |
| recognition | certified | certified | certified | [failed](https://github.com/konard/voice-simulator/issues/173) |
| streaming | certified | certified | certified | [failed](https://github.com/konard/voice-simulator/issues/173) |
| voice-fit | certified | certified | certified | [failed](https://github.com/konard/voice-simulator/issues/173) |
| session | certified | certified | certified | [failed](https://github.com/konard/voice-simulator/issues/173) |
| copy | [failed](https://github.com/konard/voice-simulator/issues/178) | certified | certified | [failed](https://github.com/konard/voice-simulator/issues/173) |
| modes | certified | certified | certified | [failed](https://github.com/konard/voice-simulator/issues/173) |
| app | [failed](https://github.com/konard/voice-simulator/issues/180) | certified | — | — |

## Values and limits

| Row | Column | Metric | Value | Limit | Pass |
| --- | --- | --- | ---: | ---: | --- |
| synthesis | quality | WER increase over 16 kHz | 0.0033 | ≤ 0.05 | yes |
| synthesis | js-1 | real-time factor | 0.1752 | ≤ 0.25 | yes |
| synthesis | rust-1 | real-time factor | 0.051 | ≤ 0.25 | yes |
| synthesis | memory | peak RSS (MB) | 428.4 | ≤ 256 | no |
| recognition | quality | PER increase over 16 kHz | 0.0122 | ≤ 0.05 | yes |
| recognition | quality | WER increase over 16 kHz | -0.0766 | ≤ 0.08 | yes |
| recognition | js-1 | real-time factor | 0.1909 | ≤ 0.25 | yes |
| recognition | rust-1 | real-time factor | 0.1458 | ≤ 0.25 | yes |
| recognition | memory | peak RSS (MB) | 558.5 | ≤ 256 | no |
| streaming | quality | stream text differing from batch (WER) | 0 | ≤ 0 | yes |
| streaming | js-1 | first partial with words (s) | 0.2856 | ≤ 1 | yes |
| streaming | js-1 | CPU load | 0.1448 | ≤ 0.25 | yes |
| streaming | rust-1 | first partial with words (s) | 0.2865 | ≤ 1 | yes |
| streaming | rust-1 | CPU load | 0.1182 | ≤ 0.25 | yes |
| streaming | memory | peak RSS (MB) | 411.5 | ≤ 256 | no |
| voice-fit | quality | vocal tract length error | 0.0275 | ≤ 0.05 | yes |
| voice-fit | quality | pitch error | 0.0214 | ≤ 0.03 | yes |
| voice-fit | js-1 | CPU time / audio time | 0.1971 | ≤ 1 | yes |
| voice-fit | rust-1 | CPU time / audio time | 0.1924 | ≤ 1 | yes |
| voice-fit | memory | peak RSS (MB) | 323.5 | ≤ 256 | no |
| session | quality | share of voices reaching stable | 1 | ≥ 1 | yes |
| session | quality | vocal tract length error | 0.0197 | ≤ 0.05 | yes |
| session | quality | pitch error | 0.0117 | ≤ 0.03 | yes |
| session | js-1 | CPU time / audio time | 0.1151 | ≤ 0.5 | yes |
| session | rust-1 | CPU time / audio time | 0.1228 | ≤ 0.5 | yes |
| session | memory | peak RSS (MB) | 321.4 | ≤ 256 | no |
| copy | quality | mean f0 RMSE (semitones) | 4.7335 | ≤ 1.5 | no |
| copy | quality | mean timing error (ms) | 305.2 | ≤ 30 | no |
| copy | quality | phonemes of the copy agreeing | 0.3612 | ≥ 0.9 | no |
| copy | js-1 | reported, no limit: CPU time / audio time 10.0661 | — | — | certified |
| copy | rust-1 | reported, no limit: CPU time / audio time 9.705 | — | — | certified |
| copy | memory | peak RSS (MB) | 476.8 | ≤ 256 | no |
| modes | quality | share of modes recognised | 0.9167 | ≥ 0.8 | yes |
| modes | js-1 | real-time factor | 0.1083 | ≤ 0.25 | yes |
| modes | rust-1 | real-time factor | 0.106 | ≤ 0.25 | yes |
| modes | memory | peak RSS (MB) | 773 | ≤ 256 | no |
| app | quality | text recognised back | 0.6875 | ≥ 1 | no |
| app | js-1 | synthesis worker real-time factor | 0.1138 | ≤ 1 | yes |
| app | js-1 | first sound (s) | 0.216 | ≤ 1 | yes |

## Runs

| Row | Engine | CPU (s) | Audio (s) | Peak RSS (MB) | Heap cap | Other measurements |
| --- | --- | ---: | ---: | ---: | --- | --- |
| synthesis | js | 68.629 | 391.707 | 423.9 | 192 MB | wer 0.3657, wer16k 0.3624, werIncrease 0.0033, rtf 0.1752, recognitionRtf 0.358, utterances 160 |
| synthesis | rust | 19.991 | 391.707 | 428.4 | 192 MB | wer 0.3657, rtf 0.051, recognitionRtf 0.2832, utterances 160 |
| recognition | js | 204.586 | 1071.807 | 541.6 | 192 MB | per 0.8787, wer 1.2218, per16k 0.8664, wer16k 1.2983, perIncrease 0.0122, werIncrease -0.0766, rtf 0.1909, utterances 127 |
| recognition | rust | 156.25 | 1071.807 | 558.5 | 192 MB | per 0.8787, wer 1.2218, rtf 0.1458, utterances 127 |
| streaming | js | 8.686 | 60 | 375.9 | 192 MB | textMismatch 0, firstPartial 0.2856, load 0.1448, partials 240, streamText The quick brown fox jump sober the lady dog. She says she ce…, batchText The quick brown fox jump sober the lady dog. She says she ce…, batchLastWord 59.9875, wholeInputLastWord 59.9875 |
| streaming | rust | 7.091 | 60 | 411.5 | 192 MB | textMismatch 0, firstPartial 0.2865, load 0.1182, partials 240, streamText The quick brown fox jump sober the lady dog. She says she ce…, batchText The quick brown fox jump sober the lady dog. She says she ce…, batchLastWord 59.9875, wholeInputLastWord 59.9875 |
| voice-fit | js | 5.912 | 30 | 323.5 | 192 MB | vocalTractLengthError 0.0275, pitchError 0.0214, cpuRatio 0.1971 |
| voice-fit | rust | 5.771 | 30 | 305 | 192 MB | vocalTractLengthError 0.0275, pitchError 0.0214, cpuRatio 0.1924 |
| session | js | 6.903 | 60 | 311 | 192 MB | stable 1, vocalTractLengthError 0.0197, pitchError 0.0117, cpuRatio 0.1151 |
| session | rust | 7.368 | 60 | 321.4 | 192 MB | stable 1, vocalTractLengthError 0.0197, pitchError 0.0117, cpuRatio 0.1228 |
| copy | js | 1125.188 | 111.78 | 467.6 | 192 MB | f0RmseSemitones 4.7335, timingErrorMs 305.2, phonemeAgreement 0.3612, maxF0RmseSemitones 8.7262, maxTimingErrorMs 1122.5, cpuRatio 10.0661, recordings 24 |
| copy | rust | 1084.826 | 111.78 | 476.8 | 192 MB | f0RmseSemitones 4.7335, timingErrorMs 305.2, phonemeAgreement 0.3612, maxF0RmseSemitones 8.7262, maxTimingErrorMs 1122.5, cpuRatio 9.705, recordings 24 |
| modes | js | 11.85 | 109.405 | 767.8 | crashed at 192 MB (JavaScript heap out of memory); rerun without the cap | modeShare 0.9167, rtf 0.1083, renderRtf 0.0238, utterances 60 |
| modes | rust | 11.602 | 109.405 | 773 | crashed at 192 MB (JavaScript heap out of memory); rerun without the cap | modeShare 0.9167, rtf 0.106, renderRtf 0.0175, utterances 60 |
| app | js | — | 11.289 | — | none | textBack 0.6875, workerRtf 0.1138, workerRtfMeasured 0.019, firstSound 0.216, firstChunk 0.216, coldFirstSound 0.922, startDelay 0.213, sampleRate 8000, chunks 89, heard The quick brown fox jump solar the lady dog. She says she sh… |
