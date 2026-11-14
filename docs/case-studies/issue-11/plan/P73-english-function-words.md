---
id: P73
title: English function words are spoken as full stressed words
type: Bug
milestone: M3
blocked_by: []
requirements: [R17, R19]
---

## Goal

In an English sentence the small grammar words (`of`, `to`, `for`, `can`,
`was`, `you` and so on) are spoken in their weak form and without stress, as
people speak them: `a cup of tea for you` becomes `ə ˈkʌp əv ˈti fɚ ju`.
`the` and `to` take their form before a vowel (`ði ˈɛnd`, `tu ˈit`). A word
keeps its strong form where people keep it: alone, at the end of a phrase
(`Yes, I can.`), and in the few fixed cases listed below.

## Why

- Stress carries the rhythm of English. Today almost every word of a
  sentence has primary stress, so every vowel gets the long duration and a
  pitch accent. The sentence is 14 % too long and sounds like a list of
  words.
- A reduced vowel in the wrong place is the first thing a listener notices
  in synthetic English, before any detail of the voice.
- Recognition ({{P56}}) must expect the forms people really say. The table
  made here is the list of those forms.

## Current state

Reproduce with `node experiments/issue-11-audit-m3c.mjs` (sections 1 and 5):

```
en the end: "ðə ˈɛnd"                              <- must be ði
en a cup of tea for you: "ə ˈkʌp ˈʌv ˈti ˈfɔɹ ˈju"
en I can do it: "ˈaɪ ˈkæn ˈdu ˈɪt"
en I used to live there: "ˈaɪ ˈjuzd ˈtu ˈlaɪv ˈðɛɹ"   <- must be ˈjus tə
en I have to go: "ˈaɪ ˈhæv ˈtu ˈɡoʊ"                 <- must be ˈhæf tə
en He was at home: "ˈhi ˈwɑz ˈæt ˈhoʊm"
en an apple: "ˈæn ˈæpəl"
ə ˈkʌp ˈʌv ˈti ˈfɔɹ ˈju: 1.904 s, vowels 79 142 142 142 142 198
ə ˈkʌp əv ˈti fɚ ju: 1.666 s, vowels 79 142 79 142 79 147
```

The last two lines are planned vowel durations in ms: a stressed vowel gets
142 ms, an unstressed one 79 ms.

Root cause: `textToIpa()` in `src/g2p/index.js` pronounces one word at a
time and never looks at the neighbours:

```js
function pronounceWord(word, language) {
  const result = WORD_PRONOUNCERS[language](word);
  return { text: word, lang: language, ...result };
}
```

The dictionary (`src/g2p/english-dict.js`) holds one form per word. It is the
weak form for `a`, `the`, `and` and `in`, and the strong form with a stress
mark for all others. The only rule that looks across words is `linkRs()`
(linking r of non-rhotic accents).

`experiments/issue-11-weak-forms-prototype.mjs` is a working sketch of the
rules below on top of the public result of `textToIpa()`. Its output
`experiments/issue-11-weak-forms-prototype.txt` holds the expected IPA of
every sentence named in this issue. Use it as the reference; do not import
it from `src/`.

## What to do

1. Create `src/g2p/weak-forms.js`. Export `WEAK_FORMS`, a frozen object
   from a lower-case word to `{ kind, weak }`. The forms are General
   American, written with the symbols the dictionary uses:
   - `article`: a `ə`, an `ən`, the `ðə`;
   - `conjunction`: and `ənd`, but `bət`, or `ɔɹ`, as `əz`, than `ðən`,
     if `ɪf`;
   - `preposition`: of `əv`, to `tə`, for `fɚ`, from `fɹəm`, at `ət`,
     in `ɪn`, on `ɑn`, with `wɪð`, by `baɪ`;
   - `auxiliary`: am `əm`, is `ɪz`, are `ɚ`, was `wəz`, were `wɚ`, be `bi`,
     been `bɪn`, have `hæv`, has `hæz`, had `hæd`, do `du`, does `dʌz`,
     can `kən`, could `kəd`, will `wəl`, would `wəd`, shall `ʃəl`,
     should `ʃəd`, must `məst`;
   - `pronoun`: i `aɪ`, you `ju`, he `hi`, she `ʃi`, we `wi`, they `ðeɪ`,
     it `ɪt`, me `mi`, him `hɪm`, her `hɚ`, us `əs`, them `ðəm`, my `maɪ`,
     your `jɚ`, his `hɪz`, its `ɪts`, our `ɑɹ`, their `ðɛɹ`.

   `have`, `has`, `had`, `do` and `does` keep their full vowel and only lose
   the stress: without a parser the main verb (`I have a car`) cannot be
   told from the auxiliary.

2. In the same file export three more tables:

   ```js
   /** Forms before a word that starts with a vowel sound. */
   export const BEFORE_VOWEL = Object.freeze({ the: 'ði', to: 'tu' });
   /** Forms of a word that is followed by `to`. */
   export const BEFORE_TO = Object.freeze({
     have: 'ˈhæf',
     has: 'ˈhæs',
     used: 'ˈjus',
     supposed: 'səˈpoʊs',
   });
   /** After these words an auxiliary is a noun (`a can`, `my will`). */
   export const DETERMINERS = new Set(
     'a an the my your his her its our their this that'.split(' ')
   );
   ```

3. In the same file export `weakenFunctionWords(items, accent)`. `items` is
   the list built in `textToIpa()`: word items and break items (`item.break`
   is true). It changes `item.ipa` in place. A phrase is a run of word items
   between two breaks (or the ends of the list). For every phrase:
   1. Remember the `ipa` of every item (the strong forms).
   2. For every item with `lang === 'en'`, without `item.letter`, with
      `previous` and `next` the neighbours inside the phrase (`undefined` at
      its ends), and `word = item.text.toLowerCase()`, take the first rule
      that fits:
      - `next` is the word `to` and `word` is in `BEFORE_TO`: the new form
        is `BEFORE_TO[word]`. Exception: `used` after one of
        `am is are was were be been being` stays as it is
        (`It is used to make bread`).
      - `word` is not in `WEAK_FORMS`: no change.
      - `kind` is `preposition` and `next` is `undefined`: no change
        (`What are you looking at?`).
      - `kind` is `auxiliary` and `next` is `undefined`, or `next` is the
        word `not`, or `previous` is in `DETERMINERS`: no change
        (`Yes, I can.`, `You must not go`, `a can of beans`).
      - `word` is in `BEFORE_VOWEL` and the `ipa` of `next` starts with a
        vowel (the pattern that `linkRs()` uses, with `ɝ` and `ɚ` added):
        the new form is `BEFORE_VOWEL[word]`.
      - Otherwise the new form is `WEAK_FORMS[word].weak`.
   3. When there is a new form:
      `item.ipa = adaptEnglishWord(form, '', accent)` and
      `item.linkingR = hasLinkingR(form)`. Pass the empty
      string as the spelling: the accent tables have overrides by spelling
      (`of` is `ɒv` in `en-GB`) and those are strong forms.
   4. If no item of the phrase has `ˈ` in its `ipa` now, give one changed
      item its remembered strong form back: the last changed item whose word
      is not `it` (`Is it?` gives `ˈɪz ɪt`, `For you.` gives `fɚ ˈju`). So
      a single word is never changed: `textToIpa('can')` stays `ˈkæn`.
4. In `textToIpa()` call it after the loop that fills `items` and before
   `markQuestions(items)`:

   ```js
   if (options.weakForms !== false) {
     weakenFunctionWords(items, accent);
   }
   ```

   Document the new option `weakForms` (default `true`) in the JSDoc of
   `textToIpa`, in `README.md` next to the other options of `textToIpa`, and
   in the type declarations. Export `WEAK_FORMS` from `src/index.js`.

5. Extend the file comment of `src/g2p/index.js`: function words are weak
   inside a phrase.
6. Recognition. If `src/recognition/lexicon.js` of {{P56}} exists, add in
   the place where it collects the pronunciations of an English word one
   more pronunciation for every word of `WEAK_FORMS`, `BEFORE_VOWEL` and
   `BEFORE_TO` (the weak form, without the stress mark), and add to its test
   file: `ipaToText('aɪ kən ˈdu ɪt', { language: 'en' })` gives
   `i can do it`. If the file does not exist, do nothing here.
7. Markup. If `src/markup/` of {{P38}} exists, a word inside an emphasis
   element keeps its strong form: skip an item whose mode track marks it as
   emphasised. If it does not exist, do nothing here.

Limits to write in the comment of `weakenFunctionWords`: `that`, `there` and
`some` are never weakened (their weak and strong uses need a parser);
`used to` after a form of `be` is read as the verb `use`.

## Tests

Add to `tests/text-to-ipa.test.js` a `describe('English weak forms', ...)`
block; `lang: 'en-US'` unless said otherwise; the values are those of
`experiments/issue-11-weak-forms-prototype.txt`:

- `weakens function words inside a phrase`: `a cup of tea for you` gives
  `ə ˈkʌp əv ˈti fɚ ju`; `He was at home` gives `hi wəz ət ˈhoʊm`;
  `I can do it` gives `aɪ kən ˈdu ɪt`; `an apple` gives `ən ˈæpəl`.
- `uses the forms before a vowel`: `the end` gives `ði ˈɛnd`;
  `the apple and the pear` gives `ði ˈæpəl ənd ðə ˈpɛɹ`; `to eat` gives
  `tu ˈit`.
- `keeps the strong form at the end of a phrase`: `Yes, I can.` gives
  `ˈjɛs , aɪ ˈkæn .`; `What are you looking at?` gives
  `ˈwʌt ɚ ju ˈlʊkɪŋ ˈæt ↘ ?`.
- `keeps one stress in every phrase`: `Is it?` starts with `ˈɪz ɪt`;
  `It is.` starts with `ɪt ˈɪz`; `For you.` starts with `fɚ ˈju`.
- `leaves single words alone`: `you`, `can`, `at`, `of` and `the` give the
  same IPA as with `weakForms: false`.
- `fuses have to and used to`: `I have to go` gives `aɪ ˈhæf tə ˈɡoʊ`;
  `I used to live there` gives `aɪ ˈjus tə ˈlaɪv ˈðɛɹ`;
  `It is used to make bread` gives `ɪt ɪz ˈjuzd tə ˈmeɪk ˈbɹɛd`.
- `keeps nouns and negations strong`: `a can of beans` gives
  `ə ˈkæn əv ˈbinz`; `my will is strong` gives `maɪ ˈwɪl ɪz ˈstɹɔŋ`;
  `You must not go` gives `ju ˈmʌst ˈnɑt ˈɡoʊ`.
- `adapts weak forms to the accent`: with `lang: 'en-GB'`, `for a while`
  gives `fəɹ ə ˈwaɪl`, `a cup of tea for you` gives `ə ˈkʌp əv ˈtiː fə ju`
  and `He was at home` gives `hi wəz ət ˈhəʊm`.
- `does not touch spelled letters`: `US and IT` gives `ˈju ˈɛs ənd ˈaɪ ˈti`.
- `can be switched off`: with `weakForms: false`, `I can do it` gives
  `ˈaɪ ˈkæn ˈdu ˈɪt`.
- `keeps one word item per written word`: `I have to go` has four `words`
  with the texts `I`, `have`, `to`, `go` and unchanged `sourceStart`.

Add to `tests/prosody.test.js`:

- `shortens function words`: the plan of
  `textToIpa('a cup of tea for you').ipa` is at least 10 % shorter than the
  plan of the same text with `weakForms: false`.

Existing tests that hold the IPA of whole English sentences change. Update
their expected strings by the rules above and list every changed string in
the pull request. Do not change a test of a single word.

## Acceptance criteria

- [ ] `node experiments/issue-11-audit-m3c.mjs` prints in section 1 the
      strings of the Tests section; the refreshed
      `experiments/issue-11-audit-m3c.txt` is committed.
- [ ] `textToIpa(text).ipa` equals the line of
      `experiments/issue-11-weak-forms-prototype.txt` for every sentence of
      that file (the prototype prints `|` where `textToIpa` prints the break
      mark).
- [ ] `textToIpa(word)` is unchanged for every key of `WEAK_FORMS` given
      alone.
- [ ] Russian, Hindi and Chinese results are unchanged: the tests of those
      languages pass without edits.
- [ ] The new tests exist and pass; `npm run check` and `npm test` pass; a
      minor changeset is added (new option `weakForms`).

## Out of scope

- Contractions written out by the speaker (`gonna`, `wanna`, `'em`) and
  dropping `h` in `him`, `her`, `his`, `have` in fast speech: a speaking
  style, {{P40}} does not cover it either; open a Feature issue when wanted.
- Weak `that`, `there`, `some` and auxiliary `have` with a reduced vowel:
  they need the part of speech; the word-class rules of {{P32}} are the
  place to add them later.
- Contrastive stress on a function word (`I said TO, not FROM`): the
  emphasis markup of {{P38}}.
- Sentence melody and which content word gets the main accent: {{P39}}.
- Durations of weak syllables beyond the stressed and unstressed values of
  today: {{P27}}.

## References

- Roach, P. (2009). English Phonetics and Phonology, 4th edition. Cambridge
  University Press. Chapter 12, "Weak forms".
- Cruttenden, A. (2014). Gimson's Pronunciation of English, 8th edition.
  Routledge. Section 11.3 on weak forms of function words.
- Wells, J. C. (2008). Longman Pronunciation Dictionary, 3rd edition.
  Pearson. Entries of the words in the table (strong and weak forms).
- Research notes:
  `docs/case-studies/issue-11/research/4-linguistics-and-speech-modes.md`.
