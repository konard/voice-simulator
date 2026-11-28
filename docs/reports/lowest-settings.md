# Lowest settings: 8 kHz and one core

Every row runs on 8000 Hz audio in its own Node process with
`UV_THREADPOOL_SIZE=1`, no workers and no GPU. Input recordings are
converted with `resample`. The Rust engine runs with one thread and no
SIMD. Limits come from `tests/heavy/lowest-thresholds.json` and only ever
become stricter.

- Measured: 2026-11-28T05:09:50.705Z
- Commit: `c795e5488c52621b35160a68c02d036408cc8af1`
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
| app | [failed](https://github.com/konard/voice-simulator/issues/180) | certified | — | — |

## Values and limits

| Row | Column | Metric | Value | Limit | Pass |
| --- | --- | --- | ---: | ---: | --- |
| synthesis | quality | WER increase over 16 kHz | 0.0033 | ≤ 0.05 | yes |
| synthesis | js-1 | real-time factor | 0.0214 | ≤ 0.25 | yes |
| synthesis | rust-1 | real-time factor | 0.0163 | ≤ 0.25 | yes |
| synthesis | memory | peak RSS (MB) | 363.5352 | ≤ 256 | no |
| recognition | quality | PER increase over 16 kHz | 0.0122 | ≤ 0.05 | yes |
| recognition | quality | WER increase over 16 kHz | -0.0766 | ≤ 0.08 | yes |
| recognition | js-1 | real-time factor | 0.0817 | ≤ 0.25 | yes |
| recognition | rust-1 | real-time factor | 0.0765 | ≤ 0.25 | yes |
| recognition | memory | peak RSS (MB) | 393.082 | ≤ 256 | no |
| streaming | quality | stream text differing from batch (WER) | 0 | ≤ 0 | yes |
| streaming | js-1 | first partial with words (s) | 0.2595 | ≤ 1 | yes |
| streaming | js-1 | CPU load | 0.0837 | ≤ 0.25 | yes |
| streaming | rust-1 | first partial with words (s) | 0.2577 | ≤ 1 | yes |
| streaming | rust-1 | CPU load | 0.0695 | ≤ 0.25 | yes |
| streaming | memory | peak RSS (MB) | 216.1953 | ≤ 256 | yes |
| voice-fit | quality | vocal tract length error | 0.0275 | ≤ 0.05 | yes |
| voice-fit | quality | pitch error | 0.0214 | ≤ 0.03 | yes |
| voice-fit | js-1 | CPU time / audio time | 0.1736 | ≤ 1 | yes |
| voice-fit | rust-1 | CPU time / audio time | 0.165 | ≤ 1 | yes |
| voice-fit | memory | peak RSS (MB) | 200.6055 | ≤ 256 | yes |
| session | quality | share of voices reaching stable | 1 | ≥ 1 | yes |
| session | quality | vocal tract length error | 0.0197 | ≤ 0.05 | yes |
| session | quality | pitch error | 0.0112 | ≤ 0.03 | yes |
| session | js-1 | CPU time / audio time | 0.0945 | ≤ 0.5 | yes |
| session | rust-1 | CPU time / audio time | 0.0873 | ≤ 0.5 | yes |
| session | memory | peak RSS (MB) | 205.5352 | ≤ 256 | yes |
| copy | quality | mean f0 RMSE (semitones) | 4.7335 | ≤ 1.5 | no |
| copy | quality | mean timing error (ms) | 305.2 | ≤ 30 | no |
| copy | quality | phonemes of the copy agreeing | 0.3612 | ≥ 0.9 | no |
| copy | js-1 | reported, no limit: CPU time / audio time 1.1522 | — | — | certified |
| copy | rust-1 | reported, no limit: CPU time / audio time 0.8258 | — | — | certified |
| copy | memory | peak RSS (MB) | 390.332 | ≤ 256 | no |
| modes | quality | share of modes recognised | 0.9167 | ≥ 0.8 | yes |
| modes | js-1 | real-time factor | 0.0989 | ≤ 0.25 | yes |
| modes | rust-1 | real-time factor | 0.0903 | ≤ 0.25 | yes |
| modes | memory | peak RSS (MB) | 239.3203 | ≤ 256 | yes |
| app | quality | text recognised back | 0.6875 | ≥ 1 | no |
| app | js-1 | synthesis worker real-time factor | 0.1098 | ≤ 1 | yes |
| app | js-1 | first sound (s) | 0.265 | ≤ 1 | yes |

## Runs

| Row | Engine | CPU (s) | Audio (s) | Peak RSS (MB) | Heap cap | Other measurements |
| --- | --- | ---: | ---: | ---: | --- | --- |
| synthesis | js | 8.382 | 391.707 | 363.5352 | 192 MB | wer 0.3657, wer16k 0.3624, werIncrease 0.0033, rtf 0.0214, recognitionRtf 0.1564, utterances 160 |
| synthesis | rust | 6.368 | 391.707 | 262.1211 | 192 MB | wer 0.3657, rtf 0.0163, recognitionRtf 0.1441, utterances 160 |
| recognition | js | 87.531 | 1071.807 | 393.082 | 192 MB | per 0.8787, wer 1.2218, per16k 0.8664, wer16k 1.2983, perIncrease 0.0122, werIncrease -0.0766, rtf 0.0817, utterances 127 |
| recognition | rust | 81.952 | 1071.807 | 341.6094 | 192 MB | per 0.8787, wer 1.2218, rtf 0.0765, utterances 127 |
| streaming | js | 5.021 | 60 | 216.1953 | 192 MB | textMismatch 0, firstPartial 0.2595, load 0.0837, partials 240, streamText The quick brown fox jump sober the lady dog. She says she ce…, batchText The quick brown fox jump sober the lady dog. She says she ce…, batchLastWord 59.9875, wholeInputLastWord 59.9875 |
| streaming | rust | 4.169 | 60 | 209.3828 | 192 MB | textMismatch 0, firstPartial 0.2577, load 0.0695, partials 240, streamText The quick brown fox jump sober the lady dog. She says she ce…, batchText The quick brown fox jump sober the lady dog. She says she ce…, batchLastWord 59.9875, wholeInputLastWord 59.9875 |
| voice-fit | js | 5.208 | 30 | 200.6055 | 192 MB | vocalTractLengthError 0.0275, pitchError 0.0214, cpuRatio 0.1736 |
| voice-fit | rust | 4.95 | 30 | 199.6602 | 192 MB | vocalTractLengthError 0.0275, pitchError 0.0214, cpuRatio 0.165 |
| session | js | 5.67 | 60 | 201.4297 | 192 MB | stable 1, vocalTractLengthError 0.0197, pitchError 0.0112, cpuRatio 0.0945 |
| session | rust | 5.237 | 60 | 205.5352 | 192 MB | stable 1, vocalTractLengthError 0.0188, pitchError 0.0112, cpuRatio 0.0873 |
| copy | js | 128.792 | 111.78 | 384.7734 | 192 MB | f0RmseSemitones 4.7335, timingErrorMs 305.2, phonemeAgreement 0.3612, maxF0RmseSemitones 8.7262, maxTimingErrorMs 1122.5, cpuRatio 1.1522, recordings 24 |
| copy | rust | 92.313 | 111.78 | 390.332 | 192 MB | f0RmseSemitones 4.7335, timingErrorMs 305.2, phonemeAgreement 0.3612, maxF0RmseSemitones 8.7262, maxTimingErrorMs 1122.5, cpuRatio 0.8258, recordings 24 |
| modes | js | 10.816 | 109.405 | 236.707 | 192 MB | modeShare 0.9167, rtf 0.0989, renderRtf 0.023, utterances 60 |
| modes | rust | 9.884 | 109.405 | 239.3203 | 192 MB | modeShare 0.9167, rtf 0.0903, renderRtf 0.018, utterances 60 |
| app | js | — | 11.289 | — | none | textBack 0.6875, workerRtf 0.1098, workerRtfMeasured 0.0183, firstSound 0.265, firstChunk 0.265, coldFirstSound 0.607, startDelay 0.263, sampleRate 8000, chunks 89, heard The quick brown fox jump solar the lady dog. She says she sh… |
