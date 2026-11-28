# Lowest settings: 8 kHz and one core

The matrix runs on 8000 Hz audio with `UV_THREADPOOL_SIZE=1`. The app row
runs in Chromium and uses its normal synthesis and recognition workers.
The other rows run in Node with no workers and no GPU. Input recordings
are converted with `resample`. The Rust engine runs with one thread and
no SIMD. Limits come from `tests/heavy/lowest-thresholds.json` and only
ever become stricter.

- Measured: 2026-11-28T13:44:06.728Z
- Commit: `afdb237be16c0e0f4e59fd156bc0c80cc58228a2`
- Command: `node scripts/run-heavy.mjs --suite lowest`
- CPU: AMD EPYC 7763 64-Core Processor
- Node: v24.22.3
- Pinning: pinned with `taskset -c 0`
- Heap cap: `--max-old-space-size=192`

| Row | quality | js-1 | rust-1 | memory |
| --- | --- | --- | --- | --- |
| synthesis | certified | certified | certified | certified |
| recognition | certified | certified | certified | certified |
| streaming | certified | certified | certified | certified |
| voice-fit | certified | certified | certified | certified |
| session | certified | certified | certified | certified |
| copy | [failed](https://github.com/konard/voice-simulator/issues/178) | certified | certified | certified |
| modes | certified | certified | certified | certified |
| app | certified | certified | — | — |

## Values and limits

| Row | Column | Metric | Value | Limit | Pass |
| --- | --- | --- | ---: | ---: | --- |
| synthesis | quality | WER increase over 16 kHz | 0.0022 | ≤ 0.05 | yes |
| synthesis | js-1 | real-time factor | 0.0355 | ≤ 0.25 | yes |
| synthesis | rust-1 | real-time factor | 0.0254 | ≤ 0.25 | yes |
| synthesis | memory | peak RSS (MB) | 249.5195 | ≤ 256 | yes |
| recognition | quality | PER increase over 16 kHz | 0.0125 | ≤ 0.05 | yes |
| recognition | quality | WER increase over 16 kHz | -0.0732 | ≤ 0.08 | yes |
| recognition | js-1 | real-time factor | 0.1196 | ≤ 0.25 | yes |
| recognition | rust-1 | real-time factor | 0.1381 | ≤ 0.25 | yes |
| recognition | memory | peak RSS (MB) | 245.5508 | ≤ 256 | yes |
| streaming | quality | stream text differing from batch (WER) | 0 | ≤ 0 | yes |
| streaming | js-1 | first partial with words (s) | 0.2704 | ≤ 1 | yes |
| streaming | js-1 | CPU load | 0.1504 | ≤ 0.25 | yes |
| streaming | rust-1 | first partial with words (s) | 0.2643 | ≤ 1 | yes |
| streaming | rust-1 | CPU load | 0.1299 | ≤ 0.25 | yes |
| streaming | memory | peak RSS (MB) | 176.6719 | ≤ 256 | yes |
| voice-fit | quality | vocal tract length error | 0.0275 | ≤ 0.05 | yes |
| voice-fit | quality | pitch error | 0.0214 | ≤ 0.03 | yes |
| voice-fit | js-1 | CPU time / audio time | 0.3512 | ≤ 1 | yes |
| voice-fit | rust-1 | CPU time / audio time | 0.2693 | ≤ 1 | yes |
| voice-fit | memory | peak RSS (MB) | 161.8203 | ≤ 256 | yes |
| session | quality | share of voices reaching stable | 1 | ≥ 1 | yes |
| session | quality | vocal tract length error | 0.019 | ≤ 0.05 | yes |
| session | quality | pitch error | 0.0112 | ≤ 0.03 | yes |
| session | js-1 | CPU time / audio time | 0.1143 | ≤ 0.5 | yes |
| session | rust-1 | CPU time / audio time | 0.1035 | ≤ 0.5 | yes |
| session | memory | peak RSS (MB) | 186.168 | ≤ 256 | yes |
| copy | quality | mean f0 RMSE (semitones) | 4.7335 | ≤ 1.5 | no |
| copy | quality | mean timing error (ms) | 305.2 | ≤ 30 | no |
| copy | quality | phonemes of the copy agreeing | 0.3628 | ≥ 0.9 | no |
| copy | js-1 | reported, no limit: CPU time / audio time 1.6101 | — | — | certified |
| copy | rust-1 | reported, no limit: CPU time / audio time 1.12 | — | — | certified |
| copy | memory | peak RSS (MB) | 248.7539 | ≤ 256 | yes |
| modes | quality | share of modes recognised | 0.9 | ≥ 0.8 | yes |
| modes | js-1 | real-time factor | 0.1467 | ≤ 0.25 | yes |
| modes | rust-1 | real-time factor | 0.1341 | ≤ 0.25 | yes |
| modes | memory | peak RSS (MB) | 203.3477 | ≤ 256 | yes |
| app | quality | text recognised back | 1 | ≥ 1 | yes |
| app | js-1 | synthesis worker real-time factor | 0.2029 | < 1 | yes |
| app | js-1 | first sound (s) | 0.307 | ≤ 1 | yes |

## Runs

| Row | Engine | CPU (s) | Audio (s) | Peak RSS (MB) | Heap cap | Other measurements |
| --- | --- | ---: | ---: | ---: | --- | --- |
| synthesis | js | 13.922 | 391.707 | 249.5195 | 192 MB | wer 0.3603, wer16k 0.3581, werIncrease 0.0022, rtf 0.0355, recognitionRtf 0.2206, utterances 160 |
| synthesis | rust | 9.941 | 391.707 | 220.4336 | 192 MB | wer 0.3603, rtf 0.0254, recognitionRtf 0.2124, utterances 160 |
| recognition | js | 128.162 | 1071.807 | 245.5508 | 192 MB | per 0.8782, wer 1.2264, per16k 0.8656, wer16k 1.2996, perIncrease 0.0125, werIncrease -0.0732, rtf 0.1196, utterances 127 |
| recognition | rust | 147.968 | 1071.807 | 232.3516 | 192 MB | per 0.8782, wer 1.2264, rtf 0.1381, utterances 127 |
| streaming | js | 9.022 | 60 | 166.4648 | 192 MB | textMismatch 0, firstPartial 0.2704, load 0.1504, partials 240, streamText The quick brown fox jumps over the lady dog. She says she ce…, batchText The quick brown fox jumps over the lady dog. She says she ce…, batchLastWord 59.9875, wholeInputLastWord 59.9875 |
| streaming | rust | 7.793 | 60 | 176.6719 | 192 MB | textMismatch 0, firstPartial 0.2643, load 0.1299, partials 240, streamText The quick brown fox jumps over the lady dog. She says she ce…, batchText The quick brown fox jumps over the lady dog. She says she ce…, batchLastWord 59.9875, wholeInputLastWord 59.9875 |
| voice-fit | js | 10.536 | 30 | 153.3086 | 192 MB | vocalTractLengthError 0.0275, pitchError 0.0214, cpuRatio 0.3512 |
| voice-fit | rust | 8.078 | 30 | 161.8203 | 192 MB | vocalTractLengthError 0.0275, pitchError 0.0214, cpuRatio 0.2693 |
| session | js | 6.859 | 60 | 166.6133 | 192 MB | stable 1, vocalTractLengthError 0.019, pitchError 0.0112, cpuRatio 0.1143 |
| session | rust | 6.212 | 60 | 186.168 | 192 MB | stable 1, vocalTractLengthError 0.0197, pitchError 0.0112, cpuRatio 0.1035 |
| copy | js | 179.977 | 111.78 | 239.8281 | 192 MB | f0RmseSemitones 4.7335, timingErrorMs 305.2, phonemeAgreement 0.3628, maxF0RmseSemitones 8.7262, maxTimingErrorMs 1122.5, cpuRatio 1.6101, recordings 24 |
| copy | rust | 125.198 | 111.78 | 248.7539 | 192 MB | f0RmseSemitones 4.7335, timingErrorMs 305.2, phonemeAgreement 0.3628, maxF0RmseSemitones 8.7262, maxTimingErrorMs 1122.5, cpuRatio 1.12, recordings 24 |
| modes | js | 16.052 | 109.405 | 203.3477 | 192 MB | modeShare 0.9, rtf 0.1467, renderRtf 0.0393, utterances 60 |
| modes | rust | 14.666 | 109.405 | 171.7578 | 192 MB | modeShare 0.9, rtf 0.1341, renderRtf 0.0272, utterances 60 |
| app | js | — | 11.289 | — | none | textBack 1, workerRtf 0.2029, workerRtfMeasured 0.0338, firstSound 0.307, firstChunk 0.307, coldFirstSound 1.042, startDelay 0.307, sampleRate 8000, chunks 89, heard The quick brown fox jumps over the lazy dog. She sells sea s… |
