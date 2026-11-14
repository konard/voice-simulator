---
id: P26
title: Articulator dynamics and coarticulation calibrated on real data
type: Feature
milestone: M2
blocked_by: [P06, P05]
requirements: [R1, R9, R17, R18]
---

## Goal

Move every articulator like a damped mass that is pulled towards a target: one
time constant per articulator, a start time before the sound it belongs to, and
a strength with which each sound holds each articulator. Then fit these numbers
to recordings so that the formant movements between sounds match real speech.

## Why

Most of what a listener hears as "natural" or "robotic" articulation is in the
transitions: how fast the formants move, how early the lips round before `[u]`,
how much a vowel changes next to `[ʃ]` but not next to `[p]`. Speech science
describes this with targets that are approached by a critically damped system
(Saltzman & Munhall 1989; Birkholz et al. 2011), with anticipation (Bell-Berti &
Harris 1981) and with coarticulation resistance (Recasens et al. 1997). The
constants must come from data, not from taste.

## Current state

`planUtterance()` in `src/articulation/plan.js` writes a step function per
channel (200 values per second) and then smooths it:

```js
smoothChannel(
  channels[name],
  CHANNELS[name] / head.articulationSpeed,
  frameRate
);
```

`smoothChannel()` runs a one-pole filter forwards and then backwards
(`alpha = 1 - Math.exp(-1 / (timeConstant * frameRate))`). `CHANNELS` holds the
time constants in seconds: `height` 0.03, `backness` 0.03, `rounding` 0.02,
`rhotic` 0.025, `palatalization` 0.02, `lipAmount` 0.01, `lipArea` 0.006,
`tongueAmount` 0.012, `tongueArea` 0.006, `tongueLocation` 0.012, `tongueWidth`
0.012, `velum` 0.022, `voicing` 0.008, and more for the source channels.

Consequences:

- Every transition is symmetric around the boundary between two sounds: an
  articulator starts as early before the boundary as it finishes after it. Lips
  do not round early and the velum does not open early.
- The vowel channels (`height`, `backness`, `rounding`) are interpolated in a
  straight line from vowel to vowel through all consonants (comment at the top
  of `plan.js`). Every consonant lets the vowels pass in the same way, `[ʃ]`
  like `[p]`.
- The constants were set by ear and by level tests; no test compares a
  transition with a recording.

## What to do

1. Targets. In `plan.js`, replace the step functions of the articulation
   channels (all channels of `CHANNELS` except `f0` and `loudness`, and except
   `lungPressure`, `adduction` and `foldTension` if {{P21}} has added them)
   by a list of targets per channel:
   `{value, start, end, strength}` (times in seconds, `strength` from 0 to 1).
   Export `channelTargets(segments, name)` so that tests can read the list.

2. Dynamics. Add `src/articulation/dynamics.js` with
   `approachTargets(targets, timeConstant, frameRate, order = DYNAMICS_ORDER)`.
   It runs `order` equal one-pole filters in a row, forwards only, each with
   `alpha = 1 - exp(-1 / (timeConstant * frameRate))`. `DYNAMICS_ORDER = 2`
   gives a critically damped second-order system (range 2 to 6; Birkholz et al.
   2011 use higher orders). The input of the filter at time `t` is the value of
   the target that is active at `t + lead`, where `lead` is a property of the
   channel (step 3).

3. Time constants and leads. Replace `CHANNELS` by `ARTICULATORS`, a frozen
   object with one entry per channel: `{timeConstant, lead, min, max}` in
   seconds. Starting values: `timeConstant` = today's value; `lead` =
   `1.68 * timeConstant` (the time a second-order system needs to cover half of
   a step; this keeps the middle of each transition where it is today).
   Exceptions, as starting values:
   - `rounding`: `lead = ROUNDING_LEAD = 0.12` s (range 0.05 to 0.25), but never
     earlier than the end of the previous sound that has its own `rounding`
     target;
   - `velum`: `lead = VELUM_LEAD = 0.08` s (range 0.03 to 0.15), with the same
     limit.

   Limits for the fit: `timeConstant` from 0.005 to 0.08 s.
   `head.articulationSpeed` keeps dividing all time constants and leads.

4. Coarticulation resistance. Add `resistance` (0 to 1) per phone to
   `src/articulation/phones.js`, exported as `COARTICULATION_RESISTANCE` by
   place and manner. During a consonant the vowel channels get the value
   `r * own + (1 - r) * line`, where `line` is today's straight line between the
   neighbouring vowels and `own` the tongue-body position of the consonant
   itself. Starting values after the scale of Recasens et al. (1997): 1.0 for
   palatals, alveolo-palatals, `[ʃ ʒ]`, trills and dark `[ɫ]`; 0.6 for `[s z]`
   and velars; 0.3 for other alveolars and dentals; 0 for labials and glottals.
   `own` per place goes into the same table (palatal: `height` 1, `backness` 0;
   velar: `height` 0.9, `backness` 0.8; alveolar: `height` 0.7, `backness` 0.3).

5. Reduction. Remove nothing else: when a sound is short, the articulator does
   not reach its target (undershoot). After the fit of step 6, check that the
   fixed factor 0.75 for reduced vowels in `vowelDuration()` and the special
   shapes of reduced vowels are still needed; record the result in the pull
   request, change them only in {{P27}}.

6. Calibration. Write `experiments/issue-11-fit-dynamics.mjs`:
   - input: the recordings of the golden set ({{P05}}) with their IPA
     transcripts; optional articulatory data that the dataset registry allows
     (USC-TIMIT, licence CC BY 4.0 according to
     `docs/case-studies/issue-11/research/3-datasets.md`);
   - for each recording, measure the duration of every sound: the golden set has
     no phone alignment, so synthesize the IPA once, align the synthesized audio
     to the recording with `dtw()` of {{P06}} (log-mel frames of 10 ms) and map
     the segment boundaries of the plan through the path (put this in
     `experiments/issue-11-align.mjs`, export
     `alignToRecording(plan, audio, recording)`, shared with {{P27}}). Then
     synthesize again on tier `minimal` with these durations (a new option
     `durations` of `planUtterance()`, an array of seconds per token), and
     compute `formantErrors()` of {{P06}} between the two (F1 to F3, voiced
     frames only);
   - parameters: the `timeConstant` and `lead` of the eight articulation
     channels with the largest effect (measure the effect first by changing each
     by 20 %), and the four resistance values of step 4;
   - method: coordinate descent, each parameter in steps of ±15 %, then ±5 %,
     inside its limits, at most 6 rounds; hold out one recording in five and
     report its error separately;
   - output `experiments/issue-11-fit-dynamics.txt`: the error before and after,
     per language, and the fitted values. Write the fitted values into
     `ARTICULATORS` and `COARTICULATION_RESISTANCE` only if the held-out error
     falls by at least 5 %.

   The script is slow: run it through the heavy workflow ({{P02}}), not in
   `npm test`.

7. Keep `smoothChannel()` exported (it is used for `f0` and `loudness`). Add a
   head parameter `coarticulation` (factor on all `lead` values, 0.5 to 2,
   default 1, group `prosody`).

## Tests

Add to `tests/articulation.test.js`:

- `approaches a target without overshoot`: a step from 0 to 1 through
  `approachTargets()` with `timeConstant` 0.02 never exceeds 1, reaches 0.5
  after 0.0336 ± 0.005 s and 0.9 after 0.078 ± 0.01 s.
- `undershoots a short target`: a target of 1 lasting 0.03 s between zeros peaks
  below 0.6 with `timeConstant` 0.02 and above 0.8 with 0.006.
- `rounds the lips before the vowel`: in `stu` the channel `rounding` passes 0.5
  at least 0.06 s before the start of `[u]`; in `tu` not before the start of
  `[t]`.
- `opens the velum before a nasal`: in `ana` the channel `velum` passes half of
  its peak 0.03 to 0.12 s before the start of `[n]`.
- `lets labials pass and palatals resist`: in `ipa` and `iʃa`, at the middle of
  the consonant, `height` is within 0.1 of the straight line for `[p]` and at
  least 0.2 above it for `[ʃ]`.
- `keeps the middle of a transition`: for `aba`, the time at which `lipArea`
  passes half of its range differs by less than 0.01 s from the value before
  this change (0.105 s base vowel length; compute the old value with
  `smoothChannel()` in the test).
- `takes measured durations`: `planUtterance()` with `durations` returns
  segments of exactly those lengths.

The existing tests of `tests/articulation.test.js`, `tests/timeline.test.js`,
`tests/syllables.test.js` and `tests/visemes.test.js` must pass; fix thresholds
there only if the value moved by less than 10 %.

## Acceptance criteria

- [ ] `experiments/issue-11-fit-dynamics.txt` is committed and shows a held-out
      formant error at least 5 % below the error before the fit, or states that
      the fit was rejected and why.
- [ ] `grep -n "CHANNELS\[" src` finds nothing outside `plan.js`, and the README
      section on articulation names `ARTICULATORS`.
- [ ] The level and duration of the audit sentence
      (`node experiments/issue-11-audit.mjs`) change by less than 1 dB and less
      than 3 %.
- [ ] `planUtterance()` is at most 20 % slower (measure 100 runs of the audit
      sentence).
- [ ] The new tests exist and pass on Node.js, Bun and Deno.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- Segment durations: {{P27}}. Pitch movements and tones: {{P37}}, {{P39}}.
- New articulators (jaw, larynx, lip protrusion): {{P28}}; they get entries in
  `ARTICULATORS` there.
- Speaker-specific articulation habits in the voice file: {{P29}}. Accents:
  {{P45}}.
- Fitting articulation to one speaker from audio: {{P51}}.

## References

- Saltzman, E. L., & Munhall, K. G. (1989). A dynamical approach to gestural
  patterning in speech production. Ecological Psychology 1(4), 333-382.
  doi:10.1207/s15326969eco0104_2
- Birkholz, P., Kröger, B. J., & Neuschaefer-Rube, C. (2011). Model-based
  reproduction of articulatory trajectories for consonant-vowel sequences. IEEE
  Transactions on Audio, Speech, and Language Processing 19(5), 1422-1433.
  doi:10.1109/TASL.2010.2091632
- Recasens, D., Pallarès, M. D., & Fontdevila, J. (1997). A model of lingual
  coarticulation based on articulatory constraints. Journal of the Acoustical
  Society of America 102(1), 544-561. doi:10.1121/1.419727
- Öhman, S. E. G. (1966). Coarticulation in VCV utterances: spectrographic
  measurements. Journal of the Acoustical Society of America 39(1), 151-168.
  doi:10.1121/1.1909864
- Bell-Berti, F., & Harris, K. S. (1981). A temporal model of speech production.
  Phonetica 38(1-3), 9-20.
- Prom-on, S., Birkholz, P., & Xu, Y. (2014). Identifying underlying
  articulatory targets of Thai vowels from acoustic data based on an
  analysis-by-synthesis approach. EURASIP Journal on Audio, Speech, and Music
  Processing 2014:23. doi:10.1186/1687-4722-2014-23
- Research notes:
  `docs/case-studies/issue-11/research/5-performance-and-physics.md` (part C).
