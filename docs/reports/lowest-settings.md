# Lowest settings: 8 kHz and one core

The matrix runs on 8000 Hz audio with `UV_THREADPOOL_SIZE=1`. The app row
runs in Chromium and uses its normal synthesis and recognition workers.
The other rows run in Node with no workers and no GPU. Input recordings
are converted with `resample`. The Rust engine runs with one thread and
no SIMD. Limits come from `tests/heavy/lowest-thresholds.json` and only
ever become stricter.

- Measured: 2026-11-28T06:52:45.626Z
- Commit: `e39b710a907d34dbbda4204712467873dcd0c941`
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
| synthesis | js-1 | real-time factor | 0.0212 | ≤ 0.25 | yes |
| synthesis | rust-1 | real-time factor | 0.0166 | ≤ 0.25 | yes |
| synthesis | memory | peak RSS (MB) | 354.1133 | ≤ 256 | no |
| recognition | quality | PER increase over 16 kHz | 0.0125 | ≤ 0.05 | yes |
| recognition | quality | WER increase over 16 kHz | -0.0732 | ≤ 0.08 | yes |
| recognition | js-1 | real-time factor | 0.0817 | ≤ 0.25 | yes |
| recognition | rust-1 | real-time factor | 0.0778 | ≤ 0.25 | yes |
| recognition | memory | peak RSS (MB) | 381.375 | ≤ 256 | no |
| streaming | quality | stream text differing from batch (WER) | 0 | ≤ 0 | yes |
| streaming | js-1 | first partial with words (s) | 0.2707 | ≤ 1 | yes |
| streaming | js-1 | CPU load | 0.0835 | ≤ 0.25 | yes |
| streaming | rust-1 | first partial with words (s) | 0.2565 | ≤ 1 | yes |
| streaming | rust-1 | CPU load | 0.0664 | ≤ 0.25 | yes |
| streaming | memory | peak RSS (MB) | 211.3008 | ≤ 256 | yes |
| voice-fit | quality | vocal tract length error | 0.0275 | ≤ 0.05 | yes |
| voice-fit | quality | pitch error | 0.0214 | ≤ 0.03 | yes |
| voice-fit | js-1 | CPU time / audio time | 0.1723 | ≤ 1 | yes |
| voice-fit | rust-1 | CPU time / audio time | 0.1675 | ≤ 1 | yes |
| voice-fit | memory | peak RSS (MB) | 192.582 | ≤ 256 | yes |
| session | quality | share of voices reaching stable | 1 | ≥ 1 | yes |
| session | quality | vocal tract length error | 0.0197 | ≤ 0.05 | yes |
| session | quality | pitch error | 0.0112 | ≤ 0.03 | yes |
| session | js-1 | CPU time / audio time | 0.0915 | ≤ 0.5 | yes |
| session | rust-1 | CPU time / audio time | 0.0822 | ≤ 0.5 | yes |
| session | memory | peak RSS (MB) | 204.7891 | ≤ 256 | yes |
| copy | quality | mean f0 RMSE (semitones) | 4.7335 | ≤ 1.5 | no |
| copy | quality | mean timing error (ms) | 305.2 | ≤ 30 | no |
| copy | quality | phonemes of the copy agreeing | 0.3628 | ≥ 0.9 | no |
| copy | js-1 | reported, no limit: CPU time / audio time 1.1403 | — | — | certified |
| copy | rust-1 | reported, no limit: CPU time / audio time 0.8198 | — | — | certified |
| copy | memory | peak RSS (MB) | 374.6211 | ≤ 256 | no |
| modes | quality | share of modes recognised | 0.9167 | ≥ 0.8 | yes |
| modes | js-1 | real-time factor | 0.0991 | ≤ 0.25 | yes |
| modes | rust-1 | real-time factor | 0.0882 | ≤ 0.25 | yes |
| modes | memory | peak RSS (MB) | 227.6016 | ≤ 256 | yes |
| app | quality | text recognised back | 1 | ≥ 1 | yes |
| app | js-1 | synthesis worker real-time factor | 0.0884 | < 1 | yes |
| app | js-1 | first sound (s) | 0.21 | ≤ 1 | yes |

## Runs

| Row | Engine | CPU (s) | Audio (s) | Peak RSS (MB) | Heap cap | Other measurements |
| --- | --- | ---: | ---: | ---: | --- | --- |
| synthesis | js | 8.293 | 391.707 | 354.1133 | 192 MB | wer 0.3603, wer16k 0.3581, werIncrease 0.0022, rtf 0.0212, recognitionRtf 0.1568, utterances 160 |
| synthesis | rust | 6.505 | 391.707 | 260.5664 | 192 MB | wer 0.3603, rtf 0.0166, recognitionRtf 0.1452, utterances 160 |
| recognition | js | 87.59 | 1071.807 | 381.375 | 192 MB | per 0.8782, wer 1.2264, per16k 0.8656, wer16k 1.2996, perIncrease 0.0125, werIncrease -0.0732, rtf 0.0817, utterances 127 |
| recognition | rust | 83.393 | 1071.807 | 336.1992 | 192 MB | per 0.8782, wer 1.2264, rtf 0.0778, utterances 127 |
| streaming | js | 5.01 | 60 | 183.3359 | 192 MB | textMismatch 0, firstPartial 0.2707, load 0.0835, partials 240, streamText The quick brown fox jumps over the lady dog. She says she ce…, batchText The quick brown fox jumps over the lady dog. She says she ce…, batchLastWord 59.9875, wholeInputLastWord 59.9875 |
| streaming | rust | 3.985 | 60 | 211.3008 | 192 MB | textMismatch 0, firstPartial 0.2565, load 0.0664, partials 240, streamText The quick brown fox jumps over the lady dog. She says she ce…, batchText The quick brown fox jumps over the lady dog. She says she ce…, batchLastWord 59.9875, wholeInputLastWord 59.9875 |
| voice-fit | js | 5.169 | 30 | 192.582 | 192 MB | vocalTractLengthError 0.0275, pitchError 0.0214, cpuRatio 0.1723 |
| voice-fit | rust | 5.025 | 30 | 169.2734 | 192 MB | vocalTractLengthError 0.0275, pitchError 0.0214, cpuRatio 0.1675 |
| session | js | 5.491 | 60 | 201.5 | 192 MB | stable 1, vocalTractLengthError 0.0197, pitchError 0.0112, cpuRatio 0.0915 |
| session | rust | 4.933 | 60 | 204.7891 | 192 MB | stable 1, vocalTractLengthError 0.0188, pitchError 0.0112, cpuRatio 0.0822 |
| copy | js | 127.463 | 111.78 | 366.1094 | 192 MB | f0RmseSemitones 4.7335, timingErrorMs 305.2, phonemeAgreement 0.3628, maxF0RmseSemitones 8.7262, maxTimingErrorMs 1122.5, cpuRatio 1.1403, recordings 24 |
| copy | rust | 91.64 | 111.78 | 374.6211 | 192 MB | f0RmseSemitones 4.7335, timingErrorMs 305.2, phonemeAgreement 0.3628, maxF0RmseSemitones 8.7262, maxTimingErrorMs 1122.5, cpuRatio 0.8198, recordings 24 |
| modes | js | 10.838 | 109.405 | 227.6016 | 192 MB | modeShare 0.9167, rtf 0.0991, renderRtf 0.0228, utterances 60 |
| modes | rust | 9.649 | 109.405 | 226.3555 | 192 MB | modeShare 0.9167, rtf 0.0882, renderRtf 0.0174, utterances 60 |
| app | js | — | 11.289 | — | none | textBack 1, workerRtf 0.0884, workerRtfMeasured 0.0147, firstSound 0.21, firstChunk 0.21, coldFirstSound 0.631, startDelay 0.21, sampleRate 8000, chunks 89, heard The quick brown fox jumps over the lazy dog. She sells sea s… |
