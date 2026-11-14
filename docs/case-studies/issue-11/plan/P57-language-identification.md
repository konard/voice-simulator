---
id: P57
title: Language identification and mixed-language speech from IPA
type: Feature
milestone: M4
blocked_by: [P56]
requirements: [R6, R7, R19]
---

## Goal

`identifyLanguage(ipa)` in `src/recognition/language-id.js` says which of the
supported languages a sequence of IPA sounds is in, and where the language
changes inside one utterance. `ipaToText` of {{P56}} uses that answer to write
speech that mixes languages, with every word tagged with its language.

## Why

The issue says: "audio -> IPA -> language/languages (if mixed language speech
is used)". People mix languages all the time (an English name in a Russian
sentence). {{P56}} can only read one language per call, so without this issue
the caller would have to know the language before listening.

## Current state

- `detectLanguage(text)` and `scriptLanguage(text)` in `src/g2p/index.js` work
  on written text only: they count the letters of each script. Nothing
  guesses a language from sounds.
- The synthesiser already speaks mixed text and labels each word:
  `textToIpa('она сказала thank you и ушла', { lang: 'ru' })` gives
  `ɐˈna skɐˈzaɫə ˈθæŋk ˈju i ˈuʂɫə`, with `words[].lang` equal to
  `ru ru en en ru ru`. This gives test data with known answers for free.
- `LANGUAGES` (an object with the keys `en`, `ru`, `hi`, `zh`) lists the
  languages.
- Some sounds occur in one language only in this project: tone letters
  (`ni˧˥`) in `zh`; `bʱ`, `ɽ`, `ɦ` and nasalised long vowels in `hi`;
  palatalised consonants (`vʲ`, `tʲ`) and `ɫ` in `ru`; `θ`, `ð`, `ɹ`, `æ`,
  `ɝ` in `en`.
- After {{P56}}: `getLexicon(language)` gives every known word with its
  pronunciation and count, and `ipaToText(ipa, { language })` reads one
  language.
- The research notes quote the classic result for this method (Zissman
  1996, telephone speech, two languages): 2 % errors on 45 s and 5 % on 10 s.
  Short stretches are unreliable; the design below must say how sure it is.

## What to do

1. Sound statistics. In `src/recognition/language-id.js`, build on first use
   one table per language from `getLexicon(language)`:
   - for every word, take the `symbol`s of its sounds without stress marks
     and without tone letters; add `#` before and after the word;
   - count every single symbol, every pair and every triple, each weighted
     by the count of the word;
   - `P(c | a b) = 0.6 * count(a b c) / count(a b)`
     `+ 0.3 * count(b c) / count(b) + 0.1 * max(count(c) / total, 0.0001)`.
     A term with a zero divisor is 0.
     No data file is added: the tables come from the word list of {{P56}}.
2. `identifyLanguage(ipa, options)`. `ipa` is a string or an array of sounds
   `{ ipa, start, end, confidence }`, as in {{P56}}. Options: `languages`
   (codes to choose from, default all keys of `LANGUAGES`), `switchPenalty`
   (default 6), `minSounds` (default 8). Steps:
   1. Parse with `parseIpa`. Units are syllables (`syllabifyTokens`). A
      pause ends a unit.
   2. Score every unit for every language: the sum of `ln P(c | a b)` over
      its sounds, where `a b` are the two sounds before (`#` after a pause
      or a space, and at the start).
   3. Tone cue: a unit that carries a tone letter adds 3 to `zh`.
   4. Best path (Viterbi): `best[u][L] = score[u][L] + max(stay, change)`
      where `stay = best[u-1][L]` and `change` is the largest
      `best[u-1][M] - penalty` over the other languages `M`. `penalty` is
      `switchPenalty`, or half of it when a pause lies between the units.
      Follow the path back from the best language of the last unit.
   5. A span of one syllable between two spans of the same language takes
      their language.
   6. Lexical check, only for spans where the best and second-best language
      differ by less than 0.5 per sound: run `ipaToText` on the span with
      both languages and keep the one with the lower cost per sound.
3. Result:

   ```text
   {
     languages: [{ language: 'ru', share: 0.67 }, { language: 'en', share: 0.33 }],
     spans: [{ language: 'ru', from: 0, to: 11, start: null, end: null,
               confidence: 0.9 }, ...],
     scores: { en: -3.1, ru: -1.2, hi: -4.0, zh: -5.2 }
   }
   ```

   - `from`, `to`: indexes of sounds (pauses not counted), `to` exclusive.
     `start`, `end`: seconds for timed input, else `null`.
   - `share`: part of the sounds (timed input: part of the speech time) in
     that language; shares add up to 1; sorted, largest first.
   - `scores`: mean score per sound over the whole input.
   - `confidence` of a span: `1 - exp(-(best - second) * sounds / 4)`,
     where `best` and `second` are mean scores per sound of the span. For a
     span of fewer than `minSounds` sounds, multiply by `sounds / minSounds`.
   - Empty input gives `{ languages: [], spans: [], scores: {} }`.

4. Mixed text. Add the option `spans` to `ipaToText` (file of {{P56}}): the
   `spans` of step 3. When all spans have one language, behave as with
   `language`. Otherwise search over the lexicons of all languages in the
   spans at once:
   - every candidate word carries its language;
   - a candidate whose language differs from the span of its first sound
     costs 2 more;
   - a word whose language differs from the word before costs 1 more,
     unless a pause lies between them;
   - pair counts are used only between two words of one language; the first
     word after a change uses its single count;
   - `text` joins words with one space, but two `zh` words in a row are
     joined without a space.
5. Export `languageShares(words)` from `language-id.js`: it computes
   `languages` from the `language` and the times (or sound counts) of the
   final words. {{P61}} uses it so that `result.languages` agrees with
   `result.words`.
6. All numbers above (0.6/0.3/0.1, 3, 6, 0.5, 2, 1) are starting values.
   Tune them with the tests and write the final values in the code comment.
7. Export `identifyLanguage` and `languageShares` from `src/index.js`, add
   types, and add `voice-simulator language <ipa>` to the command line (it
   prints one line per span: `ru 0-11 0.90`).

## Tests

`tests/language-id.test.js`. Test data is made with `textToIpa`, so the right
answer is known.

- `names the language of a sentence`: the 40 sentences of
  `tests/fixtures/recognition/ipa-sentences.json` ({{P56}}): the first entry
  of `languages` is right for 100 % of them.
- `names the language of a word`: the first 2000 words of each language with
  4 sounds or more: right for at least 90 % (`zh` with tones: 97 %). Print
  the confusion matrix (4 by 4).
- `works without tone letters`: the `zh` sentences with all tone letters
  removed: right for at least 90 %.
- `finds the switches`: `tests/fixtures/recognition/mixed-sentences.json`
  holds 12 sentences with two languages each, 3 per pair en+ru, en+hi,
  en+zh, ru+zh (write them in this issue; for example
  `I said привет to my friend`, `она сказала thank you и ушла`,
  `मैं कल office जाऊँगा`, `我喜欢 this book 因为它很好`). Expected word
  languages come from `textToIpa(...).words[].lang`. At least 90 % of the
  words get the right language; the number of spans is at most the true
  number plus 1.
- `writes mixed text`: for the same 12 sentences,
  `ipaToText(ipa, { spans })` returns at least 85 % of the words with the
  right sounds and the right `language`.
- `does not flicker`: one English sentence of 30 syllables gives exactly 1
  span.
- `says when it is unsure`: an input of 3 sounds gives a span with
  `confidence < 0.5`.
- `survives wrong sounds`: replace 10 % of the sounds by their nearest other
  sound (`createRandom(1)`): measure the share of right word languages on
  the mixed set, print it, and gate it at the measured value minus 2 points
  (it must be at least 75 %).
- `is fast enough`: 120 sounds take less than 50 ms after one warm-up call
  when step 6 is not needed.

## Acceptance criteria

- [ ] `node bin/voice-simulator.js language "ɐˈna skɐˈzaɫə ˈθæŋk ˈju i ˈuʂɫə"`
      prints three spans: `ru`, `en`, `ru`.
- [ ] `npm test` runs `tests/language-id.test.js`; every threshold above
      holds on Node.js, Bun and Deno.
- [ ] The pull request shows the 4 by 4 confusion matrix for words and the
      measured numbers of every test.
- [ ] `git diff --stat main -- src/recognition/data` is empty (no new data
      file).
- [ ] `grep -rn "onnx\|tensorflow\|torch" src/recognition package.json` prints
      nothing.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- Languages other than the four, and the answer "none of these".
- Language from the sound of the voice (rhythm, melody). Only the sequence
  of sounds and the tone marks are used.
- Accents: an English word said with Russian sounds is scored as it sounds
  ({{P45}} describes accents for synthesis).
- Accuracy on audio: {{P63}} (own speech) and {{P64}} (recordings).

## References

- Research notes, sections 5.1 and 5.2:
  `docs/case-studies/issue-11/research/2-inversion-and-recognition.md`.
- Zissman, M. A. (1996). Comparison of four approaches to automatic language
  identification of telephone speech. IEEE Transactions on Speech and Audio
  Processing 4(1), 31-44. doi:10.1109/tsa.1996.481450
- Lyu, D.-C., Lyu, R.-Y. (2008). Language identification on code-switching
  utterances using multiple cues. Interspeech 2008, 711-714.
  doi:10.21437/interspeech.2008-223
- Viterbi, A. (1967). Error bounds for convolutional codes and an
  asymptotically optimum decoding algorithm. IEEE Transactions on Information
  Theory 13(2), 260-269.
