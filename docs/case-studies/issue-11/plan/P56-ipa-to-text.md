---
id: P56
title: IPA to text per language
type: Feature
milestone: M4
blocked_by: [P35]
requirements: [R6, R7, R19]
---

## Goal

`ipaToText(ipa, options)` in `src/recognition/ipa-to-text.js` turns a sequence
of IPA sounds into written words of one language (English, Russian, Hindi or
Mandarin). It is the text-to-IPA step of this project run backwards. It also
works when the sounds have no word boundaries and when some sounds are wrong.

## Why

The issue fixes the pipeline: audio becomes IPA first, and only then language
and text. The audio stages end with IPA; without this step recognition can
never print text. It must work without neural networks, so it uses the
project's own pronunciation rules, a search and small count tables.

## Current state

- Text to IPA exists for four languages: `WORD_PRONOUNCERS` in
  `src/g2p/index.js` (`en`, `ru`, `hi`, `zh`), each returning
  `{ ipa, source }`. Nothing goes from IPA to spelling:
  `grep -rn "ipaToText" src` prints nothing and `src/recognition/` does not
  exist.
- English: `ENGLISH_DICTIONARY` in `src/g2p/english-dict.js` is one string of
  `word=ipa` items (`englishDictionarySize()` returns 12046). About 340
  pronunciations belong to two or more spellings, for example `ˈtu` (`to`,
  `two`, `too`) and `ˈðɛɹ` (`their`, `there`). Weak forms are the dictionary
  form: `the` is `ðə`, `and` is `ənd`.
- Russian: `RUSSIAN_STRESS` marks the stress of 304 words; other words use
  rules.
  Spelling is lost in the sound: `код` and `кот` are both `kot`; `в лесу` is
  `f ˈlʲesʊ`.
- Hindi has no dictionary, only rules (`hindiWordToIpa`, `deleteSchwas`).
- Mandarin: `CHINESE_READINGS` holds one reading for each of 8105 characters.
  The IPA has one "word" per character: `你好吗` is `ni˧˥ xɑʊ˨˩ ma`. `他`,
  `她` and `它` are all `tʰa˥`.
- The repository has no word counts of any kind, so nothing can choose
  between `to` and `two`.
- `parseIpa(ipa).tokens` gives the features of every sound: consonants have
  `place`, `manner`, `voiced`; vowels have `height`, `backness`, `rounded`
  (numbers 0 to 1); tokens have `stress`, `long`, `nasalized`, `aspirated`,
  `palatalized`, `tone`.
- `syllableSpans(word, syllables)` in `src/g2p/orthography.js` splits a
  spelling into syllables; `utteranceTimeline` uses it through the private
  helpers `phoneCounts` and `spellSyllables` in `src/articulation/timeline.js`.

## What to do

1. Count tables. Create `scripts/build-recognition-data.mjs`. Input: a folder
   of plain text files per language (`--text <dir>/<lang>/*.txt`) and the
   word lists of the lexicons that {{P35}} added (`lexiconWords(language)`
   of `src/g2p/lexicon.js`). Output, committed:
   `src/recognition/data/<lang>.js` exporting two strings:
   - `WORDS`: items `word=count` separated by spaces, highest count first,
     at most 20000 items. For `zh` an item is a word of 1 to 4 characters.
   - `BIGRAMS`: items `i,j=count` (`i`, `j` are positions in `WORDS`), at
     most 40000 items, only pairs seen 3 times or more.
     A word is counted only if the lexicon of {{P35}} or the pronouncer of the
     language accepts it. Each data file is at most 800 kB.
2. The text must be in the public domain (author died more than 100 years
   ago, or a public-domain dedication). Do not download it in CI. List every
   text in `src/recognition/data/SOURCES.md`: title, author, year, where it
   was taken from, SHA-256 of the file. The texts themselves are not
   committed; the counts are. Use at least 1 million words per language.
3. `src/recognition/phone-distance.js` exports `phoneDistance(a, b)` for two
   tokens of `parseIpa`. It returns 0 for equal sounds and at most 1:
   - vowel and vowel: `min(1, v)` with
     `v = 2 * |height| + 1.5 * |backness| + 0.5 * rounded + 0.3 * long`
     `+ 0.3 * nasalized` (differences; a flag counts 1 when it differs);
   - consonant and consonant: `min(1, c)` with
     `c = 0.5 * manner + 0.35 * place + 0.25 * voiced + 0.2 * aspirated`
     `+ 0.2 * palatalized`; `place` is the distance
     in the list bilabial, labiodental, dental, alveolar, postalveolar,
     retroflex, alveolopalatal, palatal, velar, uvular, pharyngeal, glottal,
     divided by 11 (`labial-velar` counts as the nearer of bilabial and
     velar, `labial-palatal` as the nearer of bilabial and palatal);
   - vowel and consonant: 1, but 0.6 for `j`/`i` and `w`/`u`;
   - a different tone adds 0.5 (0 between `˨˩˦` and `˨˩`, 0.15 between
     `˨˩˦` and `˧˥`: these are the sandhi forms); a different stress adds
     0.2.
     Export `INSERT_COST = 1` and `DELETE_COST = 1`; both are 0.5 for `ə` and
     `ʔ`. All numbers are starting values. Tune them with the tests below and
     write the final values in the code comment.
4. `src/recognition/lexicon.js` exports `getLexicon(language)`. On the first
   call it builds, and then keeps, a trie from sounds to words:
   - for every word of `WORDS`, call the pronouncer of the language; add the
     result. Add these extra pronunciations: Hindi, the form with every
     schwa kept and the form after `deleteSchwas`; Russian `в`, `к`, `с`,
     both voiced and voiceless; every pronunciation {{P35}} lists for the
     word (`pronunciations(language, word)` of `src/g2p/lexicon.js`);
   - trie keys are the `symbol`s of the tokens without stress marks; tones
     stay in the key for `zh`;
   - each end node keeps the list of `{ word, ipa, count }`.
     Because pronunciations are computed at run time, a change of the
     text-to-IPA rules never leaves old data behind.
5. `ipaToText(ipa, options)`. `ipa` is a string, or an array of sounds
   `{ ipa, start, end, confidence }` (times in seconds). Options:
   `language` (default `'en'`), `nbest` (default 1), `beam` (default 32),
   `boundaries`: `'given'` (a space in the IPA ends a word) or `'search'`
   (spaces are ignored). Default: `'given'` for a string with a space in
   `en`, `ru`, `hi`; `'search'` for `zh` and for arrays. A pause mark is
   always a boundary. Steps:
   1. Candidates. For every start position `i`, walk the trie along the
      sounds. Allow a substitution (cost `phoneDistance`), a skipped input
      sound (`DELETE_COST`) and a missing input sound (`INSERT_COST`). Drop
      a path when its cost is above `0.6 * (sounds used + 1)`. Keep the
      `beam` cheapest paths per step. Every end node reached gives a
      candidate `{ from: i, to: j, word, cost }`.
   2. Unknown words. For every `i` also add one candidate made by the rules
      of step 6, for the sounds up to the next pause or boundary (at most 12
      sounds), with cost `3 + 0.5 * sounds`.
   3. Word cost: `-ln P(word | previous)`, times 0.3, plus 0.5 per word.
      `P` is `(count(previous, word) - 0.75) / count(previous)` when the
      pair is in `BIGRAMS`, otherwise `0.4 * count(word) / total`.
   4. Dynamic programming from left to right. `best[j]` holds up to `beam`
      partial results ending at sound `j`, each with its last word and total
      cost. Extend each by every candidate starting at `j`. With
      `boundaries: 'given'`, a candidate must start and end at a boundary.
   5. The answer is the cheapest result at the last sound. With `nbest > 1`
      return the next cheapest different texts as `alternatives`:
      `[{ text, ipa, confidence }]`.
6. `src/recognition/phones-to-letters.js` exports
   `spellSounds(tokens, language)` for words that are not in the lexicon:
   - `ru`: one letter per sound; a palatalised consonant writes the next
     vowel as `я ё ю е и`, or adds `ь` when no vowel follows; `ɐ` and `ə`
     are written `а`, `ɪ` is written `и`.
   - `hi`: consonants in a row are joined with the virama `्`; a vowel after
     a consonant is a matra; `ə` after a consonant writes nothing; a
     nasalised vowel gets `ँ`.
   - `zh`: turn each syllable into pinyin with the inverse of
     `pinyinSyllableToIpa` (build the inverse by calling it for every
     syllable that occurs in `CHINESE_READINGS`), then take the character
     with that reading that has the highest count.
   - `en`: a table `ENGLISH_SOUND_SPELLINGS` with one spelling per sound
     (`i` `ee`, `eɪ` `ay`, `ʃ` `sh`, `t͡ʃ` `ch`, `θ` `th`, `ɝ` `er`, ...).
7. Result: `{ text, ipa, words }` (plus `alternatives`). Every word has the
   keys of a word of `recognize`: `text`, `ipa` (the pronunciation of the
   chosen word; for unknown words the sounds heard), `language`, `start`,
   `end` (first and last sound; `null` for string input), `confidence`
   (`exp(-cost / sounds)`, times the mean confidence of the sounds; at most
   0.3 for unknown words) and `syllables`.
8. Syllables: split `word.ipa` with `syllabifyTokens`. To get
   `syllables[].text`, move `phoneCounts` out of `timeline.js` into
   `src/g2p/orthography.js`, export it, and call
   `syllableSpans(word.text, syllables.map(phoneCounts))`, so that the split
   is the one `utteranceTimeline` shows. `stress` comes from `word.ipa`.
9. `text`: words joined by one space (`zh`: no spaces). Lower case, no
   punctuation, numbers as words. Capitals and punctuation come from
   {{P58}}.
10. Export `ipaToText` from `src/index.js`, add types to `src/index.d.ts`,
    and add `voice-simulator text <ipa> --lang <code>` to the command line.

## Tests

`tests/ipa-to-text.test.js`:

- `distance is a metric`: for all pairs of `listSymbols()`:
  `phoneDistance(a, a) === 0`, symmetric, between 0 and 1.
- `finds every word again`: for the first 5000 items of `WORDS` per
  language, `ipaToText(textToIpa(word, { lang }).ipa, { language: lang })`
  returns a word with the same pronunciation in 100 % of cases and the same
  spelling in at least 90 %.
- `reads sentences`: `tests/fixtures/recognition/ipa-sentences.json` holds 10
  sentences per language, 5 to 10 words each (write them in this issue, for
  example `we know there are two cats`, `я знаю что он дома`). Given
  `textToIpa(sentence).ipa`: the same sounds in 100 % of words, the same
  spelling in at least 95 % of words (`zh`: 90 % of characters).
- `finds word boundaries`: the same IPA with every space removed and
  `boundaries: 'search'`: at least 95 % of words are right by sound.
- `survives wrong sounds`: replace 10 % of the sounds by their nearest other
  sound (`createRandom(1)`), no spaces: measure the word error rate by sound,
  print it, and gate it at the measured value plus 2 points (it must be
  below 30 %).
- `prefers the likely spelling`: `ˈtu ˈkæts` gives `two cats`.
- `spells unknown words`: `ipaToText('ˈblɪk', { language: 'en' })` returns a
  non-empty word with `confidence <= 0.3`; for 200 dictionary words removed
  from the lexicon, `spellSounds` gives a spelling whose `textToIpa` has the
  same sounds in at least 60 % (`ru`, `hi`, `zh`: 90 %).
- `splits syllables like the timeline`: `hello` gives `hel`, `lo`.
- `is fast enough`: after one warm-up call, 120 sounds without spaces at
  `beam: 8` take less than 0.5 s; `getLexicon` takes less than 3 s.

`tests/recognition-data.test.js`: every data file is at most 800 kB, has at
most 20000 words and 40000 pairs, counts fall from left to right, and every
language is listed in `SOURCES.md`.

## Acceptance criteria

- [ ] `node bin/voice-simulator.js text "həˈloʊ ˈwɝld" --lang en` prints
      `hello world`; with `"prʲɪˈvʲet"` and `--lang ru` it prints `привет`;
      with `"ni˧˥ xɑʊ˨˩˦"` and `--lang zh` it prints `你好`.
- [ ] `npm test` runs both test files and all thresholds above hold on
      Node.js, Bun and Deno.
- [ ] `grep -rn "onnx\|tensorflow\|torch" src/recognition package.json` prints
      nothing.
- [ ] `du -k src/recognition/data` shows at most 3200 kB.
- [ ] The pull request lists the final cost values and the measured numbers
      of every test above.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- Choosing the language and speech that mixes languages: {{P57}}.
- Capital letters, punctuation, stress and tones heard in the audio:
  {{P58}}.
- Making the lexicons larger: {{P35}}. Digits instead of number words.
- Word counts over more than two words. Neural networks of any kind.

## References

- Research notes, sections 5.3 and 5.5 (sounds to words, Russian, Hindi):
  `docs/case-studies/issue-11/research/2-inversion-and-recognition.md`.
- Mohri, M., Pereira, F., Riley, M. (2002). Weighted finite-state transducers
  in speech recognition. Computer Speech and Language 16(1), 69-88.
- Bisani, M., Ney, H. (2008). Joint-sequence models for grapheme-to-phoneme
  conversion. Speech Communication 50(5), 434-451.
  doi:10.1016/j.specom.2008.01.002
- Choudhury, M., Basu, A., Sarkar, S. (2004). A diachronic approach for
  schwa deletion in Indo-Aryan languages. doi:10.3115/1622153.1622156
- Chen, S. F., Goodman, J. (1999). An empirical study of smoothing techniques
  for language modeling. Computer Speech and Language 13(4), 359-393.
