---
id: P74
title: Russian prepositions and particles are read as separate stressed words
type: Bug
milestone: M3
blocked_by: []
requirements: [R17, R19]
---

## Goal

A Russian preposition (`в`, `из`, `от`, `на`, `перед` ...) and the particles
`не`, `ни`, `же`, `ли`, `бы` are spoken as part of the word they lean on, as
people speak them: `из дома` becomes `ɪz ˈdomə`, `с братом` becomes
`z ˈbratəm`, `на работе` becomes `nə rɐˈbotʲə`, `как же` becomes `kaɡ ʐɨ`.
Each written word stays one item of `words`, so highlighting does not
change.

## Why

- In Russian these words have no stress of their own. Their vowels reduce
  as if they were the first syllables of the next word, and their last
  consonant takes the voicing of the sound that follows. Today they are
  read as whole words: full vowels (`na`, `ot`, `nʲe`) and a devoiced last
  consonant even before a voiced sound (`is ˈdomə`, `f ˈdomʲə`).
- Almost every Russian sentence has such a word, so every sentence has the
  error. Wrong voicing is audible at once (`с братом` with `s`).
- Recognition ({{P56}}) must expect the forms people really say. The table
  made here is the list of those forms.

## Current state

Reproduce with `node experiments/issue-11-audit-m3c.mjs` (section 2):

```
ru из дома: "is ˈdomə"              <- must be ɪz ˈdomə
ru от брата: "ot ˈbratə"            <- must be ɐd ˈbratə
ru в доме: "f ˈdomʲə"               <- must be v ˈdomʲə
ru с братом: "s ˈbratəm"            <- must be z ˈbratəm
ru об этом: "op ˈɛtəm"              <- must be ɐb ˈɛtəm
ru на работе: "na rɐˈbotʲə"         <- must be nə rɐˈbotʲə
ru через дорогу: "ˈt͡ɕerʲɪs dɐˈroɡʊ"  <- must be t͡ɕɪrʲɪz dɐˈroɡʊ
ru Я не знаю: "ja nʲe ˈznajʊ"       <- must be ja nʲɪ ˈznajʊ
ru с Иваном: "s ɪˈvanəm"            <- must be s ɨˈvanəm
ru как же: "kak ʐe"                 <- must be kaɡ ʐɨ
```

Root cause: `textToIpa()` in `src/g2p/index.js` pronounces one word at a
time, and `russianWordToIpa()` in `src/g2p/russian.js` treats every word as
a full word. A word of one syllable gets a full vowel (`stress` is 0 and no
vowel is reduced), and `assimilateVoicing()` devoices the last consonant
because nothing follows it inside the word:

```js
const next = result[index + 1];
if (next === undefined) {
  result[index] = setVoicing(result[index], false);
}
```

`experiments/issue-11-russian-clitics-prototype.mjs` is a working sketch of
the rules below on top of the public result of `textToIpa()`. Its output
`experiments/issue-11-russian-clitics-prototype.txt` holds the expected IPA
of every phrase named in this issue (left) and the IPA of today (right).
Use it as the reference; do not import it from `src/`.

## What to do

1. Create `src/g2p/russian-clitics.js`. Export `RUSSIAN_PROCLITICS`, a
   frozen object from a lower-case word to `[near, far]`: `near` is the
   form right before the stressed syllable of the next word, `far` the form
   anywhere else. One value means both are equal:
   - `в` `v`; `во` `vɐ`, `və`; `к` `k`; `ко` `kɐ`, `kə`; `с` `s`;
     `со` `sɐ`, `sə`;
   - `о` `ɐ`; `об` `ɐb`; `обо` `ɐbɐ`, `ɐbə`; `от` `ɐt`; `ото` `ɐtɐ`, `ɐtə`;
   - `до` `dɐ`, `də`; `по` `pɐ`, `pə`; `под` `pɐd`, `pəd`;
     `подо` `pədɐ`, `pədə`; `над` `nɐd`, `nəd`;
   - `из` `ɪz`; `изо` `ɪzɐ`, `ɪzə`; `за` `zɐ`, `zə`; `на` `nɐ`, `nə`;
   - `без` `bʲɪz`; `для` `dlʲɪ`; `при` `prʲɪ`; `про` `prɐ`, `prə`;
   - `через` `t͡ɕɪrʲɪz`; `перед` `pʲɪrʲɪd`; `передо` `pʲɪrʲɪdɐ`, `pʲɪrʲɪdə`;
   - `у` `ʊ`; `не` `nʲɪ`; `ни` `nʲɪ`.

   The forms keep the voiced last consonant of the spelling (`ɪz`, `ɐb`).
   `надо` is not in the table: it is also the word "need".

2. In the same file export:

   ```js
   /** Particles that lean on the word before them. */
   export const RUSSIAN_ENCLITICS = Object.freeze({
     же: 'ʐɨ',
     ли: 'lʲɪ',
     бы: 'bɨ',
   });
   /** These particles voice the last consonant of the word before. */
   const VOICING_ENCLITICS = new Set(['же', 'бы']);
   const DEVOICE = { b: 'p', v: 'f', ɡ: 'k', d: 't', z: 's', ʐ: 'ʂ' };
   const VOICE = { p: 'b', f: 'v', k: 'ɡ', t: 'd', s: 'z', ʂ: 'ʐ' };
   const VOICELESS_START = /^[pfktsʂxɕ]/u;
   const VOICED_START = /^[bɡdzʐ]/u;
   const VOWEL = /[aeiouɨəɐɪʊɛɔ]/gu;
   ```

   and a helper `setFinalVoicing(ipa, table)`: if `ipa` ends in `ʲ`, set
   the mark aside; if the last character is a key of `table`, replace it by
   the value; put the mark back.

3. In the same file export `joinRussianClitics(items)`. `items` is the list
   built in `textToIpa()`: word items and break items (`item.break` is
   true). It changes `item.ipa` in place. A phrase is a run of word items
   between two breaks (or the ends of the list). Walk every phrase from its
   last item to its first, with `previous` and `next` the neighbours inside
   the phrase (`undefined` at its ends) and
   `word = item.text.toLowerCase()`:
   1. The item is a proclitic when `item.lang === 'ru'`, `word` is in
      `RUSSIAN_PROCLITICS`, and `item.original ?? item.text`, normalised
      with `normalize('NFD')`, has neither `+` nor U+0301 (a stress mark
      typed by the user keeps today's reading).
   2. A proclitic with a `next` whose `lang` is `ru`:
      - `near` applies when `next` is not a proclitic itself and no vowel
        (pattern `VOWEL`) stands before `ˈ` in `next.ipa`, or `next.ipa`
        has no `ˈ`. Otherwise `far` applies.
      - Let `start` be `next.ipa` without `ˈ`. If `start` fits
        `VOICELESS_START`: `setFinalVoicing(form, DEVOICE)`. If it fits
        `VOICED_START`: `setFinalVoicing(form, VOICE)`. Otherwise (vowel,
        sonorant, `v`, `j`): the form as it is.
      - Set `item.ipa` to the result and remember the item as a clitic.
      - If the new `item.ipa` ends in a hard consonant (not a vowel and not
        `ʲ`) and `next` was not changed as a clitic, a first `i` or `ɪ` of
        `next.ipa` (after an optional `ˈ`) becomes `ɨ`.
   3. Otherwise, an item with `lang === 'ru'`, `word` in
      `RUSSIAN_ENCLITICS` and a `previous` whose `lang` is `ru`:
      `item.ipa = RUSSIAN_ENCLITICS[word]`. If `word` is in
      `VOICING_ENCLITICS` and `previous` is not a proclitic:
      `previous.ipa = setFinalVoicing(previous.ipa, VOICE)`.
   4. Every other item stays as it is. So a clitic alone, at the end of a
      phrase (proclitic) or at its start (enclitic), or next to a word of
      another language, is unchanged.
4. In `textToIpa()` call `joinRussianClitics(items)` after the loop that
   fills `items` and before `markQuestions(items)`. If the weak-form pass
   of {{P73}} is already there, the order of the two calls does not matter
   (they touch different languages).
5. Extend the file comment of `src/g2p/index.js` (clitics join the next or
   the previous word) and the comment above `assimilateVoicing()` in
   `src/g2p/russian.js` (voicing across a clitic boundary is done in
   `russian-clitics.js`).
6. Recognition. If `src/recognition/lexicon.js` of {{P56}} exists, add in
   the place where it collects the pronunciations of a Russian word every
   form of `RUSSIAN_PROCLITICS` (both columns, and both with the last
   consonant devoiced) and of `RUSSIAN_ENCLITICS` as one more pronunciation
   of that word. If the file does not exist, do nothing here.

Limits to write in the comment of `joinRussianClitics`:

- Stress that moves onto the preposition (`на́ гору`, `за́ город`, `не́ был`)
  is not known; the user writes the stress mark, or the lexicon of {{P36}}
  holds the phrase.
- The interjection `О` before a word is reduced like the preposition
  (`О боже`); write `о́` to keep it.
- `t͡s`, `t͡ɕ` and `x` at the end of a word are not voiced before `же`, `бы`.

## Tests

Add to `tests/text-to-ipa.test.js` a `describe('Russian clitics', ...)`
block with `lang: 'ru'`; the values are those of
`experiments/issue-11-russian-clitics-prototype.txt`. Use only these host
words: their stress is right today.

- `keeps the voiced consonant before a voiced sound`: `из дома` gives
  `ɪz ˈdomə`; `в доме` gives `v ˈdomʲə`; `об этом` gives `ɐb ˈɛtəm`;
  `без меня` gives `bʲɪz mʲɪˈnʲa`; `под домом` gives `pɐd ˈdoməm`.
- `devoices before a voiceless sound`: `из парка` gives `ɪs ˈparkə`;
  `в парке` gives `f ˈparkʲə`.
- `voices before a voiced obstruent`: `с братом` gives `z ˈbratəm`;
  `от брата` gives `ɐd ˈbratə`; `к дому` gives `ɡ ˈdomʊ`.
- `does not voice before sonorants and в`: `от мамы` gives `ɐt ˈmamɨ`;
  `к маме` gives `k ˈmamʲə`; `к вам` gives `k vam`.
- `reduces the vowels`: `на работе` gives `nə rɐˈbotʲə`; `до завтра` gives
  `dɐ ˈzaftrə`; `по дороге` gives `pə dɐˈroɡʲə`; `для меня` gives
  `dlʲɪ mʲɪˈnʲa`; `у меня` gives `ʊ mʲɪˈnʲa`; `через дорогу` gives
  `t͡ɕɪrʲɪz dɐˈroɡʊ`; `перед домом` gives `pʲɪrʲɪd ˈdoməm`; `со мной` gives
  `sɐ mnoj`; `обо мне` gives `ɐbɐ mnʲe`.
- `hardens и after a hard consonant`: `с Иваном` gives `s ɨˈvanəm`;
  `от Ивана` gives `ɐt ɨˈvanə`.
- `joins chains`: `из-за дома` gives `ɪz zɐ ˈdomə`; `из-под дома` gives
  `ɪs pɐd ˈdomə`; `не для меня` gives `nʲɪ dlʲɪ mʲɪˈnʲa`.
- `reduces particles`: `Я не знаю` gives `ja nʲɪ ˈznajʊ`; `Он же сказал`
  gives `on ʐɨ skɐˈzaɫ`; `знаешь ли` gives `ˈznajɪʂ lʲɪ`.
- `voices before же and бы`: `как же` gives `kaɡ ʐɨ`; `вот бы` gives
  `vod bɨ`; `друг же` gives `druɡ ʐɨ`; `сказал бы` gives `skɐˈzaɫ bɨ`.
- `stops at a break`: `Он сказал, в доме` gives `on skɐˈzaɫ , v ˈdomʲə`;
  `Да, на.` gives `da , na .`.
- `leaves single words alone`: `на`, `в`, `не` and `бы` give `na`, `f`,
  `nʲe` and `bɨ`.
- `keeps a typed stress mark`: `на́ гору` and `н+а гору` give `na ˈɡorʊ`.
- `stops at another language`: `в office` gives `f ˈɔfɪs`.
- `keeps one word item per written word`: `из-за дома` has three `words`
  with the texts `из`, `за`, `дома` and unchanged `sourceStart`.

Existing tests that hold the IPA of whole Russian sentences change. Update
their expected strings by the rules above and list every changed string in
the pull request. Do not change a test of a single word.

## Acceptance criteria

- [x] `node experiments/issue-11-audit-m3c.mjs` prints in section 2 the
      strings of the Tests section; the refreshed
      `experiments/issue-11-audit-m3c.txt` is committed.
- [x] `textToIpa(text, { lang: 'ru' }).ipa` equals the left value of
      `experiments/issue-11-russian-clitics-prototype.txt` for every phrase
      of that file (the prototype prints `|` where `textToIpa` prints the
      break mark).
- [x] `textToIpa(word, { lang: 'ru' })` is unchanged for every key of
      `RUSSIAN_PROCLITICS` and `RUSSIAN_ENCLITICS` given alone.
- [x] English, Hindi and Chinese results are unchanged: the tests of those
      languages pass without edits.
- [x] The new tests exist and pass; `npm run check` and `npm test` pass; a
      patch changeset is added.

## Out of scope

- The stress of the host words (`из города`, `под окном`, `в лесу` have the
  wrong stress today) and stress on the preposition: {{P36}}.
- Voicing between two full words (`наш дом`), `и` after a full word that
  ends in a hard consonant (`брат и сестра`), the unstressed conjunctions
  `и`, `а`, `но`, `да`, place assimilation (`с шумом`, `из жизни`) and the
  particles written with a hyphen (`-то`, `-ка`): open a Feature issue when
  wanted.
- Sentence melody: {{P39}}.
- Durations of the reduced syllables: {{P27}}.

## References

- Avanesov, R. I. (1984). Русское литературное произношение [Russian
  literary pronunciation], 6th edition. Prosveshchenie, Moscow. Sections on
  prepositions and particles without stress.
- Jones, D., Ward, D. (1969). The Phonetics of Russian. Cambridge University
  Press. Chapters on vowel reduction and on voicing assimilation.
- Timberlake, A. (2004). A Reference Grammar of Russian. Cambridge
  University Press. Chapter 2, "Sounds".
- Research notes:
  `docs/case-studies/issue-11/research/4-linguistics-and-speech-modes.md`.
