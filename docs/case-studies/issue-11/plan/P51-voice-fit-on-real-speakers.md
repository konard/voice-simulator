---
id: P51
title: Voice configuration fit on real speakers (pass 1)
type: Feature
milestone: M4
blocked_by: [P47, P48, P49, P05, P20]
requirements: [R6, R8, R9, R12, R13, R18, R19]
---

## Goal

`fitVoice(samples, sampleRate, options)` listens to a recording of one
person and returns the head configuration of the simulator that sounds like
that person, with an uncertainty for every fitted parameter. It works with
and without the text that was spoken, on real speakers, at 8000 Hz, and it
can be continued when more sound arrives. `matchVoice` stays and calls it.

## Why

This is the first pass of the multi-pass algorithm of the issue: "first try
to fit best simulation settings to copy the voice". The second pass
({{P53}}) asks which tongue positions explain the sound, and that question
only has a good answer when the tube already has the length, the source and
the pitch range of the speaker.

## Current state

- `matchVoice` and `matchVoiceSteps` in `src/analysis/voice-match.js` fit six
  parameters: `pitch`, `pitchRange`, `vocalTractLength`, `tenseness`,
  `breathiness`, `speechRate`. They render the transcript (or the fixed
  `MATCH_TEXT`) at 16000 Hz with `solver: 'waveguide'`, `seed: 1`, compare
  the features of `analyzeVoice`, and correct each parameter by a secant
  step; 4 rounds by default, at most 12. The result is
  `{head, preset, features, rendered, distance}`.
- The features are utterance statistics (`f0`, `f0Range`, mean `formants`,
  `h1h2`, `hnr`, `syllableRate`) from frames that are each decided alone.
- `tests/voice-match.test.js` uses only synthetic recordings (pitch, tract
  length and speech rate within 10 % with a transcript). No test uses a real
  speaker, and no uncertainty is reported.
- `breathiness` cannot be fitted today: the measured `hnr` moves from 15.19
  to 14.59 dB when `breathiness` goes from 0 to 1
  (`experiments/issue-11-audit.txt`). {{P20}} fixes the source.
- `examples/universal-app/src/engine/match-worker.js` calls
  `matchVoiceSteps`, so its signature and result must keep working.
- `HEAD_PARAMETERS` in `src/head-config.js` lists 33 parameters with `min`,
  `max` and `default`.

## What to do

Create `src/analysis/voice-fit.js`. Symbols: `c` = 35000 cm/s; MAD = median
of the absolute differences from the median.

1. Options: `transcript` (text), `language`, `ipa` (the transcript is IPA),
   `refine` (default `true`), `maxRenders` (default 40), `seed` (default 1),
   `parts` (default `['tract', 'pitch', 'source', 'rate']`), `state` (a
   state returned earlier, to continue), `onStep` (called after each
   render).
2. Stage A, statistics (no rendering). Run `analyzeFrames` ({{P46}}),
   `trackPitch` ({{P47}}), `trackFormants` ({{P48}}), `inverseFilter`
   ({{P49}}) and, if `src/recognition/landmarks.js` exists, `findLandmarks`
   ({{P50}}); otherwise keep the syllable rate of `analyzeVoice`. Throw
   `Error('No voiced speech found in the recording')` when fewer than 20
   frames are voiced. Collect into histograms with fixed bins (this is the
   `state`; it is plain JSON and its size does not grow with the sound):
   - `f0`: quarter-semitone bins from 50 to 800 Hz, voiced frames;
   - `dF`: 5 Hz bins from 600 to 2000 Hz; one value per frame that is
     voiced, has F1 to F3 valid and is not `nasal`:

     ```
     dF = sum_k F[k] * (2k - 1) / 2  /  sum_k ((2k - 1) / 2)^2     (k = 1..3)
     ```

   - `rd` (bins of 0.05), `hnr` and `cpp` (bins of 0.5 dB), `h1h2Source`
     (bins of 0.5 dB): reliable frames of `inverseFilter`;
   - numbers: voiced seconds, speech seconds, count of nuclei, the sum of
     `frames.mel` over voiced frames (24 values) and the jitter and shimmer
     sums of the pitch track.

3. Parameters from the statistics. Each gets an object with `value`, `sd`,
   `source: 'statistics'` and `frames`. `sd` of a median =
   `1.4826 * MAD / sqrt(frames / 20)` (frames 5 ms apart are not
   independent; 20 frames count as one measurement):
   - part `tract`: `vocalTractLength = c / (2 * median dF)`;
   - part `pitch`: `pitch` = median f0; `pitchRange` = 95th minus 5th
     percentile in semitones, times the constant that maps it to the
     parameter (measure this constant once on rendered speech of the
     default head and keep it in the file);
   - part `source`: `tenseness = 1 - median(rd) / 3`; `jitter` and `shimmer`
     through `jitterToHead`; `breathiness` from the median `hnr` through a
     table for `breathiness` 0, 0.25, 0.5, 0.75 and 1, measured once on
     renders of the default head and kept in the file (needs {{P20}});
   - part `rate`: `speechRate` = measured syllable rate divided by that of
     the default head on the same kind of text, measured the same way;
   - every value is limited to `min`..`max` of `HEAD_PARAMETERS`; parameters
     that are not fitted keep the default and get `source: 'default'`.
4. Stage B, refinement by analysis-by-synthesis (when `refine` is true).
   Text to render: the transcript, or `MATCH_TEXT` without one. Render with
   `synthesize(text, {head, seed, sampleRate: 16000, solver: 'waveguide'})`
   and, if the recording has a lower rate, resample the render to it.
   Feature vector `phi` of a sound, each with a scale `s_i`:
   - `ln(median f0)` (0.03), f0 range in semitones (1.5), `ln(median dF)`
     (0.02), `ln` of the median F1, F2, F3 (0.05 each), median `rd` (0.3),
     median `h1h2Source` (2 dB), median `cpp` (1.5 dB), median `hnr`
     (2 dB), mean `tilt` of voiced frames (3 dB), `ln(syllable rate)`
     (0.08);
   - 24 values: mean `mel` over voiced frames minus its own mean, in dB
     (3 dB each). Weight `w_i` = 1 for the first group; for these 24 it is
     0.3 without a transcript and 1 with one.
   - With a transcript one more term: `melCepstralDistortion` of {{P06}}
     after time alignment of recording and render, scale 1 dB, weight 4.

   ```
   J(theta) = sqrt( sum_i w_i * ((phi_i(render) - phi_i(recording)) / s_i)^2
                    / sum_i w_i )
              + 0.05 * sum_j ((theta_j - theta0_j) / r_j)^2
   ```

   `theta` = the parameters being refined, each scaled to 0..1 by its `min`
   and `max`; `theta0` = the stage A values; `r_j` = 0.25.

5. Search with the Nelder-Mead simplex (reflection 1, expansion 2,
   contraction 0.5, shrink 0.5), first vertex `theta0`, the others `theta0`
   with one coordinate moved by 0.1 (towards the middle of the range). A
   round stops when the highest and lowest `J` of the simplex differ by less
   than 0.01. Values outside 0..1 are moved to the edge. The same `seed`
   gives the same result. Two rounds, to keep the number of renders small:
   1. the five parameters `vocalTractLength`, `pitch`, `pitchRange`,
      `tenseness`, `speechRate`: at most 60 % of `maxRenders`;
   2. `breathiness`, `glottalChink`, `aspirationLevel` and, only with a
      transcript, `nasalCoupling`, `pharynxRatio` and `oralWidth`: the rest.
6. After refinement `sd` = the larger of the stage A `sd` and the standard
   deviation of that coordinate over the final simplex; `source: 'refined'`.
   It is a rough indicator, not a confidence interval; the README says so.
7. Result: an object with `head`, `parameters`, `preset`, `features`,
   `rendered`, `distance`, `renders`, `voicedDuration` and `state`. `head`
   is a full head configuration. `parameters` maps a key of
   `HEAD_PARAMETERS` to the object of step 3. `preset` is the nearest preset
   (as today). `features` and `rendered` have the keys `analyzeVoice`
   returns today plus `rd`, `cpp` and `h1h2Source`. `distance` = final `J`
   without the last term.
8. `fitVoiceSteps` (same arguments) is a generator: it yields
   `{step, renders, distance, head}` after stage A and after each
   improvement, and returns the result.
9. `createVoiceFitter(options)` returns an object with
   `update(samples, sampleRate)`, `result(options)` and `state`. `update`
   adds the statistics of a new stretch of sound to the histograms (stage A
   only, at most 30 % of real time). `result()` computes step 3 from the
   histograms; with `refine: true`, `samples` and `sampleRate` in its
   options it also runs stage B on that stretch. {{P66}} uses this object.
10. `matchVoice` and `matchVoiceSteps` keep their arguments. They call
    `fitVoice` / `fitVoiceSteps` with `maxRenders = 10 * rounds` and return
    the same five keys. `analyzeVoice` keeps its result keys; its values now
    come from stage A.
11. If {{P21}} is merged, its fold parameters join round 2 of step 5 in
    place of `tenseness`; if {{P29}} is merged, the result can be saved as
    a voice file. Neither is required.

Budget on the reference machine of {{P46}}: stage A at most 30 % of real
time; with the default 40 renders at most 60 s for a 10 s recording.

## Tests

New file `tests/voice-fit.test.js` (the existing `tests/voice-match.test.js`
must pass unchanged). Renders are slow, so the unit tests use two heads, one
sentence of about 2.5 s ("The north wind and the sun.") and
`maxRenders: 10`. Head A: `vocalTractLength` 14, `pitch` 210, `tenseness`
0.45, `speechRate` 1.15. Head B: 18.5, 100, 0.75, 0.9.

- `recovers synthetic voices with a transcript`: at 16000 Hz: tract length
  within 6 %, pitch 3 %, speech rate 10 %, tenseness within 0.2.
- `recovers synthetic voices without a transcript`: `refine: false`: tract
  length within 8 %, pitch within 3 %.
- `works at 8000 Hz`: head A, `refine: false`: tract length within 10 %.
- `reports uncertainty`: every fitted parameter has a finite `sd` above 0;
  `sd` of `pitch` is below 5 Hz; the others have `source: 'default'`.
- `continues from a state`: two halves through `createVoiceFitter` give the
  stage A values of the whole recording within 2 %.
- `is deterministic`: two calls give equal results.
- `keeps matchVoice working`: the result has exactly the five old keys.

Heavy test `tests/heavy/copy-voice-fit.test.js` ({{P02}}), 40 renders each:

- 20 heads from seeds 1 to 20 with `vocalTractLength` 12 to 19 cm, `pitch`
  90 to 260 Hz, `tenseness` 0.3 to 0.9, `speechRate` 0.8 to 1.25,
  `breathiness` 0.1 to 0.9, each speaking a 5 s sentence. Gates on the
  median error: tract length 4 % (6 % without transcript; no single error
  above 10 %), pitch 2 %, speech rate 8 %, tenseness 0.15, breathiness 0.2.
  For at least 16 of the 20 heads the true tract length lies within
  `value +- 3 * sd`.
- Every speaker of the golden set ({{P05}}), with and without transcript:
  the fitted values with `sd`, the final `distance`, that of the nearest
  preset, and the mel-cepstral distortion of both renders.

## Acceptance criteria

- [ ] `node --test tests/voice-fit.test.js tests/voice-match.test.js` passes
      on Node.js, Bun and Deno.
- [ ] `npm run test:heavy -- --suite copy` passes the gates on the 20 heads.
- [ ] `reports/heavy/copy-voice-fit.md` exists. Gate: for every golden
      speaker the final `distance` is not above that of the nearest preset.
      Targets to be measured, not gates yet: it is at most half of it for
      80 % of the speakers, and the mel-cepstral distortion is at least
      0.5 dB better than with the nearest preset.
- [ ] The report gives the fitted `vocalTractLength` per speaker next to
      `speaker.sex` of the manifest (plausible: women 14-15 cm, men 16-18 cm).
- [ ] The example app still matches a voice (its tests pass).
- [ ] `fitVoice`, `fitVoiceSteps` and `createVoiceFitter` are exported and
      typed; README section "Voice matching" describes the new result.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- Tongue positions over time: {{P53}}. The session that calls the fitter
  while a person speaks: {{P66}}. Copying an utterance: {{P67}}.
- Head shape parameters that cannot be heard (`headWidth`, `noseLength`,
  ...): they keep their defaults.
- More than one speaker in a recording.

## References

- Nelder, J. A., Mead, R. (1965). A simplex method for function
  minimization. The Computer Journal 7(4), 308-313.
  doi:10.1093/comjnl/7.4.308
- Fitch, W. T. (1997). Vocal tract length and formant frequency dispersion
  correlate with body size in rhesus macaques. JASA 102(2), 1213-1222.
  doi:10.1121/1.421048
- Kubichek, R. (1993). Mel-cepstral distance measure for objective speech
  quality assessment. IEEE PacRim. doi:10.1109/pacrim.1993.407206
- Research notes:
  `docs/case-studies/issue-11/research/2-inversion-and-recognition.md`.
