---
id: P58
title: Recognise tones, stress and sentence type
type: Feature
milestone: M4
blocked_by: [P54, P47, P37, P39]
requirements: [R6, R17, R18, R19]
---

## Goal

Recognition hears the melody of speech, not only the sounds: the four
Mandarin tones and the neutral tone, which syllable of a word is stressed,
which word is emphasised, and whether a sentence is a statement, a question
or an exclamation. The answers are written with the same IPA marks the
synthesiser reads (tone letters, `ˈ`, `ˌ`, `.`, `?`, `!`, `↗`, `↘`), and
`text` gets punctuation and capital letters.

## Why

The issue asks for tones, accents and intonation in both directions. Without
tones, Mandarin text cannot be chosen: `ma˥` (妈) and `ma˨˩˦` (马) differ
only in pitch. Without stress, Russian `за́мок` and `замо́к` are the same.
Without the sentence type, `recognize` can never return a question mark.

## Current state

- The synthesiser writes these marks: `textToIpa('Are you coming?')` gives
  `ˈɑɹ ˈju ˈkʌmɪŋ ?`; `Where are you?` gives `ˈwɛɹ ˈɑɹ ˈju ↘ ?`; `Stop!` gives
  `ˈstɑp !`; `你好吗？` gives `ni˧˥ xɑʊ˨˩ ma ?`.
- Tone letters come from `TONE_CONTOURS` in `src/g2p/pinyin.js`: `˥`, `˧˥`,
  `˨˩˦`, `˨˩` (half third tone), `˥˩`, and nothing for the neutral tone.
  `parseIpa` turns them into `token.tone`, a list of levels 1 to 5.
- Pitch of a tone is `(level - 3) * scale` semitones around the base pitch
  (`syllablePitch()` in `src/articulation/prosody.js`); {{P37}} replaces this
  by pitch targets that are approached during the syllable, and {{P39}} adds
  the tunes of sentences (`TUNES`, `FOCUS`) with their sizes in semitones.
- An exclamation is spoken 1.5 semitones higher, with 1.3 times the pitch
  range and 1.41 times the amplitude (`REGISTERS.exclamation`).
- Nothing reads these things from audio. After {{P47}}, `trackPitch` gives
  pitch and voicing per frame; after {{P54}}, `audioToIpa` gives sounds with
  times, without tones, stress or sentence marks.
- Reference points from the research notes: people identify the four tones
  of spoken Mandarin 96.4 % right (Jiao and Xu 2019); a 1994 statistical
  recogniser reached 86.34 % on continuous speech (Wang, Shieh, Chen);
  people tell Mandarin questions without a particle from statements only 51
  to 78 % right.

## What to do

Create `src/recognition/prosody.js` with two exported functions. The first
runs before `ipaToText` ({{P56}}), the second after it.

1. `measureProsody(samples, sampleRate, sounds, options)`. `sounds` is the
   list `{ ipa, start, end, confidence }` made from `audioToIpa`. It returns
   `{ sounds, pitch, median, range }` where every vowel sound gets two new
   fields, `tones` and `prominence`:
   1. Call `trackPitch`. Convert voiced frames to semitones relative to
      `median`, the median pitch of all voiced frames (or the pitch of
      `options.voice`). `range` is the 95th minus the 5th percentile, at
      least 4.
   2. Syllables: one per vowel sound (the nucleus); the syllable lasts from
      the nucleus start to the next nucleus start or to the next pause.
   3. Tones. For each syllable take the voiced frames from the nucleus start
      to the syllable end and resample them to 10 points. For each tone of
      `TONE_CONTOURS` (five shapes and the neutral tone) compute the curve
      the synthesiser would make: call the function of {{P37}} that turns
      the tone targets into a pitch curve, with the measured pitch at the
      first point as the starting pitch and `scale = range / 4`. The cost of
      a tone is the weighted root mean square difference in semitones,
      divided by 3 and cut at 1; the weight grows linearly from 0.5 at
      point 1 to 1.5 at point 10 (the end of a syllable is closest to its
      target). The neutral tone costs 0.3 less when the syllable is shorter
      than 60 % of the mean of its two neighbours.
      `tones` is `{ '˥': 0.1, '˧˥': 0.7, ... , '': 0.9 }`; with fewer than 3
      voiced frames it is `null`.
   4. Prominence. For each nucleus measure: duration; mean energy in dB;
      energy above 500 Hz minus energy below 500 Hz in dB; highest pitch in
      semitones. Turn each into a z-score over all nuclei of the utterance.
      `prominence = 0.4 * duration + 0.2 * energy + 0.2 * balance`
      `+ 0.2 * pitch`.
2. Let the word search use these fields (`src/recognition/ipa-to-text.js`):
   - for a candidate word of `zh`, the tone part of the sound distance is
     `0.5 * sound.tones[tone of the candidate]` when `tones` is not `null`;
   - for a candidate of `en` or `ru` with two or more syllables, add `0.3`
     when its syllable with primary stress is not the most prominent of its
     nuclei.
     If that file is not in the code base yet, skip this step and say so in
     the pull request and in a comment on the issue of {{P56}}.
3. `markProsody(result, measured, options)` takes a result in the shape of
   `recognize` and returns a new one:
   1. Tones: for `zh` words, `syllables[].ipa` and `word.ipa` carry the tone
      letters of the chosen word. For a word that is not in the lexicon,
      write the cheapest tone of `tones`.
   2. Stress: `syllables[].stress` is the stress of the chosen word. For a
      word that is not in the lexicon and has two or more syllables, the
      most prominent syllable gets `stress: 1` and `ˈ`.
   3. Phrases: cut the words at pauses of 0.2 s or more.
   4. For the last 250 ms of voiced frames of each phrase compute `rise`:
      the median of the last 3 frames minus the median of the first 3, in
      semitones. Also `level` (phrase median minus `median`), `span` (95th
      minus 5th percentile of the phrase) and `loud` (phrase energy minus
      utterance energy, dB).
   5. Decide the mark at the end of each phrase, first rule that fits:

      | Rule                                                                                                          | Mark  |
      | ------------------------------------------------------------------------------------------------------------- | ----- |
      | a word of the phrase is a wh-word (`isWhWord` of the language)                                                | `↘ ?` |
      | `zh`: the last word is `吗`; `hi`: the first word is `क्या`                                                   | `?`   |
      | `en`: `rise >= 3`; `hi`: `rise >= 4`                                                                          | `?`   |
      | `ru`: inside one stressed syllable pitch rises 5 or more and the phrase ends below the start of that syllable | `?`   |
      | `zh`: mean of the last third minus mean of the first third `>= 2`                                             | `?`   |
      | `level >= 1`, `span >= 1.2 * range` and `loud >= 2`, and the utterance has another phrase to compare with     | `!`   |
      | the phrase is not the last one and the pause is under 0.5 s                                                   | `,`   |
      | anything else                                                                                                 | `.`   |

      The numbers are the tune sizes of {{P39}}, a little smaller. Tune them
      with the tests and keep the table in the code comment.

   6. Emphasis (`en`, `zh`): a word is emphasised when the pitch peak of its
      stressed syllable is 2 semitones or more above the line through the
      peaks of the other stressed syllables of the phrase, and the pitch
      span after the word is at most half of the span before it. Add `ˈˈ`
      before the word in `ipa` and a span to `modes` (step 5 below).
   7. Write the marks into `result.ipa` exactly as `textToIpa` writes them
      (`,`, `.`, `?`, `!`, `↗ ?`, `↘ ?`), so that
      `synthesize(result.ipa, { ipa: true })` speaks the same tune.
   8. Write `result.text`: the mark after the last word of the phrase
      (`hi`: `।` for `.`; `zh`: `，。？！`, no spaces); in `en` and `ru` the
      first letter of each sentence becomes a capital letter. Word objects
      keep their text without punctuation.

4. What cannot be decided is left out, not guessed: a phrase with fewer
   than 5 voiced frames in its last 250 ms gets `.` at the end of the
   utterance and nothing elsewhere.
5. A span in `result.modes` has the shape of `plan.modes` of {{P38}} plus
   four keys (the same in {{P59}}). Example:

   ```text
   { start: 0.4, end: 0.9, from: 2, to: 3, emphasis: 1,
     notation: 'ˈˈ', confidence: 0.7 }
   ```

   `start`, `end` are seconds; `from`, `to` are indexes
   into `result.words` (`to` exclusive); then only the decided keys of the
   mode object of {{P38}} (here `emphasis: 1` or `tune: 'yesno'`);
   `notation` is the IPA mark or `null`; `confidence` is 0 to 1. Every
   sentence mark other than `.` also adds a span with `tune` (`yesno`,
   `wh`, `exclamation`, `continuation`).

6. Wiring: if `src/recognition/recognizer.js` ({{P61}}) is in the code base,
   call `measureProsody` after `audioToIpa` and `markProsody` after
   `ipaToText` when the option `modes` is not `false`. If it is not there,
   {{P61}} adds the calls. In the round-trip test of {{P63}}, if merged, add
   the gate for `sentenceMark`: at least 90 % right at `wideband` and above,
   85 % at `telephone`.
7. Export both functions from `src/index.js` and add types.

## Tests

`tests/recognition-prosody.test.js`. Audio comes from `synthesize` at tier
`minimal`, seed 1, presets `male` and `female`; the true sounds and times
come from `timeline`, so the test does not depend on the sound decoder.

- `hears the tone of single syllables`: `妈 麻 马 骂` and `吗` after `好`:
  the cheapest tone is right for all, both presets.
- `hears tones in sentences`: 10 Mandarin sentences of 6 to 10 syllables
  (`tests/fixtures/recognition/tone-sentences.json`, write them here): at
  least 90 % of the syllables right. Print the 5 by 5 confusion matrix.
- `hears tones at 8 kHz`: the same after `resample` to 8000 Hz: at least
  85 %.
- `finds the stressed syllable`: 40 English and 40 Russian words of 2 to 4
  syllables, each in the frame `say ... again` / `скажи ... снова`: the most
  prominent nucleus is the stressed one in at least 90 %.
- `tells the sentence types apart`: 40 sentences, 10 per language: 4
  statements, 3 yes/no questions, 2 wh-questions, 1 exclamation after a
  statement. At least 90 % of the marks are right. Mandarin questions
  without `吗` are reported apart and have no threshold.
- `hears emphasis`: `I said *red* car` against `I said red car` (markup of
  {{P38}}): the span is on `red` in the first and absent in the second.
- `writes text`: `Are you coming?` comes back as `Are you coming?`;
  `Ты идёшь домой?` as `Ты идёшь домой?`.
- `leaves out what it cannot hear`: whispered input (no voiced frames) gives
  `tones: null` everywhere and the mark `.`.
- `speaks its own marks`: `parseIpa(result.ipa).unknown` is empty.

## Acceptance criteria

- [ ] `npm test` runs `tests/recognition-prosody.test.js` and every
      threshold above holds on Node.js, Bun and Deno.
- [ ] The pull request shows the tone confusion matrix at `minimal` and at
      8000 Hz, the stress score per language and the sentence-type table.
- [ ] If {{P61}} is merged: `voice-simulator say "Are you coming?" -o q.wav` then
      `voice-simulator recognize q.wav` prints `Are you coming?`.
- [ ] The pull request states that tone accuracy on real recordings is not
      measured here: the benchmark of {{P64}} measures it (`toneErr`) and
      keeps its own baseline.
- [ ] `grep -rn "onnx\|tensorflow\|torch" src/recognition package.json` prints
      nothing.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- Loudness, voice quality and emotion: {{P59}}. Whispered tones: {{P60}}.
- The pitch tracker itself: {{P47}}. The tone and tune models: {{P37}},
  {{P39}}.
- Tunes that the synthesiser does not guess from text either (calling
  contour, Russian IK-4 to IK-7), commas inside a phrase without a pause,
  quotation marks, capital letters of names.
- The Hindi `क्या` bug of the synthesiser: {{P33}}.

## References

- Research notes, section 5.4 (tone recognition):
  `docs/case-studies/issue-11/research/2-inversion-and-recognition.md`;
  cue table for tones, stress, questions and focus:
  `docs/case-studies/issue-11/research/4-linguistics-and-speech-modes.md`.
- Xu, Y. (1997). Contextual tonal variations in Mandarin. Journal of
  Phonetics 25(1), 61-83. doi:10.1006/jpho.1996.0034
- Prom-on, S., Xu, Y., Thipakorn, B. (2009). Modeling tone and intonation in
  Mandarin and English as a process of target approximation. Journal of the
  Acoustical Society of America 125(1), 405-424. doi:10.1121/1.3037222
- Yang, W.-J., Lee, J.-C., Chang, Y.-C., Wang, H.-C. (1988). Hidden Markov
  model for Mandarin lexical tone recognition. IEEE Transactions on
  Acoustics, Speech, and Signal Processing 36(7), 988-992.
  doi:10.1109/29.1620
- Fry, D. B. (1958). Experiments in the perception of stress. Language and
  Speech 1(2), 126-152.
