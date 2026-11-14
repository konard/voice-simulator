---
id: P40
title: Vocal effort and loudness dynamics
type: Feature
milestone: M3
blocked_by: [P38]
requirements: [R17, R5, R7]
---

## Goal

Make `mode.effort` of {{P38}} change the voice the way a speaker does when
going from soft speech to a shout: not only the level, also pitch, spectral
tilt, the first formant and vowel length. Add ramps (crescendo, diminuendo),
a Lombard preset, a level convention and protection against clipping.

## Why

A recording that is only turned up does not sound shouted. Listeners, and
later {{P59}}, tell effort from the spectrum, pitch and vowels, because the
absolute level depends on the microphone distance. Emotions ({{P43}}) are
built on effort.

## Current state

Loudness is one plan channel, `channels.loudness`. The only rule is the
register of `!` in `src/articulation/prosody.js`:

```js
exclamation: { shift: 1.5, range: 1.3, gain: 1.41 },
```

so `Come here!` has peak loudness 1.41 (+3 dB) and starts at 161 Hz instead
of 141 Hz. `head.outputGain` changes the level only. Measured with
`node experiments/issue-11-audit-m3b.mjs` (level in dB re full scale, F1 in
Hz, H1-H2 in dB):

```
outputGain 0.5: levelDb -18.8  f0 127  f1 420  h1h2 3.82
outputGain 1:   levelDb -13.6  f0 127  f1 420  h1h2 3.84
outputGain 2:   levelDb  -9.3  f0 127  f1 430  h1h2 3.92
tenseness 0 -> 1: h1h2 13.18 -> -4.29, levelDb -14.4 -> -12.9
```

A gain of 2 gives +4.3 dB, not +6 dB, because the output stage in
`src/acoustics/voice.js` ends with `Math.tanh(output * this.gain)`: a louder
source is squashed. `head.tenseness` is the only knob for spectral tilt and
it is one constant per voice. After {{P38}}, effort is a plain gain limited
to -20…+6 dB.

## What to do

Write `E` for effort in decibels: `E = (effort - 0.5) * 40`, from -20 to +20.

1. Create `src/articulation/effort.js` with `EFFORT_RULES` and
   `effortChanges(E, head)`. The rules (linear between the listed points):

   | Quantity                 | Rule                                                  | -10 dB (soft) | +10 dB (loud) | +20 dB (shout) | Source                                                   |
   | ------------------------ | ----------------------------------------------------- | ------------- | ------------- | -------------- | -------------------------------------------------------- |
   | level of voiced sound    | `E` dB                                                | -10 dB        | +10 dB        | +20 dB         | definition                                               |
   | lung pressure factor     | `2^(E/9)`                                             | 0.46          | 2.16          | 4.67           | Titze & Sundberg (8-9 dB per doubling)                   |
   | pitch                    | `head.pitch + 5 * E` Hz, limited to -4…+12 st         | -4 st         | +6.0 st       | +10.5 st       | Liénard & Di Benedetto: +5 Hz/dB                         |
   | F1 of vowels             | `+3.5 * E` Hz; F2 and F3 unchanged                    | -35 Hz        | +35 Hz        | +70 Hz         | Liénard & Di Benedetto                                   |
   | spectral tilt            | level above 1 kHz gains `0.2 * E` dB over level below | 2 dB steeper  | 2 dB flatter  | 4 dB flatter   | Liénard & Di Benedetto (F3 gains 2 dB over F1 per 10 dB) |
   | vowel duration           | factor 1, 1.1, 1.3 at 0, +10, +20 dB; 1 below 0 dB    | 1             | 1.1           | 1.3            | research notes (proposal)                                |
   | consonant duration       | unchanged                                             | 1             | 1             | 1              | research notes (proposal)                                |
   | noise (frication, burst) | `0.5 * E` dB                                          | -5 dB         | +5 dB         | +10 dB         | project choice, to be tuned                              |

   The pitch column is for `head.pitch` 120 Hz; for 200 Hz the same rule
   gives +3.9 st and +7.0 st. The caps and the duration factors are
   proposals of the research notes, not measurements.

2. Add two plan channels in `src/articulation/plan.js` (skip the one that
   {{P42}} already added): `effort` (dB, default 0, time constant 0.05 s) and
   `tension` (offset on `head.tenseness`, default 0, time constant 0.03 s).
   Fill `effort` from `plan.modes`: inside a span it runs in a straight line
   from `E(effort)` at `start` to `E(effortEnd)` at `end`. Remove the
   temporary gain of {{P38}} step 8 for effort (keep it for `mode.gain`).

3. Realise the rules from the `effort` channel:
   - level: in `Glottis.step()` multiply the voiced part by `10^(E/20)` and
     the aspiration noise by `10^(0.5*E/20)`; in `#fricationNoise()` of
     `voice.js` multiply by `10^(0.5*E/20)`. Pass `effort` and `tension`
     through `glottis: { … }` in `src/articulation/tract-shape.js`.
   - tilt: `tension = TENSION_PER_DB * E` with start value 0.005; in
     `Glottis.step()` use `this.tenseness + control.tension`, clamped to 0…1.
     Tune `TENSION_PER_DB` until the tilt test below passes.
   - pitch: add the semitone shift of the table in `fillPitch()`.
   - F1: lower `channels.height` in vowels by `HEIGHT_PER_DB * E` (start
     value 0.004; if {{P28}} is merged, open its jaw channel instead). Tune
     until the F1 test passes.
   - duration: multiply in `vowelDuration()` with the factor at the vowel's
     `token.mode.effort`.

4. Ramps. `<vs:effort value="0.25" to="0.75">`, `{crescendo … crescendo}` and
   `{diminuendo … diminuendo}` already set `effortEnd`. Add the inline tags
   `[crescendo]…[/crescendo]` and `[diminuendo]…[/diminuendo]` to
   `src/markup/inline.js` (`effortEnd` = effort ± 0.25, as in IPA). A ramp is
   linear in dB. Natural ramps are 5 to 10 dB/s (proposal); add a warning
   when a span asks for more than 40 dB/s.

5. Lombard preset: `<vs:effort level="lombard">` and `[lombard]` mean effort
   0.75 with one difference: only vowels with primary stress are lengthened
   (speech in noise lengthens content words more than function words). It is
   written `{f … f}` in IPA.

6. Protection against clipping, in `src/synthesize.js`. Let `Emax` be the
   largest value of `E + mode.gain` in the plan, at least 0. Multiply the
   output gain by `10^(-Emax/20)` for the whole utterance and return
   `levelOffsetDb = -Emax` in the result. So a text without loud spans is
   identical to today, and the loudest span of any text has today's level.
   Option `headroom: <dB>` uses that fixed number instead of `Emax`; use it
   when several utterances must be comparable. Replace nothing in the
   `tanh` stage.

7. Level convention, in `docs/markup.md`: effort 0.5 stands for 60 dB SPL at
   1 m (textbook value for conversational speech), so
   `effortToSpl(effort) = 60 + E`; export `effortToSpl` and `splToEffort`.
   Add `integratedLoudness(samples, sampleRate)` in `src/analysis/loudness.js`
   after ITU-R BS.1770 (K-weighting, 400 ms blocks, gates at -70 LUFS and
   -10 LU; take the filter from the recommendation). Add the option
   `loudnessTarget` (LUFS, for example -23 as in EBU R 128) to
   `synthesize()` and `--loudness <LUFS>` to the CLI: the finished samples
   are scaled to the target, but never above a peak of 0.98. Not available
   for streams.

8. If {{P21}} is already merged: set its lung pressure to the normal value
   times `2^(E/9)` and remove the level and tilt rules of step 3 (the fold
   model must produce them); keep the F1, duration and noise rules; reduce
   the pitch rule by the pitch rise the fold model already gives, measured
   on `ˈa`. The tests below stay the same. If it is not merged, do nothing.

9. Create `src/analysis/mode-features.js` if it does not exist yet,
   otherwise add to it: `levelDb(samples, from, to)` (RMS in dB re full
   scale) and `alphaRatio(samples, sampleRate, from, to)` (level of
   1-5 kHz minus level of 50 Hz-1 kHz, in dB).

How a mode is written and recognised:

| Text / SSML                                       | IPA           | Correlates {{P59}} can measure                |
| ------------------------------------------------- | ------------- | --------------------------------------------- |
| `[soft]`, `<prosody volume="soft">`               | `{p … p}`     | alpha ratio -2 dB, pitch -4 st re the speaker |
| `[loud]`, `[lombard]`, `<vs:effort level="loud">` | `{f … f}`     | alpha ratio +2 dB, pitch +6 st, F1 +35 Hz     |
| `[shout]`                                         | `{ff … ff}`   | alpha ratio +4 dB, pitch +10 st, F1 +70 Hz    |
| `[crescendo]`, `to="…"`                           | `{crescendo}` | the same measures rising inside the span      |
| `vs:gain="-6dB"` on `prosody`                     | not written   | level only; not recognisable                  |

## Tests

Create `tests/effort.test.js`. Render `Please call Stella.` with tier
`medium`, `seed: 1`, `markup: true`, `headroom: 20`, as plain text and inside
`[soft]`, `[loud]` and `[shout]`. Compare with the plain version:

- `changes the level by the effort`: `levelDb` differs by -10 ± 1.5, +10 ±
  1.5 and +20 ± 2 dB.
- `raises the pitch with effort`: median f0 of `analyzeVoice()` is -4 ± 1,
  +6 ± 1 and +10.5 ± 1.5 st.
- `flattens the spectrum with effort`: `alphaRatio` differs by -2 ± 1, +2 ± 1
  and +4 ± 1.5 dB; H1-H2 of `[shout]` is at least 3 dB below plain.
- `raises the first formant`: F1 of `ˈa` (IPA input, 300 ms) moves by +35 ±
  15 Hz inside `{f … f}` and +70 ± 25 Hz inside `{ff … ff}`.
- `lengthens vowels, not consonants`: summed vowel duration × 1.1 ± 0.03
  (loud) and × 1.3 ± 0.05 (shout); summed consonant duration within 2 %.
- `keeps a plain gain plain`: `<prosody vs:gain="-6dB">` changes `levelDb` by
  -6 ± 0.5 dB and `alphaRatio` by less than 0.3 dB.
- `ramps a crescendo`: in `[crescendo]la la la la la la[/crescendo]` the
  level of each vowel is higher than the one before; last minus first is
  10 ± 2 dB.
- `does not clip`: for `[shout]Please call Stella.[/shout]` without
  `headroom`, fewer than 0.1 % of the samples exceed 0.9 and
  `levelOffsetDb` is -20.
- `measures loudness`: `integratedLoudness` of a 997 Hz sine with amplitude
  1 is -3.01 ± 0.1 LUFS; with `loudnessTarget: -23` the result measures
  -23 ± 0.5 LUFS.
- `reads the same from IPA`: `{ff ˈpliz ff}` and `[shout]please[/shout]`
  give equal `plan.channels.effort`.

## Acceptance criteria

- [ ] All thresholds of `tests/effort.test.js` hold on Node.js, Bun and Deno.
- [ ] Text without markup gives the same samples as before this change.
- [ ] `voice-simulator say --markup "[shout]Hey![/shout]" --out hey.wav`
      writes a file whose peak is below 0.98.
- [ ] `docs/markup.md` has the table of step 1 and the level convention.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- The fold model and lung pressure themselves: {{P21}}.
- Whisper (the lowest end of the continuum has no voicing): {{P41}}.
- Pressed, breathy and other phonation types: {{P42}}.
- Recognising effort from audio: {{P59}}.
- Automatic Lombard speech from a measured noise level.

## References

- Liénard, J.-S., Di Benedetto, M.-G. (1999). Effect of vocal effort on
  spectral properties of vowels. JASA 106(1), 411-422.
- Titze, I. R., Sundberg, J. (1992). Vocal intensity in speakers and
  singers. JASA 91(5), 2936-2946.
- Traunmüller, H., Eriksson, A. (2000). Acoustic effects of variation in
  vocal effort by men, women, and children. JASA 107(6), 3438-3451. (Not
  used for numbers: its slopes were not checked.)
- Sundberg, J., Nordenberg, M. (2006). Effects of vocal loudness variation
  on spectrum balance as reflected by the alpha measure of long-term-average
  spectra of speech. JASA 120(1), 453-457.
- ITU-R BS.1770, Algorithms to measure audio programme loudness and
  true-peak audio level; EBU R 128, Loudness normalisation.
- Research notes:
  `docs/case-studies/issue-11/research/4-linguistics-and-speech-modes.md`.
