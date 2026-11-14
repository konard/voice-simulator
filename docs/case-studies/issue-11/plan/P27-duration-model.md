---
id: P27
title: Rule-based segment duration model per language
type: Feature
milestone: M2
blocked_by: [P05, P06]
requirements: [R1, R9, R17, R18]
---

## Goal

Compute the length of every sound with the duration model of Klatt (1979): each
phoneme has an inherent and a minimum duration, and a list of rules shortens or
lengthens it by a percentage that depends on its position and its neighbours.
Each of the four languages gets its own tables, fitted to recordings.

## Why

Rhythm is a large part of naturalness and of accent. In real speech the same
vowel is longer before `[d]` than before `[t]`, shorter in a long word, longer
at the end of a phrase; consonants are shorter in clusters. Russian, Hindi and
Mandarin follow other rules than English (vowel reduction, phonemic length,
tones).

## Current state

Durations are set in `src/articulation/plan.js` with constants that are the same
for all languages:

```js
function vowelDuration(token, context) {
  let duration = 0.105;
  if (token.stress === 1) {
    duration *= context.stressLengthening;
```

- All vowels start from 0.105 s: `[ɪ]` is as long as `[æ]`. Then: × 1.35 for
  main stress (head parameter `stressLengthening`), × 1.15 for secondary stress,
  × 0.75 for a reduced vowel, × 1.7 if long, × 0.6 for the second part of a
  diphthong, × 1.15 in a text with tones, and the factor of the boundary at the
  end of a phrase (`BOUNDARIES` in `src/articulation/prosody.js`: 1.2 to 1.4;
  head parameter `finalLengthening`).
- Consonants take the `duration` of their manner in `MANNERS`
  (`src/articulation/phones.js`): plosive 75 ms, nasal 70, trill 85, tap 28,
  fricative 105, approximant 60, lateral 65; × 1.15 if voiceless, × 1.2 before a
  phrase end, × 1.8 if long. The release of a voiceless stop is 15 ms, or 60 ms
  with aspiration.
- Everything is multiplied by `1 / head.speechRate`. Pauses come from
  `BOUNDARIES` (word 12 ms, comma 200 ms, …) times `head.pauseLength`.
- No rule looks at the next sound, the length of the word, the position in the
  word or clusters. The language only switches English aspiration.

## What to do

1. Create `src/articulation/durations.js`. Export
   `segmentDuration(token, features, table)`, in seconds:

   ```
   duration = (minimum + (inherent - minimum) * percent / 100) / speechRate
   ```

   `inherent` and `minimum` are the two durations of the phoneme in ms from
   `table`; `percent` starts at 100 and is multiplied by the factor of every
   rule that applies. Never return less than `minimum / speechRate`.

2. Compute `features` for each token in `buildSegments()`, in a new exported
   function `durationFeatures(tokens, index)`: `stress` (0, 1, 2), `emphasis`
   (boolean, from the plan modes of {{P38}} when present, else false),
   `phraseFinal` (the boundary name or null; today's `phraseEnd()`),
   `wordFinalSyllable`, `syllablesInWord`, `wordInitial`, `syllableOnset`
   (consonant before the vowel of its syllable), `previous` and `next` (class of
   the neighbouring sound inside the word: `vowel`, `voicedPlosive`,
   `voicelessPlosive`, `voicedFricative`, `voicelessFricative`, `nasal`,
   `liquid`, `glide`, or null), `tone` (0 to 5).

3. Rules. Export `DURATION_RULES`, an array of
   `{name, applies(token, features), factor}` with these starting values (Klatt
   1979, as given in Allen, Hunnicutt & Klatt 1987; check each number against
   the source before use):

   ```
   name                  applies to                             factor
   clauseFinal           last syllable before a pause           1.4
   nonPhraseFinal        vowel not in a phrase-final syllable   0.6
   nonWordFinal          vowel not in a word-final syllable     0.85
   polysyllabic          vowel in a word of 2 or more syllables 0.8
   nonInitialConsonant   consonant not at the start of a word   0.85
   unstressedMedial      unstressed vowel, word-medial syllable 0.5
   unstressedOther       other unstressed vowel                 0.7
   unstressedOnset       consonant before an unstressed vowel   0.7
   emphasis              vowel with emphasis                    1.4
   beforeVoicedFricative vowel before a voiced fricative        1.6
   beforeVoicedPlosive   vowel before a voiced plosive          1.2
   beforeNasal           vowel before a nasal                   0.85
   beforeVoiceless       vowel before a voiceless plosive       0.7
   openFinal             word-final vowel, no consonant after   1.2
   vowelBeforeVowel      vowel followed by a vowel              1.2
   vowelAfterVowel       vowel preceded by a vowel              0.7
   clusterMiddle         consonant between two consonants       0.5
   clusterEdge           consonant next to one consonant        0.7
   ```

   For the five `before…` and `openFinal` rules outside a phrase-final syllable
   use `0.7 + 0.3 * factor` instead of `factor`. For an unstressed sound halve
   `minimum`. A stressed vowel after an aspirated plosive gets 25 ms more (added
   after the formula). The head parameters keep their meaning: `clauseFinal`
   uses `1 + (factor - 1) * (finalLengthening - 1) / 0.4` scaled by the boundary
   as today, and `unstressed…` factors are divided by
   `stressLengthening / 1.35`.

4. Tables. Export `DURATION_TABLES`, an object with the keys `en`, `ru`, `hi`,
   `zh` and `default` (a copy of `en`, used for other languages). Each has
   `inherent` and `minimum` (ms) per phoneme class, optional entries per IPA
   symbol that win over the class, and `rules` (names of the rules that are
   switched off or have another factor). Starting values per class (inherent /
   minimum): open vowels 230 / 80, mid vowels 190 / 70, close vowels 150 / 50,
   lax and reduced vowels 130 / 45, diphthongs 250 / 100; voiceless fricatives
   115 / 60, voiced fricatives 70 / 40, voiceless plosives (closure) 80 / 50,
   voiced plosives 75 / 50, nasals 70 / 50, liquids 80 / 35, glides 70 / 40,
   `[h]` 80 / 20, tap 28 / 20, trill 85 / 50. Language differences, as starting
   values:
   - `ru`: no `beforeVoiced…` rules (final devoicing); `unstressedOther` 0.7 for
     the syllable just before the stress and 0.45 for all other unstressed
     syllables; long (double) consonants × 1.5.
   - `hi`: short vowels `[ə ɪ ʊ]` 110 / 50, long vowels 210 / 90; `unstressed…`
     rules 0.9 (weak stress); double consonants × 1.8.
   - `zh`: no stress rules, no `polysyllabic` rule; factor by tone: tone 1 1.0,
     tone 2 1.05, tone 3 1.15, tone 4 0.9, neutral tone 0.55; `clauseFinal` 1.2.

5. Stops. Keep the release segments of `pushRelease()` (15 ms, 60 ms with
   aspiration; {{P23}} replaces them by physics). Affricates: closure from the
   plosive entry × 0.7, frication from the fricative entry × 0.7.

6. Rate and pauses. `speechRate` scales the part above the minimum more than the
   minimum itself: use `minimum / speechRate^0.5` and
   `(inherent - minimum) / speechRate^1.2` in the formula of step 1 (exponents
   exported as `RATE_MINIMUM = 0.5`, `RATE_STRETCH = 1.2`; starting values).
   Pauses: `pauseDuration(token) * pauseLength / speechRate^1.5` for boundaries
   of strength 2 or more (pauses shrink faster than sounds); the 12 ms word
   boundary is unchanged.

7. Remove `vowelDuration()`, the duration code of `pushConsonant()` and
   `MANNERS[...].duration`. If `planUtterance()` has the option `durations`
   (added by {{P26}}), it wins when given.

8. Calibrate. `experiments/issue-11-fit-durations.mjs` reads the golden set
   ({{P05}}), which has no phone alignment. Measure the durations with
   `alignToRecording(plan, audio, recording)` of
   `experiments/issue-11-align.mjs` (dynamic time warping of the synthesized
   audio onto the recording; create it as described in step 6 of {{P26}} if it
   does not exist). Skip a recording when the mean distance along the path is
   above twice the median of all recordings. Per language print the mean
   absolute error of the predicted duration per sound in ms and the correlation,
   for today's code (kept in the script) and for the new model. Then fit
   `inherent` per class (median of the data after removing the rule factors) and
   the rule factors one by one (grid of 0.05 steps inside 0.3 to 2), two passes.
   Commit the output as `.txt` and write the fitted numbers into
   `DURATION_TABLES`. Keep a starting value when fewer than 20 examples of a
   rule exist.

9. Re-measure `SYLLABLE_RATE.slope` and `SPEAKING_TIME.slope` in
   `src/analysis/voice-match.js` (`experiments/issue-9-*`).

## Tests

Create `tests/durations.test.js`:

- `applies the formula`: inherent 200, minimum 80, percent 60 gives 0.152 s;
  percent 0 gives 0.08 s.
- `lengthens a vowel before a voiced consonant`: the `[æ]` of `bæd` is 1.2 to
  1.8 times as long as in `bæt` (`en`).
- `shortens vowels in longer words`: the stressed vowel of `ˈstɪk` is longer
  than in `ˈstɪki`, which is longer than in `ˈstɪkinəs`.
- `shortens consonants in clusters`: `[s]` in `ˈstɑ` is shorter than in `ˈsɑ`.
- `lengthens the end of a phrase`: the last vowel of `ˈmɑmɑ.` is 1.2 to 1.6
  times its length in `ˈmɑmɑ ˈmɑmɑ.` (first word).
- `reduces Russian vowels in two degrees`: in `məlɐˈko` the three vowels are in
  rising order of duration.
- `keeps Hindi length`: `[aː]` is 1.6 to 2.4 times `[ə]` in the same context.
- `shortens the neutral tone`: in `ma1ma5` (Mandarin) the second vowel is 0.45
  to 0.7 times the first.
- `scales with the speech rate`: at `speechRate` 1.5 the audit sentence is 0.55
  to 0.8 times as long as at 1, and no sound is shorter than its minimum divided
  by 1.5.

Update `tests/prosody.test.js`, `tests/timeline.test.js`,
`tests/syllables.test.js` and `tests/head-parameters.test.js`: directions stay,
absolute durations may change.

## Acceptance criteria

- [ ] `experiments/issue-11-fit-durations.txt` is committed; for each language
      with at least 200 aligned sounds the mean absolute error of the new model
      is at least 20 % below that of today's code.
- [ ] The duration of the audit sentence at default settings changes by less
      than 15 %; the new value is in the pull request.
- [ ] `grep -n "0.105" src/articulation` finds nothing.
- [ ] Every number of `DURATION_RULES` and `DURATION_TABLES` has a comment with
      its source: the paper, or "fitted, issue-11-fit-durations".
- [ ] The new tests exist and pass on Node.js, Bun and Deno.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- How fast articulators move inside a sound: {{P26}}. Pitch: {{P37}}, {{P39}}.
- Markup for emphasis, rate and breaks: {{P38}}. Accents: {{P45}}. Emotions and
  vocal effort: {{P40}}, {{P43}}. A statistical duration model.

## References

- Klatt, D. H. (1979). Synthesis by rule of segmental durations in English
  sentences. In B. Lindblom & S. Öhman (Eds.), Frontiers of Speech Communication
  Research, 287-299. Academic Press.
- Klatt, D. H. (1976). Linguistic uses of segmental duration in English:
  acoustic and perceptual evidence. Journal of the Acoustical Society of America
  59(5), 1208-1221. doi:10.1121/1.380986
- Allen, J., Hunnicutt, M. S., & Klatt, D. (1987). From Text to Speech: The
  MITalk System. Cambridge University Press.
- Research notes 4 and 5 in `docs/case-studies/issue-11/research/`.
