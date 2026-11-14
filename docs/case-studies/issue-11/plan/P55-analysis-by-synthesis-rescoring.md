---
id: P55
title: Analysis-by-synthesis rescoring
type: Feature
milestone: M4
blocked_by: [P54, P06]
requirements: [R6, R7, R12, R13, R18, R19]
---

## Goal

`rescoreHypotheses(decoded, options)` takes the result of `audioToIpa` with
its list of next-best readings, speaks each doubtful stretch of each reading
with the simulator in the fitted voice, compares the sound with the
recording, and puts the reading that sounds closest first. On speech made by
the simulator the phone error rate must not rise; the gain is measured.

## Why

- The decoder ({{P54}}) compares recovered channels with targets. Channels
  that sound alike are far apart there, and the inversion is not unique. The
  sound itself is the fair judge: a reading is right when the simulator,
  asked to say it, produces what was recorded (Halle and Stevens 1962).
- Only this project can do it cheaply: the same engine that speaks is the
  model of the recogniser, and it runs about 9 times faster than real time.
- It is the last step of pass 2 of the issue ("audio to IPA") and the option
  `rescoring` of {{P61}}.

## Current state

- `planUtterance(ipa, {head, language})` plans a reading with its own
  durations: `plan.segments` (each with `kind`, `token`, `start`, `end`), a
  lead-in pause of 0.06 s, a final pause, 21 channels at 200 frames per
  second and `frameCount = Math.ceil(duration * frameRate) + 1`. Nothing
  can make a plan follow given times.
- `renderPlan(plan, {solver, sampleRate, seed})` renders any plan. Measured
  with `experiments/issue-11-render-speed.mjs`: the waveguide needs 0.10 to
  0.12 s per second of sound at 16000 Hz and 0.09 s at 8000 Hz on one core.
- `matchVoice` renders candidate voices and compares median features of the
  whole recording. No code compares a render with a recording frame by
  frame, and none renders a reading to test it.

## What to do

Create `src/recognition/rescoring.js` and `scripts/tune-rescoring.mjs`.
`decoded` is the result of {{P54}} (`nbest` of 2 to 10 readings, each with
`segments` that carry `ipa`, `start`, `end`, `cost`).

1. `warpPlan(plan, anchors)`. `anchors` is a list of pairs `[from, to]`:
   plan time `from` must fall on time `to`; both columns strictly rising.
   Between anchors time is mapped linearly; before the first and after the
   last anchor the slope is 1. Return a new plan: the same `head`, `tokens`
   and `frameRate`; `duration` = the mapped `plan.duration` minus the mapped
   time 0; `frameCount` by the formula above; channel `c` at frame `f` = the
   old channel at the plan time that maps to frame `f` (linear interpolation
   between the two nearest old frames); `segments` with mapped `start`,
   `end` and `duration`. The new plan starts at mapped time 0; return that
   time as `plan.offset`.
2. `planReading(decoded, segments)`: the plan of a list of result segments.
   1. `planUtterance` of their `ipa` joined (pauses left out), with
      `head: decoded.voice` and the language option of the decoder.
   2. Anchors: for each phoneme the start of its vowel or consonant segment
      in the plan to its `start` in the result; the end of the last one
      (after a `release` segment, if any) to its `end`.
   3. `warpPlan`. Then overwrite the channels `f0` and `loudness` at every
      frame with the values of `decoded.tracks.articulation` at the same
      time (linear interpolation). Voicing stays as planned: it belongs to
      the reading.
3. Cepstra. `mfcc` of {{P06}} with a hop of 0.01 s at `decoded.frames.rate`
   on `decoded.frames.samples` (once) and on every render. Use coefficients
   1 to 13 (1 to 10 when the rate is below 16000).
4. Reference render: `planReading` of all segments of `nbest[0]`, rendered
   with `renderPlan(plan, {solver: 'waveguide', sampleRate, seed: 1})`. The
   bias `b[n]` = mean of the recording's coefficient `n` minus the mean of
   the render's, over frames with speech. It is added to the cepstra of
   every render. It removes the microphone and what the voice fit missed.
5. Regions. A time is common when every reading has a segment boundary
   there. Between two neighbouring common times each reading has a piece. If
   all pieces are equal the stretch is agreed; otherwise it is a region with
   the different pieces as alternatives, each with `d` = the sum of its
   segment costs. Keep the `maxAlternatives` (5) cheapest. Drop a region
   when the second cheapest `d` is more than `margin` (3) above the cheapest
   or the region is longer than 2 s. Order the regions by that difference,
   smallest first.
6. Score of an alternative: `J = d + w * n * m`.
   - `n` = number of phonemes of the cheapest alternative of the region.
   - Render: `planReading` of the agreed segment before the region, the
     alternative, and the agreed segment after it (context for
     coarticulation; none at a pause). The cheapest alternative is not
     rendered again: its frames are cut from the reference render.
   - Align the render's cepstra with the recording's over the same time span
     with `dtw` (`band` 0.1). `m` = the mean over the path pairs inside the
     region of `(10 / ln 10) * sqrt(2 * sum_n (x[n] - y[n] - b[n])^2)`, in
     dB (Kubichek 1993), `x` from the recording, `y` from the render.
   - `w` comes from `src/recognition/rescoring-weights.js`, start value 0.5.
7. Budget. Count the seconds rendered. Stop starting new regions when the
   count passes `maxRenderSeconds` (default: twice the length of the input,
   after the reference render). Regions not reached keep the decoder's
   order.
8. Result: a copy of `decoded` with
   - the answer: `nbest[0]` with each scored region replaced by its
     alternative of lowest `J`; `ipa`, `segments` and `syllables` rebuilt as
     in {{P54}}; a replaced segment gets `revised: true` and the confidence
     `exp(-J)` of its alternative over the sum of `exp(-J)` of the region;
   - `nbest`: every reading with `cost` = its old cost plus `w * n * m` of
     its alternative in every scored region (the largest `m` of the region
     when its alternative was not rendered), cheapest first, the answer in
     front;
   - `rescoring`, an object with the counts `regions`, `scored`, `renders`
     and `changed`, the sound rendered in seconds `renderSeconds`, and the
     wall time `seconds`.

   With one reading, or no region, return `decoded` with `rescoring` only.

9. For worker threads ({{P65}}) split the work. `planRescoring` (same
   arguments) returns the jobs of steps 5 and 6 as plain data, `scoreJob(job)`
   returns `m` and shares nothing, `rescoreHypotheses` runs them in order.
10. `scripts/tune-rescoring.mjs` (deterministic): the tuning sentences of
    {{P54}}, decoded with `nbest: 10`; tries `w` = 0, 0.1, 0.2, 0.5, 1, 2
    and 5; keeps the lowest phone error rate (the smaller `w` on a tie);
    writes `src/recognition/rescoring-weights.js` with the table of all
    seven results in a comment.
11. Streams: {{P61}} calls `rescoreHypotheses` on each finished phrase (a
    pause of 0.3 s or the 5 s limit). Times of segments and syllables that
    were already reported are not moved; only `ipa` may change, marked by
    `revised`.

Budget on the reference machine of {{P46}}, default options: at most 0.5 s
per second of input at 16000 Hz and at 8000 Hz (about 0.11 for the reference
render, 0.22 for the alternatives, the rest for cepstra and alignment).

## Tests

New file `tests/recognition-rescoring.test.js`. Sentences, presets and
settings as in the test file of {{P54}}; the true head is passed as `voice`.

- `warpPlan keeps a plan`: anchors `[[0, 0], [duration, duration]]` give the
  same channels within 1e-6.
- `warpPlan stretches time`: anchors that double every time give twice the
  frames, and channel `height` at `2 * t` equals the old value at `t` within
  0.02 for 20 values of `t`.
- `planReading follows the times`: for a decoded sentence every phoneme of
  the new plan starts within 5 ms of its `start` in the result.
- `the true reading sounds closest`: render `ba`, `da`, `ga`, `ma`, `na`,
  `sa`, `ʃa`, `fa`, `pa`, `ta`, `ka`, `la`, `bi`, `be`, `bu`, `bo`. For each,
  give `rescoreHypotheses` a hand-made `decoded` with the true reading and
  the others that differ in one phoneme, all with equal `cost` and the true
  times. The true reading is first in at least 13 of 16.
- `does not hurt synthetic speech`: the sentences decoded with `nbest: 10`;
  the phone error rate ({{P06}}) after rescoring is not above the rate
  before, at 16000 Hz and at 8000 Hz. Prints both and the lowest rate found
  anywhere in the list ("oracle").
- `leaves a single reading alone`: `nbest: 1` gives `renders` 0 and the same
  `ipa`.
- `respects the render budget`: with `maxRenderSeconds: 0.5`,
  `renderSeconds` is at most the length of the reference render plus 0.5 s
  plus the renders of one region.
- `is deterministic`: two calls give equal results (without `seconds`).
- `stays within the CPU budget`: prints `rescoring rtf <x>`; fails above 2.

Heavy test `tests/heavy/recognition-rescoring.test.js` ({{P02}}): 50
sentences per language from the simulator and the golden set ({{P05}}) with
fitted voices; `writeReport('recognition-rescoring', ...)` with the phone
error rate before, after and oracle per language and rate, the share of
regions changed, and how many changes were right and wrong.

## Acceptance criteria

- [ ] `node --test tests/recognition-rescoring.test.js` passes on Node.js,
      Bun and Deno.
- [ ] `node scripts/tune-rescoring.mjs` run twice writes the same file.
- [ ] The CI log shows `rescoring rtf` of at most 0.5.
- [ ] `reports/heavy/recognition-rescoring.md` exists. Gate: on the
      simulator's sentences the rate after is not above the rate before.
      Targets to be measured, not gates yet: at least 10 % lower (relative)
      on the simulator's sentences, and not higher on the golden set.
- [ ] If the rate rises on the golden set, the pull request says so, the
      option `rescoring` of {{P61}} stays off by default, and a Bug issue
      with the numbers is opened.
- [ ] `rescoreHypotheses`, `warpPlan`, `planReading`, `planRescoring` and
      `scoreJob` are exported and typed.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- Choosing words with a dictionary: {{P56}}.
- Changing the voice during rescoring: the voice fit is {{P51}}.
- New readings that are not in the list of {{P54}}.
- The 3D solvers as the judge: too slow; the waveguide only.
- Running the jobs on several cores: {{P65}}.
- Copy synthesis of the whole utterance: {{P67}}.

## References

- Halle, M., Stevens, K. N. (1962). Speech recognition: a model and a
  program for research. IRE Trans. Information Theory 8(2), 155-159.
  doi:10.1109/tit.1962.1057686
- Schwartz, R., Austin, S. (1991). A comparison of several approximate
  algorithms for finding multiple (N-best) sentence hypotheses. ICASSP.
  doi:10.1109/icassp.1991.150436
- Kubichek, R. (1993). Mel-cepstral distance measure for objective speech
  quality assessment. IEEE Pacific Rim Conference.
  doi:10.1109/pacrim.1993.407206
- Sakoe, H., Chiba, S. (1978). Dynamic programming algorithm optimization
  for spoken word recognition. IEEE Trans. ASSP 26(1), 43-49.
  doi:10.1109/tassp.1978.1163055
- Research notes:
  `docs/case-studies/issue-11/research/2-inversion-and-recognition.md`.
