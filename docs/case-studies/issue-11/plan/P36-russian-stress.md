---
id: P36
title: Russian stress is wrong outside the small dictionary and for homographs
type: Bug
milestone: M3
blocked_by: [P35]
requirements: [R17, R19]
---

## Goal

Russian words must get the right stress in ordinary text: frequent words and
their inflected forms from a lexicon, words spelled with `е` instead of `ё`
restored, and words whose stress depends on the meaning or the case
(`за́мок` / `замо́к`, `го́рода` / `города́`) chosen from the words around them.
A measured share of words with correct stress replaces today's guess.

## Why

Russian stress is free, not written, and it changes the vowels: unstressed
`о` is spoken `ɐ` or `ə`. A wrong stress therefore changes most vowels of
the word, and a listener hears a different or a broken word. It is the main
source of wrong Russian speech today, and IPA to text ({{P56}}) needs the
same stress to find the word again.

## Current state

Reproduce with `node experiments/issue-11-audit-m3a.mjs` (section 6):

```
ru Ключ от замка. Старый замок на горе.:
   "klʲut͡ɕ ot ˈzamkə . ˈstarɨj ˈzamək na ˈɡorʲə ."
ru Это стоит дорого. Он стоит там.:
   "ˈɛtə ˈstoɪt dɐˈroɡə . on ˈstoɪt tam ."
ru 5 часов. 3 часа. Встреча в 17:00.:
   "pʲatʲ ˈt͡ɕasəf . trʲi ˈt͡ɕasə . ˈfstrʲet͡ɕə f sʲɪmˈnat͡sətʲ t͡ɕɪˈsof ."
ru Мы пошли в лес. Они увидели дерево. Сегодня хорошая погода.:
   "mɨ ˈpoʂlʲɪ f lʲes . ɐˈnʲi ʊvʲɪˈdʲelʲɪ ˈdʲerʲɪvə . ... xərɐˈʂajə pɐˈɡodə ."
ru Я купил телефон в магазине.: "ja ˈkupʲɪɫ tʲɪˈlʲefən f məɡɐˈzʲinʲə ."
ru еще ее елка зеленый идет пришел:
   "ˈjeɕːə ˈjejə ˈjeɫkə zʲɪlʲɪˈnɨj ˈidʲɪt ˈprʲiʂɨɫ"
```

Wrong: `замка` (must be `zɐmˈka`), `горе` (`ɡɐˈrʲe`), the second `стоит`
(`stɐˈit`), `дорого` (`ˈdorəɡə`), typed `часов` and `часа` (`t͡ɕɪˈsof`,
`t͡ɕɪˈsa`; only the `часов` that the number reader makes itself is right),
`пошли` (`pɐˈʂlʲi`), `увидели` (`ʊˈvʲidʲɪlʲɪ`), `хорошая` (`xɐˈroʂəjə`),
`купил` (`kʊˈpʲiɫ`), `телефон` (`tʲɪlʲɪˈfon`) and all six words of the last
line (`jɪˈɕːo jɪˈjo ˈjoɫkə zʲɪˈlʲonɨj ɪˈdʲot prʲɪˈʂoɫ`).

Root cause, `findRussianStress()` and `guessStress()` in
`src/g2p/russian.js`:

```js
if (stress < 0) {
  stress = getStressDictionary().get(letters) ?? guessStress(letters, vowels);
}
// guessStress(): seven suffixes, then
return Math.max(0, vowelCount - 2);
```

- `RUSSIAN_STRESS` in `src/g2p/russian-stress.js` has 304 words. It is a map
  from one spelling to one vowel, so it holds neither inflected forms
  (`головы` is listed, `голову` is not) nor two readings of one spelling.
- Every other word is stressed on the vowel before the last. Used on the 291
  dictionary words with two or more vowels, this guess is right for 154
  (52.9 %).
- `ё` is used only when it is typed. `russianWordToIpa(word)` gets no context.

## What to do

### 1. Data: stems and whole forms

Write the stress data by hand, from knowledge of the language. Check words
you are not sure of in a dictionary, but do not import a dictionary file: no
large Russian stress list with a licence that {{P35}} accepts is known.

Source file `data/lexicon/ru-stress.txt` (input of the build script of
{{P35}}, not shipped), one item per word, `+` before the stressed vowel:

- `раб+от|а`: a **stem** with fixed stress. `|` ends the stem; the letters
  after it are the dictionary ending. Matches `работы`, `работу`, `работать`.
- `карандаш|+`, `стол|+`, `хорош|+ий`: a stem with stress on the **ending**.
  The stress is the first vowel of the ending, or the last vowel of the stem
  when the ending has no vowel (`каранда́ш`, `карандаша́`).
- `=час+ов`, `=р+уку`, `=хорош+о`, `=хор+ошая`: a **whole form**. Use it for
  words that do not inflect and for forms that break the stem rule.

The build script writes two lexicons into `src/g2p/lexicon/ru.js`, `RU_FORMS`
and `RU_STEMS`. Move the 304 words of `RUSSIAN_STRESS` into the file and
delete the constant. Required size: at least 5 000 stems and 1 500 whole
forms, chosen from the top of the Russian word-count list of {{P35}}.

### 2. Lookup order in `findRussianStress(rawWord, context)`

1. A mark typed by the user (`+` or U+0301), as today.
2. A typed `ё`, as today.
3. `RUSSIAN_HOMOGRAPHS` (step 4), when the word is in it.
4. `RU_FORMS`: the whole word.
5. `RU_STEMS`: split the word into stem and ending, longest stem first; the
   ending must be in the new exported list `RUSSIAN_ENDINGS` (all case,
   number, gender, tense and person endings, with `ся` and `сь`; the empty
   ending is allowed). Take the first stem that is in `RU_STEMS`.
6. `guessStress()` (step 5).

Return also `source`: `'user'`, `'dictionary'`, `'morphology'` or `'rules'`,
and let `russianWordToIpa(word, context)` report it. `pronounceWord()` in
`src/g2p/index.js` passes the context on.

### 3. Restore `ё`

When a word has `е` and no `ё`, replace each `е` in turn by `ё` and look the
result up in `RU_FORMS` and `RU_STEMS`. If exactly one such word exists and
the spelling with `е` is **not** itself in the lexicon, use the `ё` word
(`еще` → `ещё`, `идет` → `идёт`). Pairs where both exist (`все` / `всё`,
`небо` / `нёбо`, `берет` / `берёт`) go into the homograph table.

### 4. Homographs: `src/g2p/russian-homographs.js` (new)

Export `RUSSIAN_HOMOGRAPHS`, a list of `[forms, kind, cues]`. `forms` holds
`default/other` pairs; `cues` are word beginnings (`двер` matches `двери`).
`context` is `{before, after, sentence}` of spoken, lowercased words, as
defined in {{P32}} (add the argument as described there if it is not merged;
`3 часа` gives `три` in `before`). Kinds:

- `near`: `other` when a cue is among the 4 words before or after.
- `before` / `after`: `other` when a cue is the word just before / after.
- `infinitive`: `other` when the next word ends in `ть`, `ться` or `чь`.
- `case`: the pair is genitive singular / nominative plural. Genitive when
  one of the two words before is in `GENITIVE_BEFORE`; plural when it is in
  `PLURAL_BEFORE` or ends in `ые` or `ие`; otherwise the default.

```js
export const GENITIVE_BEFORE =
  'два две три четыре оба обе полтора из от до у без для около после нет';
export const PLURAL_BEFORE = 'все эти те мои твои наши ваши их многие';
```

Start with these rows and reach at least 60 spellings:

| forms (default first)                             | kind       | cues                                |
| ------------------------------------------------- | ---------- | ----------------------------------- |
| `з+амок/зам+ок`, `з+амка/замк+а`, all other forms | near       | `ключ двер откр закр запер навесн`  |
| `сто+ит/ст+оит`                                   | near       | `скольк дорог дёшев дешев рубл цен` |
| `сто+ит/ст+оит`                                   | infinitive |                                     |
| `пл+ачу/плач+у`                                   | near       | `за деньг счёт счет налог`          |
| `мук+а/м+ука`, `уж+е/+уже`, `с+орок/сор+ок`       | near       | own cues, write them                |
| `б+елки/белк+и`                                   | near       | `жир углевод`                       |
| `больш+ая/б+ольшая`                               | after      | `часть половин дол`                 |
| `г+оре/гор+е`                                     | before     | `на в по`                           |
| `ч+аса/час+а`                                     | before     | `два три четыре полтора`            |
| `город+а/г+орода`, `дом+а/д+ома`, `лес+а/л+еса`   | case       |                                     |
| `вод+ы/в+оды`, `рук+и/р+уки`, `ног+и/н+оги`       | case       | (default is the genitive here)      |
| `все/всё`, `бер+ет/берёт`, `н+ебо/нёбо`           | near       | own cues, write them                |

Add the other mobile nouns in the same way (`голова`, `сторона`, `окно`,
`слово`, `дело`, `место`, `море`, `река`, `страна`, `сестра`, `стена`).

### 5. Guess for unknown words

Replace the suffix list of `guessStress()` by a table that the build script
derives from the lexicon: for every word ending of 2 to 4 letters that at
least 10 lexicon words share, the stress position counted from the end of
the word, kept when at least 75 % of those words agree. Leave every fifth
lexicon word out of the count; these are the test words. The longest ending
wins; without a match stress the vowel before the last, as today.

## Tests

New `tests/russian-stress.test.js`. The IPA of the text comes from
`textToIpa(text, {lang: 'ru'}).ipa`; each IPA word named here must be in it:

- `stresses inflected forms`: `Мы пошли в лес` has `pɐˈʂlʲi`;
  `Они увидели дерево` has `ʊˈvʲidʲɪlʲɪ`; `хорошая погода` has `xɐˈroʂəjə`;
  `Я купил телефон` has `kʊˈpʲiɫ` and `tʲɪlʲɪˈfon`; `5 часов` has
  `t͡ɕɪˈsof`; `дорого` gives `ˈdorəɡə`.
- `chooses homographs by context`: `Ключ от замка` has `zɐmˈka`;
  `Старый замок на горе` has `ˈzamək` and `ɡɐˈrʲe`; `Это стоит дорого` has
  `ˈstoɪt`; `Он стоит там` has `stɐˈit`; `3 часа` has `t͡ɕɪˈsa`;
  `большие города` has `ɡərɐˈda`; `из города` has `ˈɡorədə`.
- `restores ё`: `еще ее елка зеленый идет пришел` gives
  `jɪˈɕːo jɪˈjo ˈjoɫkə zʲɪˈlʲonɨj ɪˈdʲot prʲɪˈʂoɫ`; `все` stays `fsʲe`.
- `keeps user marks`: `замо́к з+амок` gives `zɐˈmok ˈzamək` in any context.
- `guesses unknown words`: on the held-out fifth of the lexicon the guess is
  right for at least 65 % of the words with two or more vowels.
- `reaches the sentence target`: new fixture
  `tests/fixtures/russian-stress.txt`, at least 200 sentences of prose whose
  author died more than 100 years ago, every word of two or more vowels
  marked with `+`. Mark it **before** you extend the lexicon. With the marks
  removed, at least 90 % of these words get the marked stress, and at least
  80 % of the words that are in `RUSSIAN_HOMOGRAPHS`.

## Acceptance criteria

- [ ] The pull request states the share of correct words on the fixture
      before the change (run the fixture test on `main`) and after it.
- [ ] `node experiments/issue-11-audit-m3a.mjs` (output committed) prints
      the IPA listed under "Wrong" in Current state for every word there.
- [ ] `RU_STEMS` has at least 5 000 entries, `RU_FORMS` at least 1 500,
      `RUSSIAN_HOMOGRAPHS` at least 60 spellings.
- [ ] The tests above exist and pass; existing Russian tests pass unchanged.
- [ ] The size budgets of {{P35}} hold; `npm run check` and `npm test` pass;
      a minor changeset is added.

## Out of scope

- The lexicon format, its build script and the word-count list: {{P35}}.
- Secondary stress in compounds; part-of-speech tagging or a parser.
- Prepositions and particles that form one word with their neighbour
  (`от замка` is spoken `ɐd zɐmˈka`, not `ot zɐmˈka`): {{P74}}.
- Sentence melody: {{P39}}.

## References

- Zaliznyak, A. A. (1977). Грамматический словарь русского языка. Moscow:
  Русский язык. Use it to check single words; do not copy its data.
- Yarowsky, D. (1997). Homograph disambiguation in text-to-speech synthesis.
  In: Progress in Speech Synthesis. Springer. Cue words near the homograph.
- `src/g2p/russian.js`, `src/g2p/russian-stress.js` (current behaviour).
