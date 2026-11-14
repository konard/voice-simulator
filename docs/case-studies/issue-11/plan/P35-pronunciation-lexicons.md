---
id: P35
title: Pronunciation lexicons at scale from permissive sources
type: Feature
milestone: M3
blocked_by: [P03, P04]
requirements: [R7, R17, R18]
---

## Goal

Give every language a larger pronunciation lexicon in one compact format,
built by one script from sources whose licence is recorded and allowed. Add
a user lexicon, a fixed order (user, lexicon, rules) and a lookup from
pronunciation back to spelling, inside a fixed size budget.

## Why

Words outside the lexicon are read by rules, and the rules fail on names,
loan words, Chinese characters with two readings and Hindi compounds.
Recognition ({{P56}}) needs the same word lists in the other direction.
Data of unclear origin would break the public-domain promise of the project.

## Current state

Reproduce with `node experiments/issue-11-audit-m3a.mjs` (sections 5 and 8).
Shortened here; the pinyin and the text in brackets are added:

```
lexicon sizes: {"englishWords":12046,"russianStressWords":304, ...}
en: "onomatopoeia=ˈɑnɑmæɾɑpɑeɪæ(rules)", "quinoa=ˈkwɪnoʊ(rules)", ...
zh: 重庆 "ʈ͡ʂʊŋ˥˩ ..." (zhòng, must be chóng), 还钱 hái (huán), 首都 dōu (dū),
    行为 wèi (wéi), 教书 jiào (jiāo), 干净 gàn (gān), 少年 shǎo (shào),
    大夫 dà fū (dài fu), 着急 zhe (zháo), 有空 kōng (kòng), 种树 zhǒng (zhòng)
hi: "लोकसभा=loːkəsbʱaː" (must be loːksəbʱaː), "ज्ञान=d͡ʒɲaːn" (ɡjaːn),
    "धड़कनें=d̪ʱəɽəknẽː" (d̪ʱəɽkənẽː)
```

- English: `src/g2p/english-dict.js`, 246 045 bytes of `word=ipa` text (20
  bytes per word; 82 250 bytes with gzip). `readCmudict()` in
  `scripts/build-g2p-data.mjs` drops all but the first pronunciation:
  `if (/\(\d+\)$/.test(word) || entries.has(word)) { continue; }`.
- Chinese: `src/g2p/chinese-dict.js` keeps one reading per character. Words
  come from the 49 hand-written `PHRASES` in `src/g2p/chinese.js`.
- Hindi has no lexicon. Russian has 304 words (handled in {{P36}}).
  `textToIpa(text, {lang, accent})` has no option for user words.
- The build script names four inputs. Only two have a licence written down
  (CMUdict "BSD-2-Clause", Unihan "Unicode License v3"). The two English
  word-count lists (`google-10000.txt`, `count_1w.txt`) have none. The
  package is 382.1 kB packed (`npm pack --dry-run`).

## What to do

### 1. Sources and licences

Create `data/lexicon/sources.json`, a list of objects with the keys `id`,
`title`, `url`, `licence` (SPDX identifier), `licenceUrl`, `licenceQuote`,
`licenceChecked` and `usedFor`. **Open every licence at its source, copy the
deciding sentence into `licenceQuote` and the date into `licenceChecked`.**
The table is what the authors of this plan believe; it is not checked.

| Source                                  | Believed licence       | Use               |
| --------------------------------------- | ---------------------- | ----------------- |
| CMUdict (`cmusphinx/cmudict`)           | BSD-2-Clause           | ship (English)    |
| Unihan `Unihan_Readings.txt`            | Unicode-3.0            | ship (characters) |
| AISHELL-3 `content.txt` (see {{P04}})   | Apache-2.0             | ship mined words  |
| Hand lists in `data/lexicon/`           | the project's own      | ship              |
| `google-10000.txt`, `count_1w.txt`      | not recorded           | check, see below  |
| CC-CEDICT, OpenRussian, Wiktionary data | CC BY-SA (share-alike) | never ship        |
| Lists made from Zaliznyak's dictionary  | unclear                | never ship        |

- Data may be committed or shipped only when its `licence` is in
  `allowedLicences` of `scripts/policy-denylist.json` ({{P03}}). Add to
  `scripts/check-policy.mjs` a function `lexiconSources(root, list)` that
  reports every entry of `sources.json` with another licence, an empty
  `licenceQuote` or no `licenceChecked`.
- Share-alike and unclear sources are not downloaded by any script of this
  repository and no data from them is committed. A user may convert such a
  file on their own machine (step 3, `convert`) and load the result.
- If a word-count list has no licence that passes, do not use it: count
  words in text that passes instead (step 3, `counts`).
- Write `src/g2p/lexicon/NOTICE.md` with the full licence text and copyright
  line of every shipped source. Pin Unihan to a versioned address, not
  `latest`. If {{P04}} is merged, add the input files to its registry.

### 2. Container format `vslex`

One generated module per language, `src/g2p/lexicon/<lang>.js`, exports
objects of this shape:

```js
{ format: 'vslex', version: 1, lang: 'en', count: 20000, blockSize: 64,
  alphabet: "'-abc...", symbols: 'ABC...', values: ['ə', 'ˌ', 't', ...],
  first: ['a', 'abroad', ...], blocks: ['0aA1aaBCDEFAGHI2ronGJDAK...', ...] }
```

- Words are lower case and sorted by code point. A block holds 64 entries.
- Entry: one digit (number of leading letters shared with the word before,
  at most 9; `0` at the start of a block), the other letters of the word,
  the pronunciation, then `/` and a pronunciation per further variant.
- A pronunciation is a run of characters of `symbols`; character number `i`
  stands for `values[i]`. `symbols` uses printable ASCII without digits,
  `/`, quotes, the backslash and the characters of `alphabet`.
- Lookup: binary search in `first`, decode that one block, cache it.

Section 8 of the audit script encodes today's English words this way:
128 650 bytes instead of 245 158 (10.7 bytes per word), 67 236 with gzip.

### 3. `scripts/build-lexicon.mjs` (replaces `scripts/build-g2p-data.mjs`)

- `build <lang> --from <dir> [--words <n>] [--full --out <file>]`: writes
  the module. English: all CMUdict variants in file order, converted with
  the existing `arpabetToIpa()`, equal variants merged; words chosen by rank
  in `data/lexicon/en-counts.txt`; `data/lexicon/en-extra.txt` (`word ipa`
  lines, hand-written) wins. `--full` writes all CMUdict words as JSON to a
  file outside `src/`. The module is formatted with Prettier.
- `counts <lang> --text <dir>`: writes `data/lexicon/<lang>-counts.txt`,
  `word count` lines, highest first, at most 50 000.
- `coverage <lang> --text <dir>`: prints the share of running words whose
  `source` is not `rules`, and the 50 most frequent missing words.
- `convert --lang <lang> --in <file> --out <file>`: turns a tab-separated
  `word`, `pronunciation` file into a `--full` style JSON file.

### 4. Data per language

- English: at least 20 000 words. Put `quinoa`, `segue` and `onomatopoeia`
  into `en-extra.txt` if their rank is too low.
- Chinese: `ZH_READINGS`, all readings of each character: the `kMandarin`
  reading first, as today, then the other readings of `kTGHZ2013` (their
  syntax is in Unicode annex 38). `ZH_PHRASES`, a `vslex` of words of 2 to 4
  characters whose reading is **not** the first reading of each character;
  the payload has one letter per character (`a` first reading, `b` second,
  upper case the same with neutral tone). Fill it from
  `data/lexicon/zh-phrases.txt` (hand-written `词 pīn yīn` lines, at least
  600, with all `PHRASES` of today and all words of Current state) and from
  character pairs of AISHELL-3 seen 3 times or more with one reading in
  90 % of the cases. First find out whether its pinyin is written before or
  after tone sandhi (look at `你好`); ignore differences sandhi explains.
- Hindi: `data/lexicon/hi-words.txt`, at least 200 hand-written `word ipa`
  lines for words where schwa deletion fails (compounds such as `लोकसभा`,
  plurals such as `धड़कनें`). Fix `ज्ञ` to `ɡj` in the rules of `hindi.js`.
- Russian: the container only. A payload letter is the number of the
  stressed vowel (`a` first) or `z` for stress on the ending; `ё` is stored
  as written. The data is the work of {{P36}}.

### 5. Run-time API (new `src/g2p/lexicon.js`) and budgets

- `openLexicon(data)` returns `{size, has(word), lookup(word), words()}`;
  `lookup` gives a list of pronunciations (first is the default) or `null`.
- `lexiconFor(lang, part)` returns the opened shipped lexicon. Nothing is
  decoded before the first lookup in that language.
- `addLexicon(lang, entries)`: `entries` is a `vslex` object or a plain
  object `{word: ipa}`; `clearLexicons()` removes all added ones.
- For {{P56}}: `pronunciations(lang, word)`, every known one, user first;
  `lexiconWords(lang)`, an iterator over all words; and
  `spellingsOf(lang, ipa)`, all words with this pronunciation.
- `textToIpa(text, {lexicon: {en: {word: ipa}}})`: words for this call only.
  An entry that `parseIpa` cannot read throws a `TypeError` with the word.
- Order for every word: (1) `options.lexicon`, (2) `addLexicon`, both with
  `source: 'user'`; (3) the shipped lexicon, `'dictionary'`; (4) suffix
  rules, `'morphology'`; (5) letter rules, `'rules'`.
- CLI: `--lexicon <file>` (JSON) calls `addLexicon`. The app loads
  `lexicons/<lang>-full.json` when the file exists on the server.
  `englishDictionarySize()` keeps working. Export the new functions from
  `src/index.js` and add them to `src/index.d.ts`.
- Budgets: `src/g2p/lexicon/en.js` is not larger than today's 246 045
  bytes; all files in `src/g2p/lexicon/` together at most 420 000 bytes;
  the packed package grows by at most 60 kB.

## Tests

New `tests/lexicon.test.js`:

- `round-trips a lexicon`: encode 1 000 words, open the result; `lookup`
  returns the input for every word and `null` for 100 other words. Include
  `a`, `aa`, `aaaaaaaaaaaa`, `aaaaaaaaaaab`, `don't` and two variants.
- `keeps all CMUdict variants`: `pronunciations('en', 'either')` has two
  items, one starting with `ˈi` and one with `ˈaɪ`.
- `prefers the user lexicon`: with `{lexicon: {en: {quinoa: 'kiˈnoʊə'}}}`
  the word gives that IPA with `source: 'user'`; without it the IPA starts
  with `ˈkin` and the source is `'dictionary'`; `{en: {x: ''}}` throws.
- `finds spellings`: `spellingsOf('en', 'ˈðɛɹ')` has `there` and `their`.
- `reads polyphones in words`: `chineseWordToIpa(w).pinyin` is `chóng qìng`
  for 重庆, `huán qián` 还钱, `shǒu dū` 首都, `xíng wéi` 行为, `jiāo shū`
  教书, `gān jìng` 干净, `shào nián` 少年, `dài fu` 大夫, `zháo jí` 着急,
  `yǒu kòng` 有空, `zhòng shù` 种树; `yín háng` 银行 stays.
- `uses the Hindi lexicon`: the three Hindi words of Current state.
  `stays inside the budgets`: the byte limits of step 5, read with `fs`.

`tests/heavy/lexicon-coverage.test.js` ({{P02}}; skipped without the data):
`coverage` on the `fleurs-en` and `fleurs-hi` validation text, and the share
of syllables in every tenth AISHELL-3 line (not mined) read as in the file.

## Acceptance criteria

- [ ] The pull request states the three heavy numbers before and after:
      English at least 98 % of running words not from `rules`; Chinese
      reading errors at most half of the number before.
- [ ] `node experiments/issue-11-audit-m3a.mjs` prints the pronunciations
      named as "must be" in Current state.
- [ ] `node scripts/check-policy.mjs` passes, and fails after `licence` of
      one entry of `sources.json` is changed to `CC-BY-SA-4.0`.
- [ ] `englishDictionarySize()` returns at least 20 000 and the budgets of
      step 5 hold (`npm pack --dry-run` output in the pull request).
- [ ] `node scripts/build-lexicon.mjs build en --from <dir>` leaves
      `git status` clean; all existing tests pass unchanged; `npm run check`
      and `npm test` pass; a minor changeset is added.

## Out of scope

- Russian stress data and homographs: {{P36}}. English heteronyms:
  {{P32}}. Erhua: {{P31}}. Word counts for recognition: {{P56}}.
- Learned letter-to-sound rules, Chinese word segmentation, other languages.

## References

- CMUdict, `github.com/cmusphinx/cmudict`; Unicode Standard Annex 38 (Unihan).
- Witten, I. H., Moffat, A., Bell, T. C. (1999). Managing Gigabytes, 2nd
  ed. Morgan Kaufmann. Front coding of sorted word lists.
