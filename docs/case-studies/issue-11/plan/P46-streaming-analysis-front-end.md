---
id: P46
title: Streaming analysis front end
type: Feature
milestone: M4
blocked_by: []
requirements: [R6, R7, R12, R13, R18]
---

## Goal

One module turns sound into analysis frames: 200 frames per second, each with
energy, spectrum shape, linear prediction and noise measures. It works on a
whole recording and on a live stream, with the same numbers in both cases.
Every later recognition stage ({{P47}} to {{P55}}) reads these frames and
nothing else computes spectra again.

## Why

Recognition is the simulator run in reverse. The simulator is driven by control
frames at 200 Hz (`CONTROL_RATE` in `src/articulation/plan.js`), so the
analysis must give one frame per control frame. Today each analysis function
resamples, windows and transforms the sound on its own, only for a whole
recording, and too slowly for live use on one core.

## Current state

- `src/analysis/voice-features.js` (`analyzeVoice`) works on a whole recording
  at 11025 Hz or less (`ANALYSIS_RATE`), with a 40 ms window and a 10 ms hop. It
  returns only statistics of the recording (median pitch, mean formants, ...),
  no frames. It has its own `resample()` (two biquads and linear
  interpolation).
- `src/acoustics/analysis.js` has `lpcCoefficients(frame, order)`
  (autocorrelation method), `lpcEnvelope`, `estimateFormants`, `spectralTilt`
  and `harmonicLevel`. All spectra are direct sums over sines and cosines.
- `grep -rni "fft" src` prints nothing: there is no fast Fourier transform, no
  mel filter bank, no cepstrum, no noise tracker and no voice activity detector.
- `src/audio/resample.js` has a good `resample(samples, fromRate, toRate)`
  (windowed sinc, `zeroCrossings = 16`), but only for a whole array.
- Cost today, from `experiments/issue-11-audit-m4a.txt` (one core):
  `analyzeVoice cost: {"seconds":4.69,"realTimeFactor":0.096}`, that is 9.6 %
  of real time for statistics only.

## What to do

Create `src/recognition/fft.js`, `src/recognition/lpc.js` and
`src/recognition/frontend.js`. Export the public names from `src/index.js`.

1. `createFft(size)` in `fft.js`: `size` is a power of two from 2 to 65536,
   otherwise throw `RangeError`. It returns an object with `size`,
   `forward(re, im)` and `inverse(re, im)`. Both work in place on two
   `Float64Array`s (iterative radix-2, tables of sines, cosines and
   bit-reversed indexes made once).
   `inverse` divides by `size`. There must be one transform in `src/`: if
   `src/metrics/spectrum.js` of {{P06}} exists, make its `fft(re, im)` call
   `createFft` (keep one plan per size in a `Map`).
2. `lpc.js`: three functions `lpcBurg`, `lpcAutocorrelation` and
   `lpcCovariance` with arguments `(x, order, a, k)`. `x` is the frame, `a` and
   `k` are output arrays of length `order`: predictor coefficients `a[1..p]` of
   `A(z) = 1 + sum_i a[i] z^-i` and reflection coefficients `k[1..p]`. They
   return the residual power `E` (mean squared prediction error).
   - Burg (default): start with `f[n] = b[n] = x[n]`, `E = mean(x^2)`. For
     `m = 1..p`:
     `k[m] = -2 * S1 / S2`, `S1 = sum_{n=m..N-1} f[n] * b[n-1]`,
     `S2 = sum_{n=m..N-1} (f[n]^2 + b[n-1]^2)`; then for the same `n`, with
     the old values on the right:
     `f[n] = f[n] + k[m] * b[n-1]` and `b[n] = b[n-1] + k[m] * f[n]`; then the
     step-up `a_new[i] = a[i] + k[m] * a[m-i]` for `i = 1..m-1`,
     `a_new[m] = k[m]`, and `E = E * (1 - k[m]^2)`.
   - Autocorrelation: Levinson-Durbin on `r[i] = sum_n x[n] * x[n+i]`.
   - Covariance: solve `sum_j a[j] * phi(i, j) = -phi(i, 0)` with
     `phi(i, j) = sum_{n=p..N-1} x[n-i] * x[n-j]` by Cholesky after adding
     `1e-9 * phi(0, 0)` to the diagonal; get `k` by the step-down recursion; if
     Cholesky fails or some `|k[m]| >= 1`, return the Burg result.
   - Also export `predictorFromReflection(k, order, a)` (the step-up alone) and
     `lpcLevel(a, order, E, frequency, rate)` =
     `10 * log10(E / |A(e^{j 2 pi frequency / rate})|^2)`.
3. `createResampler(fromRate, toRate, options)` in `src/audio/resample.js`:
   `push(chunk)` returns the new output samples, `flush()` the rest. It keeps
   the last `zeroCrossings / min(1, toRate / fromRate)` input samples. The
   joined output must equal `resample()` of the joined input within `1e-6`.
4. Working rate `rate`: `options.rate`, or else the largest of 8000, 11025 and
   16000 that is not above `sampleRate`. Throw `RangeError` when `sampleRate`
   is below 8000 or `options.rate` is above `sampleRate`. Never up-sample.
5. Defaults, exported as `FRONTEND_DEFAULTS`: `window: 0.025` s, `hop: 0.005`
   s (`0.01` is also allowed), `preEmphasis: 0.97`, `lpc: 'burg'`,
   `order: round(rate / 1000) + 2` (18, 13, 10), `melBands: 24`,
   `cepstra: 13`, `maxSeconds: 30`. Window length `N = round(window * rate)`
   (400, 276, 200); FFT size = next power of two not below `N` (512, 512, 256).
6. Frame `t` is centred on working sample `c = round(t * hop * rate)` and
   covers samples `c - N/2` to `c + N/2 - 1`; samples outside the signal are
   zero. Its time is `startTime + t * hop`. For each frame:
   1. `energy` = `10 * log10(mean(x^2) + 1e-10)` and `zcr` = sign changes
      divided by `N - 1`, both on the raw samples.
   2. Multiply by the Hann window `0.5 - 0.5 * cos(2 pi n / (N - 1))`, pad
      with zeros, transform; `P[k] = re^2 + im^2`, `k = 0..size/2`.
   3. `gravity` = `sum f_k P[k] / sum P[k]` over `k >= 1` (Hz). `tilt` = power
      in 50 to 1000 Hz over power in 1000 to 3800 Hz, in dB. `band[0..5]` =
      power in dB in 0-400, 800-1500, 1200-2000, 2000-3500, 3500-5000 and
      5000-8000 Hz (Liu 1996); cut edges at `rate / 2`; a band that starts
      at or above `rate / 2` gets -100.
   4. `periodicity`: inverse transform of `P` gives the autocorrelation `r`.
      Value = largest `r[l] / (r[0] * w[l])` for lags `l` from `rate / 400`
      to `rate / 70`, limited to 0..1; `w` is the autocorrelation of the
      window with `w[0] = 1` (Boersma 1993).
   5. `mel[m]` = `ln(max(sum_k W_m[k] * P[k] * G[k], 1e-10))` with
      `G[k] = 1 + q^2 - 2 q cos(2 pi k / size)`, `q = preEmphasis`, and
      triangular filters `W_m` with centres equally spaced in
      `mel(f) = 2595 * log10(1 + f / 700)` from 60 Hz to
      `min(rate / 2, 7600)` Hz. `cepstrum[n]` =
      `sqrt(2 / M) * sum_m mel[m] * cos(pi * n * (m - 0.5) / M)`, `n = 0..12`,
      `m = 1..M` (the formula of {{P06}}).
   6. Pre-emphasise the raw frame (`y[n] = x[n] - q * x[n-1]`), multiply by
      the window, run the chosen LPC: `lpc` (`a`), `reflection` (`k`), `gain`
      = `10 * log10(E + 1e-10)`.
   7. Noise floor by minimum statistics (Martin 2001), on linear power `p`:
      `s[t] = g * s[t-1] + (1 - g) * p[t]`, `g = exp(-hop / 0.05)`; `noise[t]`
      = `10 * log10(min of s over the last 1.5 s) + 1.5`, but never above the
      highest `energy` so far minus 25. Keep the minimum of ten blocks of
      0.15 s, not all values.
   8. `speech[t]` = 1 when `energy - noise >= 9`, or when
      `energy - noise >= 4` and `periodicity >= 0.6`; after a frame with 1 the
      next 8 frames (at 5 ms hop) are also 1.
7. Frame set (the only data layout later stages may read; all arrays are
   `Float32Array` except `speech`, a `Uint8Array`; a matrix is stored row by
   row, row `t` starts at `t * width`):
   `rate`, `hop`, `window`, `size`, `order`, `melBands`, `cepstra`, `capacity`,
   `count`, `startTime`, `samples`, `sampleCount`, `energy`, `zcr`, `tilt`,
   `gravity`, `periodicity`, `noise`, `gain`, `speech`, `lpc`, `reflection`,
   `mel`, `cepstrum`, `band`. Widths: `lpc` and `reflection` `order`, `mel`
   `melBands`, `cepstrum` `cepstra`, `band` 6, the others 1.
   `capacity = ceil(maxSeconds / hop)` rows are allocated once; `count` rows are
   valid. `samples` holds the working-rate sound that starts at `startTime`.
   Flat arrays of 32-bit floats are chosen so that the Rust port ({{P65}}) can
   fill the same memory.
8. `createFrameAnalyzer(sampleRate, options)` returns an object with `frames`,
   `push(chunk)`, `flush()`, `trim(count)` and `reset()`. `push` takes a
   `Float32Array` of any length and returns how many frames it added; frame `t`
   is added as soon as sample `c + N/2 - 1` exists. `flush()` adds the frames
   that need zeros at the end (`count` becomes
   `floor((sampleCount - 1) / (hop * rate)) + 1`). `trim(n)` drops the first `n`
   frames and their samples, moves the rest to the front and adds `n * hop` to
   `startTime`; the noise tracker keeps its state.
   `push` throws `RangeError` when the set is full. No memory may be allocated
   per frame.
9. `analyzeFrames(samples, sampleRate, options)` = analyzer with
   `maxSeconds` set to the length of the input, one `push`, `flush()`, return
   `frames`.
10. Stage pattern for {{P47}} to {{P54}}: a stage is created with
    `createX(frames, options)` and has `advance(final = false)`, which
    processes the frames added since the last call, and an output object whose
    arrays have `frames.capacity` rows and a field `committed` (rows before it
    never change). After `trim()` a stage object is invalid; create a new one.

Budget (reference machine: GitHub runner `ubuntu-24.04`, one thread): at most
5 % of real time at 16000 Hz and 3 % at 8000 Hz; added delay at most 20 ms.

## Tests

New file `tests/recognition-frontend.test.js`:

- `transforms like a direct sum`: 64 seeded random values; `forward` equals
  the direct Fourier sum within `1e-9`; `inverse(forward(x))` equals `x`.
- `recovers a known predictor`: 4000 samples of
  `x[n] = 1.3 x[n-1] - 0.8 x[n-2] + e[n]` (seeded noise `e`); each method with
  order 2 gives `a` within 0.05 of `[-1.3, 0.8]`.
- `measures a sine`: 1000 Hz, amplitude 1, 16000 Hz: `energy` within 0.1 of
  -3.01; `gravity` within 20 Hz of 1000; `zcr` within 0.01 of 0.125.
- `gives the same frames for a stream`: `synthesize('Hello world.')` at 16000
  Hz pushed in chunks of 1, 7, 160 and 1024 samples in turn equals
  `analyzeFrames` within `1e-6` in every array; the same at 44100 Hz input.
- `works at 8000 Hz`: `count` follows the formula, no value is `NaN`, widths
  are 10, 24, 13 and 6.
- `finds speech between pauses`: the sentence with 0.5 s of seeded noise at
  -50 dB before and after: `speech` is 0 in at least 95 % of the noise frames
  after the first 0.3 s and 1 in at least 90 % of the frames inside vowel
  segments of `plan.segments`.
- `tracks the noise floor`: 3 s of seeded white noise; after 2 s `noise` is
  within 3 dB of the mean `energy`.
- `keeps frames after trim`: rows after `trim(40)` equal the old rows 40 and
  up.
- `stays within the CPU budget`: 10 s of speech; prints `frontend rtf <x>`;
  fails above 0.2 (four times the budget, because shared runners are noisy).

## Acceptance criteria

- [ ] `grep -rn "createFft" src` shows one implementation, used by the front
      end (and by `src/metrics/spectrum.js` if that file exists).
- [ ] `node --test tests/recognition-frontend.test.js` passes on Node.js, Bun
      and Deno.
- [ ] The CI log of `stays within the CPU budget` shows at most 0.05 at 16000
      Hz and at most 0.03 at 8000 Hz.
- [ ] Stream and batch frames differ by at most `1e-6` (test above).
- [ ] `analyzeFrames`, `createFrameAnalyzer`, `createFft`, `createResampler`
      and `FRONTEND_DEFAULTS` are exported and typed in `src/index.d.ts`.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- Pitch, formants, source and landmarks: {{P47}}, {{P48}}, {{P49}}, {{P50}}.
- Changing `analyzeVoice` to use the frames: {{P51}}.
- Noise reduction of the sound itself, echo and several speakers.
- The Rust port and threads: {{P65}}.

## References

- Makhoul, J. (1975). Linear prediction: a tutorial review. Proc. IEEE 63(4),
  561-580. doi:10.1109/proc.1975.9792
- Markel, J. D., Gray, A. H. (1976). Linear Prediction of Speech. Springer.
  doi:10.1007/978-3-642-66286-7
- Atal, B. S., Hanauer, S. L. (1971). Speech analysis and synthesis by linear
  prediction of the speech wave. JASA 50(2B), 637-655. doi:10.1121/1.1912679
- Davis, S., Mermelstein, P. (1980). Comparison of parametric representations
  for monosyllabic word recognition. IEEE Trans. ASSP 28(4).
  doi:10.1109/tassp.1980.1163420
- Boersma, P. (1993). Accurate short-term analysis of the fundamental
  frequency and the harmonics-to-noise ratio of a sampled sound. Proc.
  Institute of Phonetic Sciences 17, 97-110.
- Martin, R. (2001). Noise power spectral density estimation based on optimal
  smoothing and minimum statistics. IEEE Trans. Speech and Audio Processing
  9(5), 504-512.
- Liu, S. A. (1996). Landmark detection for distinctive feature-based speech
  recognition. JASA 100(5), 3417-3430. doi:10.1121/1.416983
- Research notes:
  `docs/case-studies/issue-11/research/2-inversion-and-recognition.md`.
