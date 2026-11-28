# Lowest settings: 8 kHz and one core

The matrix runs on 8000 Hz audio with `UV_THREADPOOL_SIZE=1`. The app row
runs in Chromium and uses its normal synthesis and recognition workers.
The other rows run in Node with no workers and no GPU. Input recordings
are converted with `resample`. The Rust engine runs with one thread and
no SIMD. Limits come from `tests/heavy/lowest-thresholds.json` and only
ever become stricter.

- Measured: 2026-11-28T04:25:28.446Z
- Commit: `7f6c3408e3381e5956fd6bd58fe5afbf0d7abc20`
- Command: `node scripts/run-heavy.mjs --suite lowest`
- CPU: AMD EPYC 9V45 96-Core Processor
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
| app | certified | certified | — | — |

## Values and limits

| Row | Column | Metric | Value | Limit | Pass |
| --- | --- | --- | ---: | ---: | --- |
| synthesis | quality | WER increase over 16 kHz | 0.0033 | ≤ 0.05 | yes |
| synthesis | js-1 | real-time factor | 0.1344 | ≤ 0.25 | yes |
| synthesis | rust-1 | real-time factor | 0.0447 | ≤ 0.25 | yes |
| synthesis | memory | peak RSS (MB) | 421.1 | ≤ 256 | no |
| recognition | quality | PER increase over 16 kHz | 0.0122 | ≤ 0.05 | yes |
| recognition | quality | WER increase over 16 kHz | -0.0766 | ≤ 0.08 | yes |
| recognition | js-1 | real-time factor | 0.1703 | ≤ 0.25 | yes |
| recognition | rust-1 | real-time factor | 0.0988 | ≤ 0.25 | yes |
| recognition | memory | peak RSS (MB) | 539.5 | ≤ 256 | no |
| streaming | quality | stream text differing from batch (WER) | 0 | ≤ 0 | yes |
| streaming | js-1 | first partial with words (s) | 0.2847 | ≤ 1 | yes |
| streaming | js-1 | CPU load | 0.1148 | ≤ 0.25 | yes |
| streaming | rust-1 | first partial with words (s) | 0.284 | ≤ 1 | yes |
| streaming | rust-1 | CPU load | 0.1086 | ≤ 0.25 | yes |
| streaming | memory | peak RSS (MB) | 398 | ≤ 256 | no |
| voice-fit | quality | vocal tract length error | 0.0275 | ≤ 0.05 | yes |
| voice-fit | quality | pitch error | 0.0214 | ≤ 0.03 | yes |
| voice-fit | js-1 | CPU time / audio time | 0.2299 | ≤ 1 | yes |
| voice-fit | rust-1 | CPU time / audio time | 0.2215 | ≤ 1 | yes |
| voice-fit | memory | peak RSS (MB) | 312.4 | ≤ 256 | no |
| session | quality | share of voices reaching stable | 1 | ≥ 1 | yes |
| session | quality | vocal tract length error | 0.0197 | ≤ 0.05 | yes |
| session | quality | pitch error | 0.0117 | ≤ 0.03 | yes |
| session | js-1 | CPU time / audio time | 0.1213 | ≤ 0.5 | yes |
| session | rust-1 | CPU time / audio time | 0.1113 | ≤ 0.5 | yes |
| session | memory | peak RSS (MB) | 317 | ≤ 256 | no |
| copy | quality | mean f0 RMSE (semitones) | 4.7335 | ≤ 1.5 | no |
| copy | quality | mean timing error (ms) | 305.2 | ≤ 30 | no |
| copy | quality | phonemes of the copy agreeing | 0.3612 | ≥ 0.9 | no |
| copy | js-1 | reported, no limit: CPU time / audio time 6.7408 | — | — | certified |
| copy | rust-1 | reported, no limit: CPU time / audio time 7.1015 | — | — | certified |
| copy | memory | peak RSS (MB) | 470.9 | ≤ 256 | no |
| modes | quality | share of modes recognised | 0.9167 | ≥ 0.8 | yes |
| modes | js-1 | real-time factor | 0.0791 | ≤ 0.25 | yes |
| modes | rust-1 | real-time factor | 0.076 | ≤ 0.25 | yes |
| modes | memory | peak RSS (MB) | 408.9 | ≤ 256 | no |
| app | quality | text recognised back | 1 | ≥ 1 | yes |
| app | js-1 | synthesis worker real-time factor | 0.1725 | < 1 | yes |
| app | js-1 | first sound (s) | 0.556 | ≤ 1 | yes |

## Runs

| Row | Engine | CPU (s) | Audio (s) | Peak RSS (MB) | Heap cap | Other measurements |
| --- | --- | ---: | ---: | ---: | --- | --- |
| synthesis | js | 52.659 | 391.707 | 410.5 | 192 MB | wer 0.3657, wer16k 0.3624, werIncrease 0.0033, rtf 0.1344, recognitionRtf 0.2458, utterances 160 |
| synthesis | rust | 17.501 | 391.707 | 421.1 | 192 MB | wer 0.3657, rtf 0.0447, recognitionRtf 0.2303, utterances 160 |
| recognition | js | 182.539 | 1071.807 | 539.5 | 192 MB | per 0.8787, wer 1.2218, per16k 0.8664, wer16k 1.2983, perIncrease 0.0122, werIncrease -0.0766, rtf 0.1703, utterances 127 |
| recognition | rust | 105.93 | 1071.807 | 538.7 | 192 MB | per 0.8787, wer 1.2218, rtf 0.0988, utterances 127 |
| streaming | js | 6.886 | 60 | 371.4 | 192 MB | textMismatch 0, firstPartial 0.2847, load 0.1148, partials 240, streamText The quick brown fox jump sober the lady dog. She says she ce…, batchText The quick brown fox jump sober the lady dog. She says she ce…, batchLastWord 59.9875, wholeInputLastWord 59.9875 |
| streaming | rust | 6.514 | 60 | 398 | 192 MB | textMismatch 0, firstPartial 0.284, load 0.1086, partials 240, streamText The quick brown fox jump sober the lady dog. She says she ce…, batchText The quick brown fox jump sober the lady dog. She says she ce…, batchLastWord 59.9875, wholeInputLastWord 59.9875 |
| voice-fit | js | 6.897 | 30 | 302.9 | 192 MB | vocalTractLengthError 0.0275, pitchError 0.0214, cpuRatio 0.2299 |
| voice-fit | rust | 6.645 | 30 | 312.4 | 192 MB | vocalTractLengthError 0.0275, pitchError 0.0214, cpuRatio 0.2215 |
| session | js | 7.276 | 60 | 312.3 | 192 MB | stable 1, vocalTractLengthError 0.0197, pitchError 0.0117, cpuRatio 0.1213 |
| session | rust | 6.675 | 60 | 317 | 192 MB | stable 1, vocalTractLengthError 0.0197, pitchError 0.0112, cpuRatio 0.1113 |
| copy | js | 753.484 | 111.78 | 464.4 | 192 MB | f0RmseSemitones 4.7335, timingErrorMs 305.2, phonemeAgreement 0.3612, maxF0RmseSemitones 8.7262, maxTimingErrorMs 1122.5, cpuRatio 6.7408, recordings 24 |
| copy | rust | 793.801 | 111.78 | 470.9 | 192 MB | f0RmseSemitones 4.7335, timingErrorMs 305.2, phonemeAgreement 0.3612, maxF0RmseSemitones 8.7262, maxTimingErrorMs 1122.5, cpuRatio 7.1015, recordings 24 |
| modes | js | 8.652 | 109.405 | 402 | 192 MB | modeShare 0.9167, rtf 0.0791, renderRtf 0.0212, utterances 60 |
| modes | rust | 8.315 | 109.405 | 408.9 | 192 MB | modeShare 0.9167, rtf 0.076, renderRtf 0.0153, utterances 60 |
| app | js | — | 11.289 | — | 192 MB | textBack 1, workerRtf 0.1725, workerRtfMeasured 0.0287, firstSound 0.556, firstChunk 0.556, coldFirstSound 2.469, startDelay 0.553, sampleRate 8000, chunks 89, heard The quick brown fox jumps over the lazy dog. She sells sea s… |

## Targeted reruns

- **app** at commit `ceb7085c91e331715122f5391f7de84ae1ad5078` on Intel(R) Xeon(R) 6975P-C, Node v24.22.3, measured 2026-11-28T04:52:43.717Z.
  Pinned with `taskset -c 0`. Command `UV_THREADPOOL_SIZE=1 taskset -c 0 node --max-old-space-size=192 scripts/check-app-lowest.mjs --skip-build --core 0 --out reports/heavy`.
