# Lowest settings: 8 kHz and one core

The matrix runs on 8000 Hz audio with `UV_THREADPOOL_SIZE=1`. The app row
runs in Chromium and uses its normal synthesis and recognition workers.
The other rows run in Node with no workers and no GPU. Input recordings
are converted with `resample`. The Rust engine runs with one thread and
no SIMD. Limits come from `tests/heavy/lowest-thresholds.json` and only
ever become stricter.

- Measured: 2026-11-28T05:39:43.674Z
- Commit: `484193918016566a8e24f60257ae9312ca8db0fd`
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
| app | certified | certified | — | — |

## Values and limits

| Row | Column | Metric | Value | Limit | Pass |
| --- | --- | --- | ---: | ---: | --- |
| synthesis | quality | WER increase over 16 kHz | 0.0022 | ≤ 0.05 | yes |
| synthesis | js-1 | real-time factor | 0.0216 | ≤ 0.25 | yes |
| synthesis | rust-1 | real-time factor | 0.0166 | ≤ 0.25 | yes |
| synthesis | memory | peak RSS (MB) | 370.0273 | ≤ 256 | no |
| recognition | quality | PER increase over 16 kHz | 0.0125 | ≤ 0.05 | yes |
| recognition | quality | WER increase over 16 kHz | -0.0732 | ≤ 0.08 | yes |
| recognition | js-1 | real-time factor | 0.0818 | ≤ 0.25 | yes |
| recognition | rust-1 | real-time factor | 0.0775 | ≤ 0.25 | yes |
| recognition | memory | peak RSS (MB) | 392.8633 | ≤ 256 | no |
| streaming | quality | stream text differing from batch (WER) | 0 | ≤ 0 | yes |
| streaming | js-1 | first partial with words (s) | 0.2694 | ≤ 1 | yes |
| streaming | js-1 | CPU load | 0.088 | ≤ 0.25 | yes |
| streaming | rust-1 | first partial with words (s) | 0.2576 | ≤ 1 | yes |
| streaming | rust-1 | CPU load | 0.071 | ≤ 0.25 | yes |
| streaming | memory | peak RSS (MB) | 207.4727 | ≤ 256 | yes |
| voice-fit | quality | vocal tract length error | 0.0275 | ≤ 0.05 | yes |
| voice-fit | quality | pitch error | 0.0214 | ≤ 0.03 | yes |
| voice-fit | js-1 | CPU time / audio time | 0.1732 | ≤ 1 | yes |
| voice-fit | rust-1 | CPU time / audio time | 0.1671 | ≤ 1 | yes |
| voice-fit | memory | peak RSS (MB) | 199.0703 | ≤ 256 | yes |
| session | quality | share of voices reaching stable | 1 | ≥ 1 | yes |
| session | quality | vocal tract length error | 0.019 | ≤ 0.05 | yes |
| session | quality | pitch error | 0.0112 | ≤ 0.03 | yes |
| session | js-1 | CPU time / audio time | 0.0985 | ≤ 0.5 | yes |
| session | rust-1 | CPU time / audio time | 0.0926 | ≤ 0.5 | yes |
| session | memory | peak RSS (MB) | 206 | ≤ 256 | yes |
| copy | quality | mean f0 RMSE (semitones) | 4.7335 | ≤ 1.5 | no |
| copy | quality | mean timing error (ms) | 305.2 | ≤ 30 | no |
| copy | quality | phonemes of the copy agreeing | 0.3628 | ≥ 0.9 | no |
| copy | js-1 | reported, no limit: CPU time / audio time 1.1383 | — | — | certified |
| copy | rust-1 | reported, no limit: CPU time / audio time 0.8289 | — | — | certified |
| copy | memory | peak RSS (MB) | 383.2891 | ≤ 256 | no |
| modes | quality | share of modes recognised | 0.9167 | ≥ 0.8 | yes |
| modes | js-1 | real-time factor | 0.1013 | ≤ 0.25 | yes |
| modes | rust-1 | real-time factor | 0.0898 | ≤ 0.25 | yes |
| modes | memory | peak RSS (MB) | 241.0508 | ≤ 256 | yes |
| app | quality | text recognised back | 1 | ≥ 1 | yes |
| app | js-1 | synthesis worker real-time factor | 0.0943 | < 1 | yes |
| app | js-1 | first sound (s) | 0.247 | ≤ 1 | yes |

## Runs

| Row | Engine | CPU (s) | Audio (s) | Peak RSS (MB) | Heap cap | Other measurements |
| --- | --- | ---: | ---: | ---: | --- | --- |
| synthesis | js | 8.454 | 391.707 | 370.0273 | 192 MB | wer 0.3603, wer16k 0.3581, werIncrease 0.0022, rtf 0.0216, recognitionRtf 0.1573, utterances 160 |
| synthesis | rust | 6.51 | 391.707 | 328.3203 | 192 MB | wer 0.3603, rtf 0.0166, recognitionRtf 0.1478, utterances 160 |
| recognition | js | 87.639 | 1071.807 | 392.8633 | 192 MB | per 0.8782, wer 1.2264, per16k 0.8656, wer16k 1.2996, perIncrease 0.0125, werIncrease -0.0732, rtf 0.0818, utterances 127 |
| recognition | rust | 83.11 | 1071.807 | 344.1758 | 192 MB | per 0.8782, wer 1.2264, rtf 0.0775, utterances 127 |
| streaming | js | 5.28 | 60 | 207.4727 | 192 MB | textMismatch 0, firstPartial 0.2694, load 0.088, partials 240, streamText The quick brown fox jumps over the lady dog. She says she ce…, batchText The quick brown fox jumps over the lady dog. She says she ce…, batchLastWord 59.9875, wholeInputLastWord 59.9875 |
| streaming | rust | 4.261 | 60 | 203.375 | 192 MB | textMismatch 0, firstPartial 0.2576, load 0.071, partials 240, streamText The quick brown fox jumps over the lady dog. She says she ce…, batchText The quick brown fox jumps over the lady dog. She says she ce…, batchLastWord 59.9875, wholeInputLastWord 59.9875 |
| voice-fit | js | 5.197 | 30 | 197.918 | 192 MB | vocalTractLengthError 0.0275, pitchError 0.0214, cpuRatio 0.1732 |
| voice-fit | rust | 5.014 | 30 | 199.0703 | 192 MB | vocalTractLengthError 0.0275, pitchError 0.0214, cpuRatio 0.1671 |
| session | js | 5.911 | 60 | 200.6875 | 192 MB | stable 1, vocalTractLengthError 0.019, pitchError 0.0112, cpuRatio 0.0985 |
| session | rust | 5.555 | 60 | 206 | 192 MB | stable 1, vocalTractLengthError 0.0188, pitchError 0.0112, cpuRatio 0.0926 |
| copy | js | 127.24 | 111.78 | 380.5078 | 192 MB | f0RmseSemitones 4.7335, timingErrorMs 305.2, phonemeAgreement 0.3628, maxF0RmseSemitones 8.7262, maxTimingErrorMs 1122.5, cpuRatio 1.1383, recordings 24 |
| copy | rust | 92.65 | 111.78 | 383.2891 | 192 MB | f0RmseSemitones 4.7335, timingErrorMs 305.2, phonemeAgreement 0.3628, maxF0RmseSemitones 8.7262, maxTimingErrorMs 1122.5, cpuRatio 0.8289, recordings 24 |
| modes | js | 11.086 | 109.405 | 235.4219 | 192 MB | modeShare 0.9167, rtf 0.1013, renderRtf 0.0234, utterances 60 |
| modes | rust | 9.828 | 109.405 | 241.0508 | 192 MB | modeShare 0.9167, rtf 0.0898, renderRtf 0.0175, utterances 60 |
| app | js | — | 11.289 | — | none | textBack 1, workerRtf 0.0943, workerRtfMeasured 0.0157, firstSound 0.247, firstChunk 0.247, coldFirstSound 0.787, startDelay 0.247, sampleRate 8000, chunks 89, heard The quick brown fox jumps over the lazy dog. She sells sea s… |
