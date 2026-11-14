---
id: P47
title: Robust pitch and voicing tracker
type: Feature
milestone: M4
blocked_by: [P46, P06, P04]
requirements: [R6, R9, R12, R13, R18]
---

## Goal

`trackPitch` gives, for every analysis frame, the pitch in Hz (0 when
unvoiced), a voicing score and the strength of the period. The decision of a
frame uses its neighbours, so single wrong frames and octave jumps disappear.
It also measures jitter and shimmer and gives one time mark per period.

## Why

Pitch and voicing are inputs of almost everything in recognition: the voice
fit ({{P51}}), the source analysis ({{P49}}), the `f0` and `voicing` channels
of the inversion ({{P53}}), tones and intonation ({{P58}}). The simulator
plans `f0` and `voicing` at 200 Hz; the reverse direction must recover them at
the same rate, also from 8000 Hz sound and in real time on one core.

## Current state

- `yinPitch(signal, start, length, sampleRate)` in
  `src/analysis/voice-features.js` gives `{f0, aperiodicity}` for one frame
  (YIN, threshold `0.15`, 60 to 600 Hz, 40 ms window). Each frame is decided
  alone; nothing links frames. Its loops cost `window * maxLag` operations.
- `analyzeVoice` calls a frame voiced when it is louder than 10 % of the 95th
  percentile level and `aperiodicity < 0.35`.
- There is no jitter or shimmer measurement and no period marks.
- Measured by `node experiments/issue-11-audit-m4a.mjs` on a clean synthetic
  sentence, with the planned `f0` as truth (output in
  `experiments/issue-11-audit-m4a.txt`):

  ```
  pitch male@16000: {"frames":463,"grossPitchErrorPercent":0,"voicingDecisionErrorPercent":12.5,"fineErrorCents":12.7}
  pitch female@8000: {"frames":454,"grossPitchErrorPercent":0.9,"voicingDecisionErrorPercent":15.4,"fineErrorCents":14}
  pitch child@16000: {"frames":498,"grossPitchErrorPercent":0.8,"voicingDecisionErrorPercent":13.1,"fineErrorCents":12.6}
  ```

  So on clean synthetic speech octave errors are rare, and the weak point is
  the voiced or unvoiced decision (12.5 to 15.4 % of frames against the truth
  `voicing > 0.5 && loudness > 0.3`). Real, noisy or telephone speech has
  never been measured.

## What to do

Create `src/recognition/pitch.js`. It follows the stage pattern of {{P46}} and
reads `frames.samples`, `frames.rate`, `frames.energy` and `frames.noise`.

1. Options and defaults (`PITCH_DEFAULTS`): `minF0: 60`, `maxF0: 600` (Hz),
   `candidates: 4`, `voicingThreshold: 0.45`, `silenceThreshold: 0.03`,
   `octaveCost: 0.01`, `octaveJumpCost: 0.7`, `voicedUnvoicedCost: 0.28`,
   `lag: 20` (frames). The two transition costs are the usual values 0.35 and
   0.14 for a 10 ms step (Boersma 1993) times `0.01 / hop`.
2. Coarse signal: low-pass the working signal and keep every `D`-th sample,
   `D = floor(rate / 4000)` (4 at 16000 Hz, 2 at 11025 and 8000 Hz). Use a
   windowed-sinc low-pass with cutoff `0.45 * rate / D` and 8 zero crossings.
   Coarse rate `rc = rate / D`.
3. Candidates of frame `t` (window `W = 3 / minF0` = 50 ms, centred like the
   frame, Hann window, FFT size = next power of two not below `1.5 * W * rc`):
   1. Remove the mean, apply the window, transform, take the power, transform
      back: autocorrelation `r[l]`.
   2. `q[l] = r[l] / (r[0] * w[l])`, `w` = autocorrelation of the window with
      `w[0] = 1`.
   3. Take every local maximum of `q` for lags from `rc / maxF0` to
      `rc / minF0`. Refine its lag `l` and height `h` with a parabola through
      the three points around it. Limit `h` to 1.
   4. Refine at the full rate: for the lags `D * l - D` to `D * l + D` (step 1
      sample) compute the same normalised autocorrelation directly on the
      working signal; take the best lag, again with a parabola. Frequency
      `f = rate / lag`.
   5. Strength `s = h - octaveCost * log2(maxF0 / f)`. Keep the `candidates`
      strongest.
   6. Unvoiced candidate: strength
      `u = voicingThreshold + max(0, 2 - (A / G) / q)`,
      `q = silenceThreshold / (1 + voicingThreshold)`, `A` = largest absolute
      sample in the window, `G` = largest absolute sample so far (in a stream)
      or of the whole input.
4. Path search (Viterbi 1967). State = one candidate of one frame. Score of a
   path = sum of strengths minus transition costs. Transition from frame `t-1`
   to `t`: 0 between two unvoiced states, `voicedUnvoicedCost` when exactly one
   is unvoiced, `octaveJumpCost * |log2(f1 / f2)|` between two voiced states.
   Keep the best score and the previous state for every state.
5. Commit: with `advance()` the decision for frame `t` is fixed when frame
   `t + lag` has been scored: trace back from the best state of the newest
   frame. `advance(true)` traces back from the last frame and fixes all.
6. Output `track` (arrays of `frames.capacity` values):
   `hop`, `startTime`, `count`, `committed`, `f0`, `voicing`, `strength`,
   `marks`, `jitter`, `shimmer`, `median`, `low`, `high`.
   - `f0`: Hz, 0 when the chosen state is unvoiced.
   - `strength`: `h` of the chosen state, or of the best voiced candidate.
   - `voicing`: `clamp(0.5 + (best voiced s - u) / 0.4, 0, 1)`. It is a score,
     not a calibrated probability.
   - `median`, `low`, `high`: 50th, 5th and 95th percentile of `f0` over the
     committed voiced frames (Hz); `null` without voiced frames.
7. Period marks (`marks`, a `Float64Array` of times in seconds, growing): for
   every run of voiced frames of at least 40 ms:
   1. Start at the largest absolute sample within the middle 20 ms of the run.
   2. Step forward: the next mark is the place within `T +- 0.2 * T` after the
      last mark (`T = 1 / f0` there) where the normalised cross-correlation
      between the stretch of length `T` after the last mark and the stretch
      after the new place is largest. Stop at the end of the run.
   3. Do the same backward from the start.
8. `jitter` (percent) = `100 * mean |T_i - T_{i+1}| / mean T_i` over
   neighbouring periods inside runs. `shimmer` (percent) = the same with
   `A_i` = largest minus smallest sample in period `i`. Both are `null` with
   fewer than 20 periods. The simulator draws period and amplitude factors
   with standard deviations `head.jitter` and `head.shimmer` percent
   (`Glottis` in `src/acoustics/glottis.js`); for such independent draws the
   measure is 1.128 times the standard deviation. Export
   `jitterToHead(value) = value / 1.128` for {{P51}}.
9. Exports: `trackPitch(frames, options)` (create, `advance(true)`, return
   the track), `createPitchTracker(frames, options)`, `PITCH_DEFAULTS`,
   `jitterToHead`.
10. Truth for tests, in `tests/helpers/recognition-truth.js`:
    `plannedPitch(plan, hop)` returns `f0` per frame from
    `sampleState(plan, t)`, set to 0 where `voicing < 0.5` or `loudness < 0.05`,
    and a mask that is 0 within 15 ms of a change between voiced and unvoiced
    (the plan does not say where exactly the folds start).

Budget on the reference machine of {{P46}}: at most 5 % of real time at
16000 Hz and at 8000 Hz. Decision delay in a stream: `lag * hop` = 100 ms plus
25 ms of window.

## Tests

New file `tests/recognition-pitch.test.js`. "The set" means the sentence "The
north wind and the sun were disputing which was the stronger." for the presets
male, female and child (`head: presetHeadConfig(name)`), `solver: 'waveguide'`,
`seed: 1`, at 16000 and 8000 Hz. Errors come from `f0Errors` of {{P06}} over
frames where the mask is 1.

- `follows a sine sweep`: a sweep from 80 to 500 Hz in 2 s with five
  harmonics: every frame voiced, error below 1 %.
- `tracks clean synthetic speech`: on the set `gpe <= 0.005`, `vde <= 0.04`
  and the mean absolute error of the other voiced frames is at most 15 cents.
- `survives a missing fundamental`: the male sentence high-passed at 300 Hz
  (8000 Hz): `gpe <= 0.02`.
- `survives noise`: seeded white noise at 20 dB and 10 dB below the speech
  level: `ffe <= 0.08` and `ffe <= 0.15`.
- `is silent on noise`: 2 s of seeded white noise: no voiced frame.
- `agrees between stream and batch`: at most 1 % of frames differ.
- `measures jitter`: `aː` for 2 s with `head.jitter` 0.2, 1 and 2:
  `jitterToHead(track.jitter)` grows each time and is within a factor of 2 of
  the setting; the same for `shimmer` 1, 4 and 8.
- `stays within the CPU budget`: prints `pitch rtf <x>`; fails above 0.2.

Heavy test `tests/heavy/recognition-pitch.test.js` ({{P02}}): the same errors
on a public corpus with a laryngograph reference (candidates: PTDB-TUG, Keele,
CSTR FDA). Check the licence of each first and register only a permitted one
through {{P04}}; if none is permitted, write that into the report and skip.

## Acceptance criteria

- [ ] `node --test tests/recognition-pitch.test.js` passes on Node.js, Bun and
      Deno with the thresholds above.
- [ ] `experiments/issue-11-audit-m4a.mjs` gets a second block that prints the
      same three numbers for `trackPitch`; in the new output the voicing error
      is below the old one for all six lines.
- [ ] The CI log of `stays within the CPU budget` shows at most 0.05.
- [ ] `reports/heavy/recognition-pitch.md` states GPE, VDE and FFE on real
      speech, or states that no corpus with a permitted licence was found.
      Target to be measured, not a gate yet: `ffe <= 0.10`.
- [ ] `trackPitch`, `createPitchTracker`, `PITCH_DEFAULTS` and `jitterToHead`
      are exported and typed.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- Creaky voice with period doubling and whisper: {{P59}}, {{P60}}.
- Tone, stress and sentence type from the pitch curve: {{P58}}.
- Replacing `yinPitch` inside `analyzeVoice`: {{P51}}.
- Several voices at once.

## References

- Boersma, P. (1993). Accurate short-term analysis of the fundamental
  frequency and the harmonics-to-noise ratio of a sampled sound. Proc.
  Institute of Phonetic Sciences 17, 97-110.
- Talkin, D. (1995). A robust algorithm for pitch tracking (RAPT). In Kleijn,
  W. B., Paliwal, K. K. (eds.), Speech Coding and Synthesis. Elsevier.
- de Cheveigné, A., Kawahara, H. (2002). YIN, a fundamental frequency
  estimator for speech and music. JASA 111(4), 1917-1930.
  doi:10.1121/1.1458024
- Mauch, M., Dixon, S. (2014). pYIN: a fundamental frequency estimator using
  probabilistic threshold distributions. ICASSP, 659-663.
  doi:10.1109/ICASSP.2014.6853678
- Camacho, A., Harris, J. G. (2008). A sawtooth waveform inspired pitch
  estimator for speech and music. JASA 124(3), 1638-1652.
  doi:10.1121/1.2951592
- Chu, W., Alwan, A. (2009). Reducing f0 frame error of f0 tracking
  algorithms under noisy conditions with an unvoiced/voiced classification
  frontend. ICASSP. doi:10.1109/icassp.2009.4960497
- Viterbi, A. (1967). Error bounds for convolutional codes and an
  asymptotically optimum decoding algorithm. IEEE Trans. Information Theory
  13(2). doi:10.1109/tit.1967.1054010
- Research notes:
  `docs/case-studies/issue-11/research/2-inversion-and-recognition.md`.
