# Lowest settings: 8 kHz and one core

The matrix runs on 8000 Hz audio with `UV_THREADPOOL_SIZE=1`. The app row
runs in Chromium and uses its normal synthesis and recognition workers.
The other rows run in Node with no workers and no GPU. Input recordings
are converted with `resample`. The Rust engine runs with one thread and
no SIMD. Limits come from `tests/heavy/lowest-thresholds.json` and only
ever become stricter.

- Measured: 2026-11-28T06:37:11.182Z
- Commit: `9626a26b5effa981cf9db6eec76946b9064fac07`
- Command: `node scripts/run-heavy.mjs --suite lowest`
- CPU: AMD EPYC 9V45 96-Core Processor
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
| synthesis | js-1 | real-time factor | 0.0177 | ≤ 0.25 | yes |
| synthesis | rust-1 | real-time factor | 0.0133 | ≤ 0.25 | yes |
| synthesis | memory | peak RSS (MB) | 351.168 | ≤ 256 | no |
| recognition | quality | PER increase over 16 kHz | 0.0125 | ≤ 0.05 | yes |
| recognition | quality | WER increase over 16 kHz | -0.0732 | ≤ 0.08 | yes |
| recognition | js-1 | real-time factor | 0.0516 | ≤ 0.25 | yes |
| recognition | rust-1 | real-time factor | 0.0588 | ≤ 0.25 | yes |
| recognition | memory | peak RSS (MB) | 383.6016 | ≤ 256 | no |
| streaming | quality | stream text differing from batch (WER) | 0 | ≤ 0 | yes |
| streaming | js-1 | first partial with words (s) | 0.2652 | ≤ 1 | yes |
| streaming | js-1 | CPU load | 0.0659 | ≤ 0.25 | yes |
| streaming | rust-1 | first partial with words (s) | 0.2596 | ≤ 1 | yes |
| streaming | rust-1 | CPU load | 0.0607 | ≤ 0.25 | yes |
| streaming | memory | peak RSS (MB) | 210.9531 | ≤ 256 | yes |
| voice-fit | quality | vocal tract length error | 0.0275 | ≤ 0.05 | yes |
| voice-fit | quality | pitch error | 0.0214 | ≤ 0.03 | yes |
| voice-fit | js-1 | CPU time / audio time | 0.126 | ≤ 1 | yes |
| voice-fit | rust-1 | CPU time / audio time | 0.1265 | ≤ 1 | yes |
| voice-fit | memory | peak RSS (MB) | 199.6484 | ≤ 256 | yes |
| session | quality | share of voices reaching stable | 1 | ≥ 1 | yes |
| session | quality | vocal tract length error | 0.0188 | ≤ 0.05 | yes |
| session | quality | pitch error | 0.0112 | ≤ 0.03 | yes |
| session | js-1 | CPU time / audio time | 0.0618 | ≤ 0.5 | yes |
| session | rust-1 | CPU time / audio time | 0.061 | ≤ 0.5 | yes |
| session | memory | peak RSS (MB) | 202.1133 | ≤ 256 | yes |
| copy | quality | mean f0 RMSE (semitones) | 4.7335 | ≤ 1.5 | no |
| copy | quality | mean timing error (ms) | 305.2 | ≤ 30 | no |
| copy | quality | phonemes of the copy agreeing | 0.3628 | ≥ 0.9 | no |
| copy | js-1 | reported, no limit: CPU time / audio time 0.7789 | — | — | certified |
| copy | rust-1 | reported, no limit: CPU time / audio time 0.5766 | — | — | certified |
| copy | memory | peak RSS (MB) | 374.2891 | ≤ 256 | no |
| modes | quality | share of modes recognised | 0.9167 | ≥ 0.8 | yes |
| modes | js-1 | real-time factor | 0.0689 | ≤ 0.25 | yes |
| modes | rust-1 | real-time factor | 0.0639 | ≤ 0.25 | yes |
| modes | memory | peak RSS (MB) | 230.6016 | ≤ 256 | yes |
| app | quality | text recognised back | 1 | ≥ 1 | yes |
| app | js-1 | synthesis worker real-time factor | 0.0694 | < 1 | yes |
| app | js-1 | first sound (s) | 0.154 | ≤ 1 | yes |

## Runs

| Row | Engine | CPU (s) | Audio (s) | Peak RSS (MB) | Heap cap | Other measurements |
| --- | --- | ---: | ---: | ---: | --- | --- |
| synthesis | js | 6.947 | 391.707 | 351.168 | 192 MB | wer 0.3603, wer16k 0.3581, werIncrease 0.0022, rtf 0.0177, recognitionRtf 0.0989, utterances 160 |
| synthesis | rust | 5.206 | 391.707 | 260.1953 | 192 MB | wer 0.3603, rtf 0.0133, recognitionRtf 0.0945, utterances 160 |
| recognition | js | 55.33 | 1071.807 | 383.6016 | 192 MB | per 0.8782, wer 1.2264, per16k 0.8656, wer16k 1.2996, perIncrease 0.0125, werIncrease -0.0732, rtf 0.0516, utterances 127 |
| recognition | rust | 63.037 | 1071.807 | 332.7734 | 192 MB | per 0.8782, wer 1.2264, rtf 0.0588, utterances 127 |
| streaming | js | 3.953 | 60 | 210.3672 | 192 MB | textMismatch 0, firstPartial 0.2652, load 0.0659, partials 240, streamText The quick brown fox jumps over the lady dog. She says she ce…, batchText The quick brown fox jumps over the lady dog. She says she ce…, batchLastWord 59.9875, wholeInputLastWord 59.9875 |
| streaming | rust | 3.642 | 60 | 210.9531 | 192 MB | textMismatch 0, firstPartial 0.2596, load 0.0607, partials 240, streamText The quick brown fox jumps over the lady dog. She says she ce…, batchText The quick brown fox jumps over the lady dog. She says she ce…, batchLastWord 59.9875, wholeInputLastWord 59.9875 |
| voice-fit | js | 3.781 | 30 | 199.6484 | 192 MB | vocalTractLengthError 0.0275, pitchError 0.0214, cpuRatio 0.126 |
| voice-fit | rust | 3.796 | 30 | 170.6875 | 192 MB | vocalTractLengthError 0.0275, pitchError 0.0214, cpuRatio 0.1265 |
| session | js | 3.709 | 60 | 178.2188 | 192 MB | stable 1, vocalTractLengthError 0.0188, pitchError 0.0112, cpuRatio 0.0618 |
| session | rust | 3.661 | 60 | 202.1133 | 192 MB | stable 1, vocalTractLengthError 0.0188, pitchError 0.0112, cpuRatio 0.061 |
| copy | js | 87.061 | 111.78 | 374.2891 | 192 MB | f0RmseSemitones 4.7335, timingErrorMs 305.2, phonemeAgreement 0.3628, maxF0RmseSemitones 8.7262, maxTimingErrorMs 1122.5, cpuRatio 0.7789, recordings 24 |
| copy | rust | 64.457 | 111.78 | 372.2188 | 192 MB | f0RmseSemitones 4.7335, timingErrorMs 305.2, phonemeAgreement 0.3628, maxF0RmseSemitones 8.7262, maxTimingErrorMs 1122.5, cpuRatio 0.5766, recordings 24 |
| modes | js | 7.537 | 109.405 | 222.3555 | 192 MB | modeShare 0.9167, rtf 0.0689, renderRtf 0.0203, utterances 60 |
| modes | rust | 6.996 | 109.405 | 230.6016 | 192 MB | modeShare 0.9167, rtf 0.0639, renderRtf 0.0147, utterances 60 |
| app | js | — | 11.289 | — | none | textBack 1, workerRtf 0.0694, workerRtfMeasured 0.0116, firstSound 0.154, firstChunk 0.154, coldFirstSound 0.511, startDelay 0.153, sampleRate 8000, chunks 89, heard The quick brown fox jumps over the lazy dog. She sells sea s… |
