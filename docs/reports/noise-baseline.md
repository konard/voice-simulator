# Recognition in noise

Measured 2026-11-25 by
`node scripts/noise-baseline.mjs --languages en,ru,hi,zh --sentences 2 --snr 20,10,0 --tier telephone`
in 11.8 minutes (issue 170).

Each of the first 2 round-trip sentences per language
([tests/fixtures/roundtrip/sentences.json](../../tests/fixtures/roundtrip/sentences.json))
is synthesized at tier `telephone` (seed = sentence number), mixed with
`addNoise(samples, rate, { type, snr, seed })` and read by
`recognize(samples, rate, { languages: [lang], level: 'low', modes: false })`
with the default word decoder. The SNR is the RMS of the whole sentence over
the RMS of the noise. Cells are the mean WER (CER for Mandarin)
and the mean phone error rate (PER). Since issue 170 the streaming recognizer
commits the same words as `recognize()`, so these rates also describe the
app's live recognition.

## en (WER / PER)

| Noise | 20 dB | 10 dB | 0 dB |
| --- | --- | --- | --- |
| clean | 29.2% / 7.5% | 29.2% / 7.5% | 29.2% / 7.5% |
| white | 70.1% / 35.0% | 94.4% / 73.9% | 100.0% / 93.3% |
| pink | 52.8% / 25.4% | 93.8% / 62.7% | 100.0% / 94.8% |
| brown | 52.8% / 16.4% | 58.3% / 23.9% | 94.4% / 52.3% |
| blue | 81.3% / 38.0% | 100.0% / 55.1% | 100.0% / 82.1% |
| violet | 75.7% / 36.5% | 100.0% / 53.6% | 100.0% / 85.8% |
| speech-shaped | 64.6% / 27.7% | 81.9% / 75.4% | 100.0% / 91.0% |
| babble | 47.2% / 23.3% | 88.2% / 42.5% | 94.4% / 80.7% |
| hum | 41.0% / 15.8% | 63.9% / 21.0% | 70.1% / 41.7% |
| crackle | 69.4% / 28.2% | 81.9% / 61.1% | 93.8% / 85.0% |
| drifting | 70.1% / 28.3% | 87.5% / 50.8% | 100.0% / 90.4% |

## ru (WER / PER)

| Noise | 20 dB | 10 dB | 0 dB |
| --- | --- | --- | --- |
| clean | 63.3% / 11.9% | 63.3% / 11.9% | 63.3% / 11.9% |
| white | 131.7% / 58.8% | 126.7% / 89.8% | 116.7% / 85.9% |
| pink | 116.7% / 45.0% | 116.7% / 79.5% | 100.0% / 85.9% |
| brown | 91.7% / 23.9% | 106.7% / 41.8% | 131.7% / 70.4% |
| blue | 131.7% / 63.7% | 131.7% / 85.9% | 133.3% / 89.8% |
| violet | 141.7% / 75.9% | 158.3% / 78.5% | 105.0% / 89.8% |
| speech-shaped | 116.7% / 42.2% | 100.0% / 77.4% | 100.0% / 88.1% |
| babble | 96.7% / 27.7% | 126.7% / 74.9% | 100.0% / 93.6% |
| hum | 75.0% / 22.2% | 128.3% / 47.8% | 141.7% / 66.9% |
| crackle | 115.0% / 30.7% | 191.7% / 84.0% | 211.7% / 99.6% |
| drifting | 121.7% / 42.2% | 138.3% / 79.1% | 100.0% / 87.6% |

## hi (WER / PER)

| Noise | 20 dB | 10 dB | 0 dB |
| --- | --- | --- | --- |
| clean | 25.0% / 8.3% | 25.0% / 8.3% | 25.0% / 8.3% |
| white | 112.5% / 59.2% | 112.5% / 64.2% | 100.0% / 86.7% |
| pink | 87.5% / 50.8% | 100.0% / 82.5% | 100.0% / 74.2% |
| brown | 62.5% / 38.3% | 62.5% / 34.2% | 100.0% / 65.8% |
| blue | 137.5% / 88.3% | 125.0% / 85.0% | 100.0% / 86.7% |
| violet | 150.0% / 85.8% | 137.5% / 78.3% | 112.5% / 90.0% |
| speech-shaped | 100.0% / 44.2% | 100.0% / 82.5% | 100.0% / 85.0% |
| babble | 62.5% / 56.7% | 100.0% / 76.7% | 112.5% / 86.7% |
| hum | 62.5% / 37.5% | 50.0% / 29.2% | 75.0% / 48.3% |
| crackle | 62.5% / 41.7% | 100.0% / 95.0% | 125.0% / 109.2% |
| drifting | 100.0% / 47.5% | 112.5% / 75.8% | 100.0% / 70.8% |

## zh (CER / PER)

| Noise | 20 dB | 10 dB | 0 dB |
| --- | --- | --- | --- |
| clean | 0.0% / 0.0% | 0.0% / 0.0% | 0.0% / 0.0% |
| white | 51.2% / 32.0% | 93.8% / 71.9% | 100.0% / 76.4% |
| pink | 35.0% / 30.4% | 70.0% / 45.6% | 100.0% / 78.7% |
| brown | 22.5% / 16.8% | 22.5% / 16.8% | 38.8% / 20.6% |
| blue | 73.8% / 38.8% | 77.5% / 64.9% | 112.5% / 87.8% |
| violet | 63.7% / 31.1% | 57.5% / 40.4% | 100.0% / 83.2% |
| speech-shaped | 28.7% / 23.6% | 70.0% / 47.9% | 100.0% / 93.2% |
| babble | 52.5% / 26.7% | 58.8% / 32.2% | 100.0% / 91.6% |
| hum | 22.5% / 12.9% | 28.7% / 16.8% | 80.0% / 61.5% |
| crackle | 48.8% / 30.6% | 93.8% / 54.9% | 100.0% / 78.7% |
| drifting | 28.7% / 23.6% | 65.0% / 43.5% | 100.0% / 84.8% |

## Noise without speech

Three seconds of each noise at -40 dBFS, 16 kHz, all of the languages
en, ru, hi, zh, level `low`. The stream uses its default speech gate
(`minVoiced: 0.1`: a phrase needs 0.1 s of pitch-voiced speech);
"ungated" sets `minVoiced: 0`, the behaviour before issue 170. Batch
`recognize()` keeps no gate by default. `too-noisy` is the error of a
steady noise with too little energy contrast.

| Noise | Stream | Stream, ungated | Batch | Batch, `minVoiced: 0.1` |
| --- | --- | --- | --- | --- |
| white | error `too-noisy` | error `too-noisy` | error `too-noisy` | error `too-noisy` |
| pink | 0 chars | 3 chars | 1 char | 0 chars |
| brown | 0 chars | 2 chars | 2 chars | 0 chars |
| blue | error `too-noisy` | error `too-noisy` | error `too-noisy` | error `too-noisy` |
| violet | error `too-noisy` | error `too-noisy` | error `too-noisy` | error `too-noisy` |
| speech-shaped | error `too-noisy` | 2 chars, then `too-noisy` | error `too-noisy` | error `too-noisy` |
| babble | 0 chars | 2 chars | 2 chars | 0 chars |
| hum | error `too-noisy` | error `too-noisy` | error `too-noisy` | error `too-noisy` |
| crackle | 0 chars | 12 chars | 12 chars | 0 chars |
| drifting | 0 chars | 4 chars | 2 chars | 0 chars |

Recognition is trained on the simulator's own speech only (see
[RECOGNIZER.md](../RECOGNIZER.md)); these figures are a synthetic
baseline, not the accuracy for real voices.
