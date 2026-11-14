---
id: P49
title: Glottal inverse filtering and source parameters
type: Feature
milestone: M4
blocked_by: [P46]
requirements: [R6, R9, R12, R13, R18]
---

## Goal

`inverseFilter` removes the effect of the mouth and throat from a recording
and gives an estimate of the air flow at the vocal folds. From it and from the
spectrum it measures how the voice is made: the shape parameter `Rd` of the
simulator's own pulse model, the open quotient, the amplitude quotient,
H1-H2, the cepstral peak prominence and the harmonics-to-noise ratio.

## Why

The simulator builds a voice from a source (`Glottis` in
`src/acoustics/glottis.js`) and a tract. To copy a voice ({{P51}}) and to
recognise how something is said (soft, pressed, breathy: {{P59}}), the two
parts must be separated again. The source parameters we measure must be the
ones the simulator has, so that a measured value can be put straight back.

## Current state

- The source is an LF pulse with one shape parameter. `lfParameters(tenseness)`
  sets `rd = min(2.7, max(0.5, 3 * (1 - tenseness)))` and from it
  `ra = -0.01 + 0.048 * rd`, `rk = 0.224 + 0.118 * rd`, and `rg`;
  `lfWaveform(p, t)` gives the flow derivative at phase `t` from 0 to 1.
- `analyzeVoice` (`src/analysis/voice-features.js`) measures only two source
  values, on the speech signal itself and for the whole recording: `h1h2`
  (levels of the first two harmonics by `harmonicLevel`, with no correction
  for the formants) and `hnr` (from the YIN aperiodicity).
- There is no inverse filtering, no glottal closure instants, no `Rd`, no
  open quotient, no cepstral peak prominence.
- The two existing values do not see the parameter they should see. From
  `experiments/issue-11-audit.txt` (`breathiness` 0, 0.5, 1):

  ```
  breathiness 0: {"hnr":15.19,"h1h2":3.43}
  breathiness 0.5: {"hnr":15.1,"h1h2":3.46}
  breathiness 1: {"hnr":14.59,"h1h2":3.46}
  ```

  That bug is in the source and is fixed by {{P20}}; this issue makes the
  measuring side exact.

## What to do

Create `src/recognition/inverse-filter.js`. Symbols: `rate` = `frames.rate`,
`T` = `1 / f0` (s), `x` = `frames.samples`.

1. Options (`INVERSE_FILTER_DEFAULTS`): `pitch: null`, `tractOrder` =
   `2 * round(rate / 2000) + 4` (20 at 16000 Hz, 12 at 8000 Hz),
   `glottisOrder: 2 * round(rate / 4000)` (8 and 4), `leak: 0.99`,
   `step: 0.01` s, `minF0: 60`, `maxF0: 400`.
2. Pitch per frame. If `options.pitch` is given (a track of {{P47}}), use its
   `f0`. Otherwise use a simple local estimate: lag of the largest value of
   the window-corrected autocorrelation of the frame (the formula of
   `periodicity` in {{P46}}) between `rate / maxF0` and `rate / minF0`;
   voiced when `frames.speech` is 1 and `frames.periodicity >= 0.5`; then a
   median over 5 frames. Unvoiced frames are skipped everywhere below.
3. High-pass `x` with a first-order filter at 50 Hz, forward and backward
   (zero phase): `y[n] = x[n] - x[n-1] + r * y[n-1]`,
   `r = 1 - 2 * pi * 50 / rate`.
4. Iterative adaptive inverse filtering (Alku 1992), for an analysis block of
   length `max(0.032, 2.5 * T)` s every `step` seconds, Hann window `w`,
   `lpcAutocorrelation` of {{P46}}; "filter `s` with `A`" means
   `out[n] = s[n] + sum_i a[i] * s[n-i]`; "integrate" means
   `out[n] = in[n] + leak * out[n-1]`:
   1. `A1` = LPC of order 1 of `w * s` (`s` = high-passed block). `u1` = `s`
      filtered with `A1` (removes the average tilt of the source).
   2. `V1` = LPC of order `tractOrder` of `w * u1`. `g1` = `s` filtered with
      `V1`, then integrated (first estimate of the flow).
   3. `A2` = LPC of order `glottisOrder` of `w * g1`. `u2` = `s` filtered
      with `A2`, then integrated.
   4. `V2` = LPC of order `tractOrder` of `w * u2`. `d` = `s` filtered with
      `V2` (flow derivative). `g` = `d` integrated (flow).
   5. Add `w * d` and `w * g` into the output arrays and `w` into a weight
      array; at the end divide by the weight where it is above 0.01.
5. Closure instants. In every run of voiced frames: find the most negative
   sample of the flow derivative within the middle 30 ms; from there step
   forward and backward by `T`, each time taking the most negative sample
   within `0.3 * T` of the expected place. Store the times in `gci`
   (`Float64Array`, seconds).
6. Measures of frame `t` (use the two periods around the frame centre):
   - `naq` = `f / (dPeak * T)`: `f` = largest minus smallest flow in the
     period, `dPeak` = size of the most negative flow derivative times
     `rate` (Alku, Bäckström, Vilkman 2002).
   - `h1h2`: `harmonicLevel(x, rate, f0)` minus `harmonicLevel(x, rate, 2 * f0)`
     in dB on the speech; `h1h2Source`: the same on the flow derivative.
   - `rd`: let `H[k]` = level in dB of harmonic `k` of the flow derivative,
     `k = 1..K`, `K = min(10, floor(0.45 * rate / f0))`. For each `tenseness`
     from 0.10 to 0.84 in steps of 0.02 make a table `M[k]` once: 256 values
     of `lfWaveform(lfParameters(tenseness), i / 256)`, transform, level of
     bins 1 to 10 in dB. Error = root of the mean over `k` of
     `((H[k] - mean H) - (M[k] - mean M))^2`. Take the `tenseness` with the
     smallest error; `rd[t] = 3 * (1 - tenseness)`, `fit[t]` = that error.
   - `oq` = `min(1, te + ta)` of the pulse found. `lfParameters` returns
     `te` already; add its local `ta` to the object it returns.
   - `hnr` = `10 * log10(r / (1 - r))`, `r` = window-corrected
     autocorrelation at lag `T` over a Hann window of `6 * T` on the speech,
     limited to 0.001..0.999 (Boersma 1993).
   - `cpp`: 40 ms of speech, Hann window, FFT of the next power of two;
     `S[k] = 10 * log10(P[k] + 1e-12)`; `C` = real part of the inverse
     transform of `S`; quefrency of index `q` is `q / rate`. Fit a straight
     line to `C` from 1 ms to `1 / minF0`; `cpp` = largest `C` between
     `1 / maxF0` and `1 / minF0` minus the line at that place (Hillenbrand,
     Cleveland, Erickson 1994). The scale depends on this definition, so
     compare `cpp` only with values of this function.
7. Reliability. `reliable[t]` = 1 when the frame is voiced, `f0 <= maxF0`,
   and `fit[t] <= 6` dB. `lowBand` = false when, over the voiced frames, the
   mean of `frames.mel` for the filters below 250 Hz is more than 20 dB
   (4.6 in natural log units) below the mean for 300 to 1000 Hz: the
   recording has no fundamental (telephone line). Then `rd`, `oq`, `naq` and
   both H1-H2 values are set to `NaN` and only `hnr` and `cpp` are given.
8. Result: an object with `hop`, `startTime`, `count`, `rate`, `flow` and
   `flowDerivative` (`Float32Array`, one value per working-rate sample),
   `gci`, the per-frame `Float32Array`s `f0`, `rd`, `fit`, `oq`, `naq`,
   `h1h2`, `h1h2Source`, `hnr`, `cpp`, the `Uint8Array` `reliable`,
   `lowBand`, and `summary`: for each measure `{median, low, high, frames}`
   (50th, 25th and 75th percentile over reliable frames).
9. Exports: `inverseFilter(frames, options)`, `INVERSE_FILTER_DEFAULTS`,
   `rdToTenseness(rd) = 1 - rd / 3` and `lfHarmonics(tenseness)` (the table
   of step 6). No streaming object: the caller ({{P51}}, {{P59}}, {{P66}})
   runs it on finished stretches of speech.

Budget on the reference machine of {{P46}}: at most 10 % of real time at
16000 Hz. This stage is not on the path of the first recognition result.

## Tests

New file `tests/recognition-inverse-filter.test.js`. Test signal
`sourceVowel(tenseness, f0, rate)`: 1.5 s from
`new Glottis({seed: 1, tenseness, breathiness: 0, jitter: 0, shimmer: 0})`,
`step(1 / rate, {f0, voicing: 1, aspiration: 0, closure: 0, loudness: 1}, 0)`,
then three two-pole resonators in series (500, 1500, 2500 Hz; bandwidths 60,
90, 120 Hz). The source samples are kept as truth.

- `returns the pulse of a known source`: tenseness 0.5, f0 110, 16000 Hz:
  correlation of `flowDerivative` with the truth (after the best shift of up
  to 2 ms) at least 0.9; at 8000 Hz at least 0.8.
- `orders Rd like the source`: tenseness 0.3, 0.5, 0.7 at f0 110 and 220:
  median `rd` falls each time (true values 2.1, 1.5, 0.9) and each is within
  0.4 of the truth.
- `finds closure instants`: f0 110: at least 95 % of periods have exactly one
  instant; at least 80 % lie within 0.25 ms of the most negative truth
  sample.
- `measures a known noise level`: five harmonics of 150 Hz plus seeded white
  noise 20 dB below: median `hnr` within 3 dB of 20.
- `sees added noise in the cepstral peak`: `cpp` of the clean vowel is at
  least 4 dB above `cpp` of the same vowel with noise 5 dB below it.
- `flags a telephone band`: the vowel high-passed at 300 Hz: `lowBand` is
  false, `rd` is `NaN`, `hnr` is a number.
- `works on synthetic speech`: `synthesize('Hello world.')` for the presets
  male and female at 16000 and 8000 Hz: no exception, at least 60 % of
  voiced frames reliable at 16000 Hz.
- `stays within the CPU budget`: prints `inverse filter rtf <x>`; fails
  above 0.4.

## Acceptance criteria

- [ ] `node --test tests/recognition-inverse-filter.test.js` passes on
      Node.js, Bun and Deno.
- [ ] Targets, printed by the test `orders Rd like the source`: median `rd`
      within 0.25 of the truth for all six signals. If missed, the measured
      errors are written into the pull request.
- [ ] After {{P20}} is merged: `experiments/issue-11-audit.mjs` gets a line
      per `breathiness` with median `hnr` and `cpp` of this function, and
      both fall when `breathiness` rises from 0 to 1.
- [ ] The CI log of `stays within the CPU budget` shows at most 0.10.
- [ ] `inverseFilter`, `INVERSE_FILTER_DEFAULTS`, `rdToTenseness` and
      `lfHarmonics` are exported and typed.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- Fitting the parameters of the physical fold model of {{P21}} (it is done
  in {{P51}} by analysis-by-synthesis, with these measures as the target).
- Closed-phase methods (Wong, Markel, Gray 1979; Airaksinen et al. 2014).
  They can be added later behind an option if the tests on real speech show
  that step 4 is the weak point.
- Naming the voice quality (breathy, creaky, pressed): {{P59}}.
- Whispered speech: {{P60}}.

## References

- Alku, P. (1992). Glottal wave analysis with pitch synchronous iterative
  adaptive inverse filtering. Speech Communication 11(2-3), 109-118.
  doi:10.1016/0167-6393(92)90005-r
- Alku, P., Bäckström, T., Vilkman, E. (2002). Normalized amplitude quotient
  for parametrization of the glottal flow. JASA 112(2), 701-710.
  doi:10.1121/1.1490365
- Fant, G. (1997). The voice source in connected speech. Speech
  Communication 22(2-3), 125-139. doi:10.1016/S0167-6393(97)00017-4
- Hillenbrand, J., Cleveland, R. A., Erickson, R. L. (1994). Acoustic
  correlates of breathy vocal quality. JSHR 37(4), 769-778.
  doi:10.1044/jshr.3704.769
- Hanson, H. M. (1997). Glottal characteristics of female speakers: acoustic
  correlates. JASA 101(1), 466-481. doi:10.1121/1.417991
- Drugman, T., Thomas, M., Gudnason, J., Naylor, P., Dutoit, T. (2012).
  Detection of glottal closure instants from speech signals: a quantitative
  review. IEEE Trans. ASLP 20(3). doi:10.1109/tasl.2011.2170835
- Degottex, G., Kane, J., Drugman, T., Raitio, T., Scherer, S. (2014).
  COVAREP: a collaborative voice analysis repository for speech
  technologies. ICASSP. doi:10.1109/icassp.2014.6853739 (the filter orders
  of step 1 are the defaults of its IAIF function).
- Boersma, P. (1993). Accurate short-term analysis of the fundamental
  frequency and the harmonics-to-noise ratio of a sampled sound. Proc.
  Institute of Phonetic Sciences 17, 97-110.
- Research notes:
  `docs/case-studies/issue-11/research/2-inversion-and-recognition.md`.
