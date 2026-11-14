---
id: P48
title: Formant tracker
type: Feature
milestone: M4
blocked_by: [P46, P06, P05]
requirements: [R6, R9, R12, R13, R18]
---

## Goal

`trackFormants` gives, for every analysis frame, the frequencies and
bandwidths of the first four resonances of the mouth and throat (three at
8000 Hz), with a variance that says how sure each value is. The tracks are
continuous in time and stay on the right resonance.

## Why

Formants are what the shape of the vocal tract leaves in the sound. The voice
fit ({{P51}}) reads the length of the tract from them, and the inversion
({{P53}}) uses them to choose shapes from the codebook. A formant that jumps
to a neighbour, or that is missing, becomes a wrong tongue position.

## Current state

- `estimateFormants` in `src/acoustics/analysis.js` works on one stretch of
  sound: integer decimation, pre-emphasis 0.94, Hamming window, one LPC
  polynomial, then the peaks of the LPC envelope on a 5 Hz grid above 150 Hz.
  It gives no bandwidths. Two close resonances that make one peak count as
  one formant, and every later formant then gets the wrong number.
- `analyzeVoice` (`src/analysis/voice-features.js`) calls it on at most 300
  frames and returns one value per formant per recording: no track over time.
- Measured by `node experiments/issue-11-audit-m4a.mjs` on ten long vowels
  (`i e ɛ a ɑ ɔ o u ə y`) per preset, against `tubeFormants` of the planned
  tract shape (output in `experiments/issue-11-audit-m4a.txt`):

  ```
  formants male@16000: {"f0":107,"meanErrorPercent":[7.8,6,3.5],"over10Percent":[2,0,0],"missing":0,"worst":{"vowel":"ɔ","error":0.15,"formant":1,"truth":744,"measured":630}}
  formants female@16000: {"f0":194,"meanErrorPercent":[8.1,6.6,8.5],"over10Percent":[3,1,1],"missing":0,"worst":{"vowel":"o","error":0.37,"formant":3,"truth":3034,"measured":1900}}
  formants child@8000: {"f0":213,"meanErrorPercent":[8.4,6.5,9],"over10Percent":[4,1,1],"missing":1,"worst":{"vowel":"o","error":0.4,"formant":3,"truth":3223,"measured":1935}}
  ```

  The mean error is 7 to 10 % for F1 and up to 9 % for F3; the worst cases
  (37 and 40 %) are a neighbour taken for F3. Part of the F1 error may be a
  real difference between `tubeFormants` and the renderer; see step 9.

## What to do

Create `src/recognition/formants.js`. It follows the stage pattern of {{P46}}
and reads `frames.reflection`, `frames.gain`, `frames.speech` and
`frames.rate`. Symbols: `p` = `frames.order`, `K` = number of formants (4, or
3 when `rate` is 8000), `c` = 35000 cm/s (`SPEED_OF_SOUND`), `L` = length of
the vocal tract in cm.

1. Options (`FORMANT_DEFAULTS`): `vocalTractLength: null` (estimate it),
   `pitch: null` (a track of {{P47}}; used only in step 6), `lag: 10` frames,
   `maxBandwidth: 700` Hz, `keep: 12` states.
2. Candidates of frame `t`, for each of the orders `p`, `p - 2` and `p - 4`:
   1. Take the first `m` reflection coefficients of the frame and get the
      polynomial `A(z)` of order `m` with `predictorFromReflection`. (For the
      Burg and the autocorrelation method this is the model of order `m`.)
   2. Find the `m` roots of `z^m + a[1] z^(m-1) + ... + a[m]` with the
      Aberth-Ehrlich iteration. For root `i` with value `z_i`:

      ```
      n_i = P(z_i) / P'(z_i)
      z_i = z_i - n_i / (1 - n_i * sum_{j != i} 1 / (z_i - z_j))
      ```

      Start from the roots of the frame before; in the first frame from
      `0.9 * exp(j * (2 * pi * (i + 0.5) / m + 0.1))`. Stop when every
      step is below `1e-6`, or after 40 rounds. If a value is not finite,
      start again from the first-frame values once.

   3. For each root with positive angle: `f = angle * rate / (2 * pi)`,
      `B = -ln(|z|) * rate / pi`. Keep it when `f > 90`,
      `f < rate / 2 - 50`, `f < 5500 * 16.5 / L` and `B < maxBandwidth`.
      This drops the poles that model the tilt of the source.
   4. Use the candidates of order `p`. Add a candidate of a lower order only
      if no kept candidate lies within 150 Hz of it. Keep at most 7, lowest
      bandwidth first, then sort by frequency.

3. Reference frequencies: `ref[k] = (2 * k - 1) * c / (4 * L)` for
   `k = 1..K` (a uniform tube closed at one end). With `L = 16.5` this is
   530, 1591, 2652 and 3712 Hz.
4. States of frame `t`: every way to give the `K` formant numbers to
   candidates in rising order, where a number may also stay empty. Local cost
   of a state = sum over `k` of

   ```
   |f - ref[k]| / 1000 + B / f      (formant k has candidate f, B)
   1.5                              (formant k is empty)
   ```

   Keep the `keep` cheapest states. Transition cost from a state of frame
   `t - 1` = sum over `k` of `|log2(f_t / f_(t-1))|` where both have formant
   `k`, and 0.3 where exactly one has it. Find the cheapest path as in
   {{P47}} (Viterbi), and fix frame `t` when frame `t + lag` is scored. Reset
   the path at every run of 20 or more frames with `speech` 0. (Local cost
   plus transition cost of this form is what the Praat program uses for its
   formant tracks.)

5. Length of the tract. For a frame with F1 to F3 chosen:

   ```
   dF = sum_k F[k] * (2k - 1) / 2  /  sum_k ((2k - 1) / 2)^2     (k = 1..3)
   L  = c / (2 * dF)
   ```

   - Batch, when `vocalTractLength` is `null`: run steps 2 to 4 with
     `L = 16.5`, take the median `L` over the chosen frames, limit it to 10
     to 20 cm, and if it differs from 16.5 by more than 5 % run steps 3 and
     4 once more with the new `L`.
   - Stream: start with 16.5 and after every 20 committed frames move `L`
     by 10 % of the difference towards the median so far. Committed frames
     never change.

6. Smoothing, one Kalman filter per formant `k` over the chosen candidates:
   state `x` (Hz), model `x[t] = x[t-1] + w`, `w` with standard deviation
   `q` = 30 Hz for F1 and 60 Hz for the others (per 5 ms; multiply by
   `sqrt(hop / 0.005)`). Observation variance
   `R = (B / 2)^2 + 50^2 + h`, with `h = (f0 / 4)^2` when the pitch track is
   given and `f0 > 200` Hz, else 0 (the harmonics are then far apart and LPC
   is pulled towards them). A frame without a candidate for `k` has no
   update, so the variance grows by `q^2`. After the forward pass run the
   Rauch-Tung-Striebel backward pass over the last `lag` frames (stream) or
   over the whole run (batch). When a formant is empty for more than 100 ms,
   mark it invalid from there on until a new candidate comes.
7. Output `track`, an object with the fields `hop`, `startTime`, `count`,
   `committed`, `formants`, `vocalTractLength`, `frequency`, `bandwidth`,
   `variance`, `level`, `valid` and `nasal`. `formants` is `K`. `frequency`
   (Hz), `bandwidth` (Hz), `variance` (Hz squared) and `level` (dB, `lpcLevel`
   at the frequency) are `Float32Array` matrices with 4 columns per frame; the
   fourth column is `NaN` when `K` is 3, and a column is `NaN` where the formant
   is not valid. `valid` is a `Uint8Array` with 4 columns, `nasal` a
   `Uint8Array` with one value.
8. `nasal[t]` = 1 when the lowest candidate is below `0.6 * ref[1]`, its
   bandwidth is below 200 Hz, and `frames.band[1] - frames.band[0]` (800 to
   1500 Hz against 0 to 400 Hz) is below `NASAL_BAND_DROP` dB. Find
   `NASAL_BAND_DROP` on simulator output: render `ama`, `ana`, `aŋa`,
   `imi`, `unu` for three presets; choose the value with the most correct
   frames against `plan.segments`; write it and the share into the file as
   a comment. For frames with `nasal` 1 multiply the variance by 4.
9. Extend `experiments/issue-11-audit-m4a.mjs` with two blocks. The first
   prints the same numbers for `trackFormants`. The second, named
   `renderer formants`, measures the resonances of the waveguide itself:
   render each vowel for 2 s with `head.pitch` 70 (the harmonics are then
   close together), take the median of each formant of `trackFormants` over
   all frames, and print the difference from `tubeFormants` in percent.
   Write all blocks to the `.txt` file.
10. Exports: `trackFormants` and `createFormantTracker` (arguments `frames`,
    `options`), `FORMANT_DEFAULTS`, `tractLengthFromFormants(f1, f2, f3)`.

Budget on the reference machine of {{P46}}: at most 6 % of real time at
16000 Hz. Decision delay in a stream: `lag * hop` = 50 ms.

## Tests

New file `tests/recognition-formants.test.js`. Truth for synthetic speech, in
`tests/helpers/recognition-truth.js`: `plannedFormants(plan, head, hop)` =
`tubeFormants(shape.areas, shape.length)` with
`shape = tractShape(sampleState(plan, t), head)` for every frame; frames with
`shape.velumArea > 0` or outside vowel segments are masked. Errors come from
`formantErrors` of {{P06}}.

- `finds the roots of a known filter`: white noise through three resonators
  (500, 1500, 2500 Hz; bandwidths 60, 90, 120 Hz) at 16000 Hz: frequencies
  within 2 %, bandwidths within 50 %.
- `tracks steady vowels`: the ten vowels of the audit, 0.5 s each, presets
  male, female and child, at 16000 and 8000 Hz: F1 to F3 valid in every
  masked-in frame; no error above 20 %; the mean error per formant is below
  the number of the same line in the audit output of today.
- `tracks moving vowels`: `aɪ`, `ɔɪ`, `ju`, `wi`: F2 changes by less than
  150 Hz between neighbouring frames; mean F2 error at most 8 %.
- `estimates the tract length`: heads with `vocalTractLength` 13, 16.5 and
  19: `track.vocalTractLength` within 8 %.
- `flags nasal murmurs`: `ama` and `ini`: at least 70 % of the frames inside
  the nasal are flagged, at most 10 % inside the vowels.
- `agrees between stream and batch`: with a fixed `vocalTractLength` the
  frequencies differ by at most 30 Hz in 99 % of valid frames.
- `stays within the CPU budget`: prints `formants rtf <x>`; fails above 0.24.

Heavy test `tests/heavy/recognition-formants.test.js` ({{P02}}) on the golden
set ({{P05}}): share of voiced speech frames with F1 to F3 valid; share of
frames where F2 jumps over 300 Hz. If the VTR database of hand-checked
formants (Deng et al. 2006) has a permitted licence, add it through {{P04}}
and report the error per formant; if not, say so.

## Acceptance criteria

- [ ] `node --test tests/recognition-formants.test.js` passes on Node.js, Bun
      and Deno.
- [ ] `experiments/issue-11-audit-m4a.txt` has the new blocks. Targets for
      `trackFormants` on steady vowels: mean error at most 5 % for F1 and 4 %
      for F2 and F3. If a target is missed, the pull request shows with the
      `renderer formants` block how much of the rest is the renderer.
- [ ] The CI log of `stays within the CPU budget` shows at most 0.06.
- [ ] `reports/heavy/recognition-formants.md` states, for the golden set, the
      share of valid frames (target 95 %) and of F2 jumps (target below 2 %):
      targets to be measured, not gates.
- [ ] `trackFormants`, `createFormantTracker`, `FORMANT_DEFAULTS` and
      `tractLengthFromFormants` are exported and typed.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- Zeros of nasal and lateral sounds as numbers; only the flag is given here.
- Voice fit and tongue positions from the tracks: {{P51}}, {{P53}}.
- Removing `estimateFormants`; it stays for the existing tests.

## References

- McCandless, S. (1974). An algorithm for automatic formant extraction using
  linear prediction spectra. IEEE Trans. ASSP 22(2), 135-141.
- Talkin, D. (1987). Speech formant trajectory estimation using dynamic
  programming with modulated transition costs. JASA 82(S1).
  doi:10.1121/1.2024869
- Deng, L., et al. (2006). A database of vocal tract resonance trajectories
  for research in speech processing. ICASSP. doi:10.1109/icassp.2006.1660034
- Deng, L., Lee, L. J., Attias, H., Acero, A. (2007). Adaptive Kalman
  filtering and smoothing for tracking vocal tract resonances. IEEE Trans.
  ASLP 15(1). doi:10.1109/tasl.2006.876724
- Mehta, D. D., Rudoy, D., Wolfe, P. J. (2012). Kalman-based autoregressive
  moving average modeling and inference for formant and antiformant
  tracking. JASA 132(3). doi:10.1121/1.4739462 (errors on the VTR database:
  114, 226 and 320 Hz for F1 to F3; Praat 185, 254 and 303 Hz).
- Praat manual, "Sound: To Formant (burg)...".
  https://www.fon.hum.uva.nl/praat/manual/Sound__To_Formant__burg____.html
- Research notes:
  `docs/case-studies/issue-11/research/2-inversion-and-recognition.md`.
