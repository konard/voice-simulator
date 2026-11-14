---
id: P53
title: Acoustic-to-articulatory inversion (pass 2)
type: Feature
milestone: M4
blocked_by: [P52, P48, P51]
requirements: [R6, R9, R12, R13, R18, R19]
---

## Goal

`invertArticulation` turns the analysis frames of a recording into the same
21 control channels that the simulator plans when it speaks (`height`,
`backness`, `velum`, `f0`, `voicing` and so on), one value per frame, each
with a variance. Rendering these channels with the fitted voice gives a
sound close to the recording. This is pass 2 of recognition; pass 1 is the
voice fit ({{P51}}).

## Why

- The issue asks for recognition as the simulation run in reverse: first fit
  the voice, then recover what the speech organs did. The recovered channels
  are what the decoder turns into IPA ({{P54}}).
- The same track is the starting point of copy synthesis ({{P67}}) and lets
  the voice session measure how a speaker differs from the planned targets
  ({{P66}}).
- One sound can come from several tract positions (Atal et al. 1978). Only
  continuity in time can choose between them, so the choice is made over the
  whole stretch and not frame by frame.

## Current state

- Forward: `planUtterance` in `src/articulation/plan.js` returns
  `{tokens, segments, head, frameRate, frameCount, duration, channels}` with
  21 channels as `Float32Array` at 200 Hz. Each channel is smoothed by
  `smoothChannel` with the time constant `CHANNELS[name]` (0.006 to 0.03 s)
  divided by `head.articulationSpeed`.
- `renderPlan(plan, options)` reads only `plan.head`, `plan.duration`,
  `plan.frameRate`, `plan.frameCount` and `plan.channels`
  (`sampleState` in `src/articulation/tract-shape.js`). So any object with
  these fields can be rendered.
- Backward: nothing. `analyzeVoice` gives long-term means only (four mean
  formants, median pitch). No function returns a tract position for a frame.
- The `lateral` channel is planned but no acoustic code reads it, and
  `glottalClosure` only gates the source. Neither can be recovered from sound
  as a separate value today.

## What to do

Create `src/recognition/inversion.js` (stage pattern of {{P46}}) and the
script `scripts/calibrate-inversion.mjs`.

1. `invertArticulation(frames, options)`. Options: `voice` (a head, for
   example `fitVoice(...).head`; default head when absent), `codebook`
   (default `buildCodebook(voice)`), `pitch` (default `trackPitch(frames)`),
   `formants` (default `trackFormants` with the tract length of `voice` and
   `pitch`), `candidates` (16), `smoothness` (1), `refine` (false),
   `lag` (30 frames).
2. Frame kinds. `speech[t]` 0: gap. Otherwise periodic when
   `periodicity[t] >= 0.45`, else noisy.
3. Candidates of a speech frame: `frameEnvelope` and `codebook.query` of
   {{P52}} with `k = candidates`. Local cost of row `i`:
   `c = w * (D / 16 + sum over k of z_k^2)`, where `D` is the envelope
   distance returned by `query` (dB², so 16 means 4 dB RMS),
   `z_k = (S * F_k - R_k) / sqrt(S^2 * V_k + (0.03 * R_k)^2)` for `k` = 1 to
   3 where the formant track is valid, `F_k` and `V_k` = frequency and
   variance of the track, `R_k` = formant of the row, `S` =
   `codebook.lengthScale`; `w` = 1 for periodic and 0.25 for noisy frames
   (LPC formants of noise are less sure).
4. Candidates of a gap shorter than 150 ms with speech on both sides (a
   closure): the sound says nothing, so take the 32 seed rows with a full
   closure (`lipArea` or `tongueArea` below 0.05 with its amount above 0.5)
   that are nearest in articulation (distance of step 5) to the best row of
   the frame before the gap; local cost 0. The transition cost then picks
   the closure that fits the movements into and out of it. Longer gaps cut
   the track into independent stretches; inside them all tract channels
   take `CHANNEL_DEFAULTS` and `confidence` is 0.
5. Transition cost between row `i` at frame `t - 1` and row `j` at `t`:
   `T = smoothness * sum over the 12 channels c of d_c^2`,
   `d_c = (a_j,c - a_i,c) / s_c`,
   `s_c = 0.5 * range_c * (1 - exp(-1 / (tau_c * frameRate)))`,
   `tau_c = CHANNELS[c] / voice.articulationSpeed`, `range_c` from
   `CODEBOOK_CHANNELS`. `s_c` is how far the planner can move the channel in
   one frame after a jump of half its range.
6. Search (Viterbi 1967): the best path through one row per frame minimises
   the sum of local and transition costs. 16 times 16 times 12 operations
   per frame. Keep back-pointers for `lag` frames in a stream; `advance()`
   fixes frame `t` when frame `t + lag` is scored, `advance(true)` fixes
   all.
7. Smoothing per tract channel (Kalman filter and Rauch-Tung-Striebel
   pass, random walk): measurement `z` = the value of the chosen row;
   measurement variance
   `r = max(sum_i p_i * (a_i - z)^2, (0.02 * range_c)^2)` over the
   candidates, with weights `p_i` proportional to `exp(-(c_i - c_min) / 2)`
   that sum to 1; process variance `s_c^2`. The smoothed mean
   goes to `channels[name]`, the smoothed variance to `variance[name]`. In a
   stream the backward pass runs over the last `lag` frames only.
8. Source channels:
   - `f0`: from the pitch track; unvoiced frames are filled by linear
     interpolation between voiced neighbours, `voice.pitch` when none.
   - `voicing`: 1 where the track is voiced, else 0, then
     `smoothChannel(values, CHANNELS.voicing, frameRate)`.
   - `loudness`: `min(1.5, 10^((energy - ref) / 20))`, `ref` = the 90th
     percentile of `energy` over the voiced frames seen so far; mean over
     50 ms; 0 in gaps.
   - `aspiration`, `frication`, `sibilance`: `clamp(m . x, 0, 1)` with
     `x = [1, energy - ref, gravity / 1000, zcr, periodicity, tilt]` and one
     weight vector `m` per channel and working rate, from step 10.
   - `trill`: 1 where `energy` rises and falls by at least 6 dB between 18
     and 40 times per second for two cycles or more, else 0.
   - `glottalClosure` and `lateral`: 0 (see Current state). Their variance
     is `Infinity`, which tells {{P54}} not to use them.
9. Optional refinement (`refine: true`, batch only). For every fourth
   periodic frame with `velum < 0.1`: Nelder-Mead (1965) over `height`,
   `backness`, `rounding`, `tongueAmount`, `tongueLocation`, `tongueArea`;
   start at the smoothed values, first step 5 % of the range; cost =
   `D / 16` with the envelope of `tractResponse` ({{P52}}) for the areas of
   `tractShape`, plus `sum_c ((a_c - smoothed_c) / (2 * s_c))^2`; at most
   60 evaluations. Then repeat step 7 with the refined values as `z`.
10. `scripts/calibrate-inversion.mjs` (deterministic, run by hand) renders
    the four sentences and the consonant list of the calibration of
    {{P50}} for the presets male, female and child at 8000, 11025 and
    16000 Hz, takes the planned channels at the frame times as truth
    (`sampleState`), solves the three least-squares problems of step 8 per
    rate, and writes `src/recognition/source-channel-maps.js` with the
    weights and the reached RMS error in a comment.
11. Result `track`: `frameRate` (`1 / frames.hop`), `frameCount`, `duration`,
    `startTime`, `committed`, `head` (the voice), `channels` (21 arrays as
    in a plan), `variance` (21 arrays), `confidence` (`Float32Array`,
    `exp(-c / 8)` of the chosen row, 0 in long gaps), `candidates`
    (`{count, index, cost}`: the row numbers as `Int32Array` and costs as
    `Float32Array`, `count` per frame, row-major; -1 where absent).
12. `articulationPlan(track)` returns an object with `tokens: []`,
    `segments: []` and the fields `head`, `frameRate`, `frameCount`,
    `duration` and `channels` of the track; `renderPlan` accepts it.
13. Exports: `invertArticulation(frames, options)`,
    `createArticulationInverter(frames, options)`, `articulationPlan`.

Budget on the reference machine of {{P46}}: at most 10 % of real time at
16000 and 8000 Hz without refinement; refinement at most 1 times real time.
Delay in a stream: `lag * hop` = 150 ms.

## Tests

New file `tests/recognition-inversion.test.js`. Speech comes from
`synthesize` (`solver: 'waveguide'`, `seed: 1`), which also returns the plan;
truth = `sampleState(plan, t)` at the frame times. Unit tests pass the true
head as `voice`, so that errors of {{P51}} do not hide errors made here.
Error of a channel = RMS difference divided by its range, over periodic
frames. Unit tests use a codebook of 5000 rows built once per file.

- `recovers steady vowels`: the 31 vowels, 300 ms each, male and female:
  `height` within 0.15 and `backness` within 0.2 at the middle frame for at
  least 85 % of the vowels. `rounding` is printed, not gated: rounding and
  backness lower the same formants and trade against each other.
- `recovers a sentence`: "The north wind and the sun were disputing which
  was the stronger." at 16000 Hz: `height` at most 0.12, `backness` 0.15,
  `voicing` 0.15, `f0` within 3 %. At 8000 Hz: 0.15 and 0.20. `rounding` and
  `velum` are printed with the target 0.25.
- `finds the lips in a closure`: `apa`, `ata`, `aka`: at the middle of the
  closure `lipAmount` is above 0.5 for `apa` only. The error of
  `tongueLocation` for `ata` and `aka` is printed (target 0.15).
- `moves no faster than the planner`: no channel changes by more than
  `3 * s_c` between two frames.
- `renders back close to the input`: `renderPlan(articulationPlan(track))`
  against the input with `melCepstralDistortion` of {{P06}}: at most 5 dB at
  16000 Hz and 6 dB at 8000 Hz.
- `refinement does not hurt`: with `refine: true` the distortion of the
  test before is not higher.
- `stream agrees with batch`: 95 % of the committed values differ by less
  than 5 % of the range.
- `stays within the CPU budget`: prints `inversion rtf <x>`; fails above
  0.4.

Heavy test `tests/heavy/recognition-inversion.test.js` ({{P02}}): for each
golden utterance ({{P05}}) fit the voice on all utterances of the speaker,
invert, render back and write the distortion per utterance with
`writeReport('recognition-inversion', ...)`.

## Acceptance criteria

- [ ] `node --test tests/recognition-inversion.test.js` passes on Node.js,
      Bun and Deno with the thresholds above.
- [ ] `node scripts/calibrate-inversion.mjs` run twice writes the same file,
      byte for byte.
- [ ] The CI log of `stays within the CPU budget` shows at most 0.10.
- [ ] `reports/heavy/recognition-inversion.md` gives the mel-cepstral
      distortion of the render-back for every golden utterance. Target to be
      measured, not a gate yet: mean at most 9 dB. If the mean is higher,
      the pull request says so and a Bug issue with the numbers is opened.
- [ ] The pull request states the measured errors of `rounding`, `velum` and
      `tongueLocation`.
- [ ] `invertArticulation`, `createArticulationInverter` and
      `articulationPlan` are exported and typed.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- Naming the phonemes and their times: {{P54}}.
- Whispered speech, which has no periodic frames: {{P60}}.
- Fitting per-speaker targets from the recovered track: {{P66}}.
- Exact copy of a recording by optimising the whole track: {{P67}}.
- Articulators that the simulator does not have yet: {{P28}}.

## References

- Atal, B. S., Chang, J. J., Mathews, M. V., Tukey, J. W. (1978). Inversion
  of articulatory-to-acoustic transformation in the vocal tract by a
  computer-sorting technique. JASA 63(5), 1535-1555. doi:10.1121/1.381848
- Schroeter, J., Sondhi, M. M. (1994). Techniques for estimating vocal-tract
  shapes from the speech signal. IEEE Trans. Speech and Audio Processing
  2(1), 133-150. doi:10.1109/89.260356 (dynamic programming over codebook
  candidates, then optimisation).
- Panchapagesan, S., Alwan, A. (2011). A study of acoustic-to-articulatory
  inversion of speech by analysis-by-synthesis using chain matrices and the
  Maeda articulatory model. JASA 129(4), 2144-2162. doi:10.1121/1.3514544
- Ghosh, P. K., Narayanan, S. S. (2010). A generalized smoothness criterion
  for acoustic-to-articulatory inversion. JASA 128(4), 2162-2172.
  doi:10.1121/1.3455847
- Nelder, J. A., Mead, R. (1965). A simplex method for function
  minimization. The Computer Journal 7(4), 308-313.
  doi:10.1093/comjnl/7.4.308
- Viterbi, A. (1967). Error bounds for convolutional codes and an
  asymptotically optimum decoding algorithm. IEEE Trans. Information Theory
  13(2). doi:10.1109/tit.1967.1054010
- Research notes:
  `docs/case-studies/issue-11/research/2-inversion-and-recognition.md`.
