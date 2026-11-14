---
id: P59
title: Recognise loudness, whisper, voice quality and emotion
type: Feature
milestone: M4
blocked_by: [P49, P40, P41, P42, P43, P05]
requirements: [R6, R17, R18, R19]
---

## Goal

Recognition says how something was spoken, not only what: soft or loud,
whispered, breathy, creaky, pressed, falsetto, harsh, fast or slow, and with
which emotion. The answer is a list of spans in `result.modes` and the same
ExtIPA/VoQS brace marks in `result.ipa` that the synthesiser reads
(`{f … f}`, `{W … W}`, `{V̤ … V̤}`), so that speaking the result again gives
the same manner of speech.

## Why

The issue asks for volume, whisper, emotions and "all common modes of
speech" for input as well as output. {{P40}} to {{P43}} make the synthesiser
speak these modes; each of them lists the measurable signs of its mode. This
issue reads those signs back. Copying a recording ({{P67}}) needs them.

## Current state

- After {{P61}}, `recognize` returns `modes: []`. {{P58}} (if merged) adds
  spans for emphasis and sentence tunes and fixes the span shape.
- `analyzeVoice` in `src/analysis/voice-features.js` gives one value per
  recording for `f0`, `h1h2`, `hnr` and others. It gives nothing over time.
- After {{P40}}, {{P41}} and {{P42}}, `src/analysis/mode-features.js` has
  `levelDb`, `alphaRatio`, `voicedShare`, `energyRatio`, `centreOfGravity`,
  `cpp` and `jitterPercent`, and each of those issues has a table "How the
  mode is written and recognised" with target values. After {{P49}},
  `inverseFilter` gives the measures of the voice source per frame.
- The absolute level of a recording says nothing about effort: it depends
  on the microphone and its distance. The research notes (file 4) give the
  usable signs: spectral tilt, checked with pitch (5 Hz per dB) and F1
  (3.5 Hz per dB) for effort; H1-H2 with HNR and CPP for breathy voice;
  pitch below about 70 Hz or jitter above 5 % for creak.
- Emotion: the same notes say that activation (calm or excited) can be
  heard from prosody, that people name one of 7 emotions from prosody alone
  about 58 % right (Pell et al. 2009), and that pleasant or unpleasant is
  hard to hear. No public-domain recordings of emotions or whisper exist.

## What to do

Create `src/recognition/modes.js` exporting
`recognizeModes(samples, sampleRate, result, options)`. It returns a copy of
`result` (shape of `recognize`) with `modes` and `ipa` filled in.

1. Span shape, as in {{P58}}: the shape of `plan.modes` of {{P38}} plus four
   keys. Example:

   ```text
   { start: 0.4, end: 1.9, from: 1, to: 5, effort: 0.75,
     notation: 'f', confidence: 0.8 }
   ```

   `start`, `end` in seconds; `from`, `to` are indexes into
   `result.words` (`to` exclusive); then only the decided keys of the mode
   object of {{P38}}; `notation` is the brace label or `null` when IPA has
   none (emotion); `confidence` is 0 to 1.

2. Baseline: what this speaker sounds like in a normal voice.
   - With `options.voice` (a voice of {{P29}} or {{P51}}): synthesise
     `tests/fixtures/recognition/baseline.txt` (one neutral sentence per
     language, write it here) with that voice at the tier that matches
     `sampleRate` and measure the features of step 3. Cache by voice.
   - Without it: the median of each feature over the utterance. Then only
     changes inside the utterance and the signs that need no baseline
     (whisper, creak, falsetto) can be reported. Do not guess the rest.
3. Features per word, from the frames of its vowels (`analyzeFrames`,
   `trackPitch`, `trackFormants`, `inverseFilter`, `mode-features.js`):
   `alpha` (alpha ratio, dB), `pitch` (median, Hz and semitones re the
   baseline), `f1` (mean F1 minus the baseline F1 of the same vowel, Hz;
   `null` without `options.voice`), `voiced` (voiced share of the vowel
   frames), `h1h2` (corrected for formants, dB), `hnr` (dB), `cpp` (dB),
   `jitter` (%), `rate` (syllables per second of the word and its two
   neighbours). `d` before a name below means "minus the baseline".
4. Effort in decibels (inverse of `EFFORT_RULES` of {{P40}}):
   `Etilt = dalpha / 0.2`, `Epitch = dpitch in Hz / 5`, `Ef1 = df1 / 3.5`;
   `E = 0.6 * Etilt + 0.2 * Epitch + 0.2 * Ef1` (without `f1`: 0.75 and
   0.25); `effort = clamp(0.5 + E / 40, 0, 1)`, rounded to the nearest of
   0, 0.25, 0.5, 0.75, 1. `confidence = max(0, 1 - |Etilt - Epitch| / 20)`.
5. Label per word, first rule that fits (start values; tune with the tests):

   | Rule                                                     | Keys                     | Label                |
   | -------------------------------------------------------- | ------------------------ | -------------------- |
   | `voiced < 0.05` and energy ratio 6 dB above the baseline | `phonation.whisper: 1`   | `W`                  |
   | median pitch below 70 Hz                                 | `phonation.creaky: 1`    | `C`                  |
   | `dpitch >= 10` st and `h1h2 >= 8`                        | `phonation.falsetto: 1`  | `F`                  |
   | `h1h2 < 0`, `dhnr <= -3`, `jitter >= 3`                  | `phonation.harsh: 1`     | `V!`                 |
   | `jitter >= 5`, and `h1h2 < 0` or `dpitch <= -8` st       | `phonation.creaky`       | `V̰`                  |
   | `dh1h2 <= -3` and `dhnr >= -2`                           | `phonation.tension: 1`   | `V͈`                  |
   | `dh1h2 >= 1` and (`dcpp <= -1` or `dhnr <= -3`)          | `phonation.breathy`      | `V̤`                  |
   | voiced, `hnr < 10`, `dhnr <= -4`                         | `phonation.whisper: 0.5` | `Ṿ`                  |
   | `dh1h2` between 2 and 5, `dhnr` between -2 and 2         | `phonation.tension: -1`  | `V͉`                  |
   | `effort` of step 4 is not 0.5 and no row above fits      | `effort`                 | `pp`, `p`, `f`, `ff` |
   | `rate / baseline rate >= 1.2` (may be added to any row)  | `rate: 1.3`              | `allegro`            |
   | `rate / baseline rate <= 0.83` (may be added to any row) | `rate: 0.75`             | `lento`              |

   Degree of breathy and creaky voice: `d = clamp(dh1h2 / 3.2, 0, 1)`
   (breathy) or `clamp(jitter / 5, 0, 1)` (creaky), rounded to 0.33, 0.67
   or 1 and written as `{1V̤`, `{V̤`, `{3V̤`. Use the key names and signs
   that {{P42}} really has; this table uses those of {{P38}}.

6. From words to spans: join neighbouring words with the same label. One
   word between two words with the same label takes their label. A span
   shorter than 0.3 s is dropped, except whisper. Inside a span of 4 words
   or more with a label of effort, fit a line to `E` over time: a change of
   8 dB or more gives `crescendo` (rising) or `diminuendo` instead.
7. Whisper spans: use `findWhisper` of `src/recognition/whisper.js` when
   that file exists ({{P60}}); otherwise the first row of the table.
8. Emotion, per phrase (words between pauses of 0.2 s or more):
   1. Vector: pitch level (st), pitch span (95th minus 5th percentile, st),
      `rate` ratio, `E`, `dh1h2`, `dhnr`; each minus the baseline and
      divided by its scale: 2 st, 2 st, 0.15, 5 dB, 3 dB, 3 dB.
   2. Reference vectors: on first use, synthesise the baseline sentence
      once per emotion name of {{P43}} at intensity 1 with the baseline
      voice and measure the same vector. No trained model is used.
   3. `activation` = mean of the first four components divided by 2, cut
      to -1…1. Always reported when `|activation| >= 0.3`, as
      `emotion: { arousal: activation }`.
   4. Name: the nearest reference by Euclidean distance `near`; `next` is
      the second nearest. Report `emotion.name` only when
      `near <= 0.6 * (length of the vector)` and `near <= 0.8 * next`;
      `intensity` = length of the vector divided by the length of the
      reference, cut to 0…1; `confidence = 1 - near / next`.
   5. When a name is reported, drop the effort, rate and phonation spans of
      that phrase which the emotion preset of {{P43}} itself produces
      (same key, value within one step), so that speaking the result again
      does not apply them twice. `notation` is `null`.
9. Sounds, only when {{P44}} is merged: a noise of 0.3 to 0.7 s inside a
   pause is `⸨inhale⸩`; 3 or more bursts of voice at 4 to 6 per second are
   `⸨laugh⸩`; a steady `ə`-like vowel longer than 0.2 s next to a pause is
   `⸨filler⸩`. Add the token to `ipa`, and to `modes` a span
   `{ start, end, sound, notation, confidence }`.
10. Write `ipa`: wrap the words of every span that has a label in
    `{label … label}`, with `formatIpa` of {{P38}}. Export
    `toPlanModes(modes)`: it returns `[{ from, to, mode }]` for
    `planUtterance(ipa, { modes })`, including the spans without a label.
11. What cannot be decided is left out. Never report an emotion name, an
    effort or a voice quality for a phrase with fewer than 3 vowels.
12. Wiring: if `src/recognition/recognizer.js` exists, call
    `recognizeModes` after the text step when the option `modes` is not
    `false`, and pass the option `voice` on; otherwise {{P61}} adds the
    call. In `tests/heavy/roundtrip-*.test.js` of {{P63}}, if merged, add
    the gates of the acceptance criteria. Export from `src/index.js`, add
    types, and describe the span shape in `README.md`.

## Tests

`tests/recognition-modes.test.js`. Audio from
`synthesize(text, { markup: true })` at tier `minimal`, seed 1, preset
`male`; `options.voice` is that preset; word times come from `timeline`.
One sentence per language.

- `finds no mode in plain speech`: 8 plain sentences: `modes` has no span of
  effort, phonation, rate or emotion.
- `hears each label`: the 4 sentences spoken whole in each of `pp`, `p`,
  `f`, `ff`, `W`, `V̤`, `V̰`, `C`, `V͈`, `V͉`, `F`, `V!`, `Ṿ`, `allegro`,
  `lento`: whisper 100 % right; effort exact in at least 80 % and within
  one step in 95 %; the other labels at least 85 %. Print the confusions.
- `finds where a mode starts`: `one two three [loud] four five six`: the
  span starts at word 3, give or take one word.
- `hears a crescendo`: a sentence in `[crescendo]`: label `crescendo`.
- `hears activation`: `angry`, `happy`, `afraid`, `surprised` give
  `arousal > 0`; `sad`, `bored`, `tender` give `arousal < 0`: 95 % right.
- `names the emotion`: the 12 names of {{P43}}, 4 sentences each: at least
  75 % right. Names whose reference vectors lie closer than 1 to each other
  count as one class; list them in the test and in the pull request.
- `does not guess without a baseline`: the `f` sentences without
  `options.voice` give no effort span; `W`, `C` and `F` are still found.
- `works at 8 kHz`: `hears each label` after `resample` to 8000 Hz:
  whisper 100 %, the other labels at least 70 %.
- `speaks what it heard`: recognise, speak again with
  `planUtterance(result.ipa, { modes: toPlanModes(result.modes) })`,
  recognise again: the same labels on the same words.

`tests/heavy/recognition-modes.test.js` (suite `recognition`, only when
{{P02}} and {{P04}} are merged): add RESD (Hugging Face `Aniemore/resd`,
Russian, 7 emotions, licence `mit` in the dataset metadata) to the registry
under the rules of {{P04}}; map its labels to our names in a table in the
test; measure activation and name accuracy on the first 100 test rows and
on the golden set of {{P05}} (which must give no emotion and no whisper).

## Acceptance criteria

- [ ] `npm test` runs `tests/recognition-modes.test.js` and every threshold
      above holds on Node.js, Bun and Deno.
- [ ] Round trip, when {{P63}} is merged (otherwise that issue adds this
      gate): mode labels are right for at least 90 % of the spans at
      `wideband` and above and 75 % at `telephone`.
- [ ] If {{P61}} is merged: `voice-simulator say "[whisper] come here" -o w.wav`
      then `voice-simulator recognize w.wav --ipa` prints `{W … W}` marks.
- [ ] Real recordings: the heavy test writes activation and name accuracy
      on RESD and the false alarms on the golden set to
      `docs/reports/recognition-modes.md`. First gates, to be ratcheted:
      the measured values minus 5 points; at most 1 golden sentence in 24
      with a whisper or emotion span.
- [ ] `grep -rn "onnx\|tensorflow\|torch" src/recognition package.json` prints
      nothing.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- Words spoken in a whisper: {{P60}}. Emphasis and sentence tunes: {{P58}}.
- Degrees of whisper (`{1W`, `{3W`), `gain`, `pitch` and `range` as plain
  settings, and who is speaking.
- Pleasant against unpleasant (valence) on its own, irony from the meaning
  of words, emotions of real speakers beyond the measured report.
- Fitting the baseline voice: {{P51}}, {{P66}}.

## References

- Research notes, the cue tables for effort, phonation, whisper, emotion
  and sounds:
  `docs/case-studies/issue-11/research/4-linguistics-and-speech-modes.md`;
  data sets with emotions: `docs/case-studies/issue-11/research/3-datasets.md`.
- Liénard, J.-S., Di Benedetto, M.-G. (1999). Effect of vocal effort on
  spectral properties of vowels. Journal of the Acoustical Society of
  America 106(1), 411-422.
- Carlin, M. A., Smolenski, B. Y., Wenndt, S. J. (2006). Unsupervised
  detection of whispered speech in the presence of normal phonation.
  Interspeech 2006.
- Pell, M. D., Paulmann, S., Dara, C., Alasseri, A., Kotz, S. A. (2009).
  Factors in the recognition of vocally expressed emotions: a comparison
  of four languages. Journal of Phonetics 37, 417-435.
