---
id: P43
title: Emotions and attitudes
type: Feature
milestone: M3
blocked_by: [P39, P40, P42, P08]
requirements: [R17, R5, R18]
---

## Goal

Make `mode.emotion` of {{P38}} audible. An emotion is not a new sound source:
it is a rule table that sets pitch level, pitch range, pitch movement, rate,
pauses, effort ({{P40}}), phonation ({{P42}}) and articulation precision.
Provide twelve named presets, three free dimensions, an intensity from 0 to
1, and a listening test that shows listeners can name the emotion.

## Why

The issue asks for all modes of speech, including emotions, without neural
networks. Rule tables for formant synthesisers exist in the literature and
were verified with listeners; the simulator has every knob they need once
{{P39}}, {{P40}} and {{P42}} are merged.

## Current state

There is no emotion anywhere in `src/`. The only expressive rule is the
register of `!` and of brackets in `src/articulation/prosody.js`
(`exclamation: { shift: 1.5, range: 1.3, gain: 1.41 }`). After {{P38}},
`<vs:emotion name="angry">`, `[angry]` and the three dimensions are parsed
into `plan.modes` and carried, but nothing is heard. There is no IPA symbol
for an emotion; it travels only in the `modes` list.

What to expect, from the research notes: listeners name the emotion of
human actors in 72 to 91 % of the cases (Pell et al. 2009); rule-based
formant synthesis reaches 50 to 80 % (Schröder 2001). Rule-based emotion is
recognisable but less clear than an actor. Say so in the documentation.

## What to do

1. Create `src/articulation/emotion.js` with the table `EMOTIONS` and
   `emotionChanges(emotion)`, which returns an object with the keys
   `pitch`, `range`, `rate`, `effort`, `phonation`, `pauses`, `precision`,
   `smile`, `glide`, `finalRise` and `stressLength`. Values at `intensity`
   1:

   | Name        | Pitch st | Range × | Rate × | Effort | Phonation      | Other                                | Source    |
   | ----------- | -------- | ------- | ------ | ------ | -------------- | ------------------------------------ | --------- |
   | `neutral`   | 0        | 1       | 1      | 0.5    | none           | none                                 |           |
   | `angry`     | +7.0     | 3       | 1.3    | 0.75   | `tension` 0.5  | `glide` -30 st/s, `precision` +1     | B&S       |
   | `happy`     | +7.0     | 2       | 1.3    | 0.6    | none           | `glide` +50 st/s, `smile` 1          | B&S       |
   | `sad`       | -3.9     | 0.8     | 0.6    | 0.35   | `breathy` 0.5  | `pauses` 1.5                         | B&S       |
   | `afraid`    | +15.9    | 1.2     | 1.3    | 0.5    | `falsetto` 0.5 | `finalRise` 30 st/s, jitter + 2 %    | B&S       |
   | `bored`     | -3.9     | 0.5     | 0.8    | 0.4    | `tension` -0.5 | `stressLength` 1.4, `precision` -1   | B&S       |
   | `surprised` | +8       | 2.5     | 0.93   | 0.6    | none           | `finalRise` 30 st/s                  | Pell, own |
   | `disgusted` | +1       | 1.3     | 0.67   | 0.5    | `creaky` 0.3   | `stressLength` 1.2                   | Pell, own |
   | `tender`    | -2       | 0.8     | 0.85   | 0.3    | `breathy` 0.4  | none                                 | own       |
   | `sarcastic` | -2       | 0.6     | 0.8    | 0.5    | none           | `stressLength` 1.3, `glide` -15 st/s | own       |
   | `confident` | -1       | 1.2     | 1      | 0.6    | `tension` 0.2  | `pauses` 0.8, `precision` +0.5       | own       |
   | `hesitant`  | 0        | 0.8     | 0.85   | 0.4    | none           | `pauses` 2, `finalRise` 15 st/s      | own       |

   "B&S" rows are the settings Burkhardt & Sendlmeier (2000) found best
   recognised with a formant synthesiser: f0 +50 % is +7.0 st, -20 % is
   -3.9 st, +150 % is +15.9 st; range +200 % is × 3; rate -40 % is × 0.6;
   anger also has stressed syllables + 9 dB (here: effort 0.75, which is
   - 10 dB), tense voice 50 % and vowel overshoot 30 %; boredom has
     stressed syllables 40 % longer, lax voice and undershoot 20 %. "Pell"
     rows take rate and the order of pitch level and range from Pell et al.
     (2009): surprise has the highest pitch and widest range, disgust the
     slowest rate (3.20 against 4.75 syllables/s). The rest of those rows and
     all "own" rows are project choices: the research notes found no verified
     table for disgust voice quality, tenderness, irony or the attitudes.
     Mark them `verified: false` in the table and in the documentation.

2. Intensity `i` (0…1): semitones × `i`; factors `f^i`; effort
   `0.5 + (e - 0.5) * i`; degrees × `i`; slopes × `i`.

3. Dimensions. When `name` is `neutral` and a dimension is not 0, compute
   the changes from `arousal` (A), `valence` (V), `dominance` (D), each
   -1…1:

   | Quantity  | Rule                                                  | Basis                                                |
   | --------- | ----------------------------------------------------- | ---------------------------------------------------- |
   | pitch     | `12 * log2(1 + 0.32 * A) - 2 * D` st                  | Schröder et al. 2001: 140.3 Hz + 0.452 Hz per unit A |
   | range     | × `max(0.3, 1 + 1.15 * A)`                            | same: 21.6 Hz + 0.248 Hz per unit A                  |
   | effort    | `0.5 + 0.25 * A`                                      | same: spectral slope flatter with A; size is own     |
   | rate      | × `1 + 0.2 * A`                                       | direction from Schröder et al.; size is own          |
   | pauses    | × `1 - 0.3 * A`                                       | same                                                 |
   | `smile`   | `max(0, V)`                                           | own (lip spreading: B&S joy)                         |
   | `glide`   | `30 * V` st/s                                         | own (B&S: rises for joy, falls for anger)            |
   | phonation | `tension` = `0.4 * D`; `breathy` = `max(0, -0.4 * D)` | own                                                  |

   The paper uses a scale of -100…+100; one unit here is 100 of theirs.
   Store coordinates with each preset for output and for {{P59}}: from the
   paper `happy` (0.29, 0.40, 0.13), `angry` (0.35, -0.35, -0.34), `afraid`
   (0.31, -0.27, -0.79), `sad` (-0.09, -0.43, -0.55); own choices for the
   others. A named preset uses its row of step 1, not these rules.

4. Apply in `planUtterance()` before the other modes are realised: for each
   span, compose `emotionChanges()` as if it were an outer span
   (`composeMode(changes, span)`), so `[angry][soft]…` stays soft.
5. The fields that are new:
   - `pauses`: factor on every pause inside the span.
   - `stressLength`: factor on vowels with primary stress.
   - `glide`: inside each vowel with primary stress add a straight pitch
     movement of `glide` st/s around the middle of the vowel, limited to
     ± 3 st in total. `finalRise`: the same on the last vowel of the span.
   - `precision` `p`: move the `height` and `backness` targets of vowels
     away from the values of `ə` by the factor `1 + 0.3 * p` (`p` > 0) or
     `1 + 0.2 * p` (`p` < 0).
   - `smile` `s`: spread the lips (lower `rounding` by `0.3 * s`, widen
     `lipArea` by 30 % × `s`); tune until F2 of `ˈa` rises by 5 to 10 %.
6. Document in `docs/markup.md`: the two tables, which rows are verified,
   and the sentence about expectations from Current state.
7. Listening test. Add to the harness of {{P08}} the trial type
   `{ "type": "choice", "id", "audio", "choices": [...], "answer" }`, the
   result `{ id, type, chosen, correct, plays, seconds }`, and in `analyze`
   a confusion matrix plus `binomialTailP(correct, total, p)` for a chance
   level `p`. Add `examples/listening-test/emotions.sentences.json`: two
   neutral sentences per language (`en`: `The train leaves at seven.`,
   `I will see you on Monday.`; translate for `ru`, `hi`, `zh`), each in
   `neutral`, `happy`, `sad`, `angry`, `afraid`, `bored` at intensity 1,
   six choices per trial (chance 16.7 %).

How the mode is written and recognised:

| Text / SSML                                 | IPA         | Correlates {{P59}} can measure          |
| ------------------------------------------- | ----------- | --------------------------------------- |
| `[angry]`, `[angry 0.8]`                    | not written | pitch level, range and rate against the |
| `<vs:emotion name="sad" intensity="0.5">`   | (`modes`    | speaker's neutral; H1-H2; alpha ratio   |
| `<vs:emotion arousal="0.5" valence="-0.3">` | list only)  | of {{P40}}; pause share                 |

## Tests

Create `tests/emotion.test.js`. Render `The train leaves at seven.` (tier
`medium`, `seed: 1`, `markup: true`, `headroom: 20`) plain and inside each
tag at intensity 1. Compare with plain (`analyzeVoice()`; st = semitones):

- `angry`: median f0 +7 ± 1.5 st plus the effort shift of {{P40}}; f0 range
  ≥ 2 × plain; duration 0.7 to 0.9 × plain; H1-H2 ≥ 3 dB lower.
- `happy`: median f0 ≥ +6 st; range ≥ 1.6 × plain; F2 of `[happy]` `ˈa`
  5 to 10 % higher.
- `sad`: median f0 -3.9 ± 1 st; range ≤ 0.9 × plain; duration ≥ 1.5 ×
  plain; H1-H2 ≥ 2 dB higher; level ≥ 4 dB lower.
- `afraid`: median f0 ≥ +12 st; the last vowel ends ≥ 2 st above its start.
- `bored`: median f0 -3.9 ± 1 st; range ≤ 0.6 × plain; stressed vowels
  ≥ 1.3 × longer.
- `are all different`: over the vector (median f0 in st, range factor,
  duration factor, H1-H2 difference in dB / 3) every pair of the twelve
  presets is at least 1.0 apart (Euclidean distance).
- `scales with intensity`: `[angry 0.33]`, `[angry 0.67]`, `[angry]` give
  strictly rising median f0, and `[angry 0]` equals plain sample by sample.
- `maps the dimensions`: `arousal="1"` gives median f0 +4.8 ± 1 st plus the
  effort shift; `arousal="-1"` gives a lower f0 and a longer duration than
  plain.
- `lets an inner tag win`: `[angry][soft]x[/soft][/angry]` has
  `plan.modes[…].effort` 0.25.
- `analyses a choice trial`: 12 right of 20 with six choices gives
  `binomialTailP` below 0.001.

## Acceptance criteria

- [ ] All thresholds of `tests/emotion.test.js` hold on Node.js, Bun and
      Deno.
- [ ] Text without an emotion gives the same samples as before.
- [ ] The command `node scripts/listening-test.mjs build` with
      `--sentences examples/listening-test/emotions.sentences.json` and
      `--out examples/listening-test` builds 48 choice trials.
- [ ] A listening test with at least 10 listeners (20 or more answers per
      emotion and language) is reported in
      `docs/listening-tests/emotions.md` with the confusion matrix: every
      one of the six emotions is named correctly in ≥ 40 % of its trials
      (chance 16.7 %; 8 of 20 has a guessing probability below 0.02) and
      the mean is ≥ 50 %. If no listeners are available, leave this box
      open and say so in the pull request; do not replace it by a guess.
- [ ] `docs/markup.md` lists the presets with their `verified` flag.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- Laughing or sobbing while speaking: sounds are {{P44}}.
- Recognising emotion from audio: {{P59}}.
- Choosing an emotion from the meaning of the text.
- Verified tables for tenderness, irony, contempt and disgust voice quality:
  none was found; improve the rows when a source is read.

## References

- Burkhardt, F., Sendlmeier, W. (2000). Verification of acoustical
  correlates of emotional speech using formant-synthesis. ISCA Workshop on
  Speech and Emotion.
- Schröder, M. (2001). Emotional speech synthesis: a review. Eurospeech 2001. (Also the source for Murray & Arnott 1993 and Banse & Scherer 1996,
  whose own tables were not opened.)
- Schröder, M., Cowie, R., Douglas-Cowie, E., Westerdijk, M., Gielen, S.
  (2001). Acoustic correlates of emotion dimensions in view of speech
  synthesis. Eurospeech 2001.
- Pell, M. D., Paulmann, S., Dara, C., Alasseri, A., Kotz, S. A. (2009).
  Factors in the recognition of vocally expressed emotions: a comparison of
  four languages. Journal of Phonetics 37, 417-435.
- Emotion Markup Language (EmotionML) 1.0: https://www.w3.org/TR/emotionml/
- Research notes:
  `docs/case-studies/issue-11/research/4-linguistics-and-speech-modes.md`.
