---
id: P32
title: English heteronyms are always read the same way
type: Bug
milestone: M3
blocked_by: []
requirements: [R17, R19]
---

## Goal

An English word that is spelled one way but spoken two ways must get the
reading that fits the sentence: `I read it yesterday` has `ɹɛd`,
`I will read it` has `ɹid`; `record the record` has `ɹəˈkɔɹd` then `ˈɹɛkɚd`.
The choice is made by small written rules. No neural network is used.

## Why

Heteronyms are common words (`read`, `use`, `close`, `live`, `present`). A
wrong reading is a wrong word for the listener, and round-trip tests
({{P63}}) cannot pass when the spoken form does not match the meaning.

## Current state

Reproduce with `node experiments/issue-11-audit-m3a.mjs` (section 2):

```
en: "ˈaɪ ˈɹɛd ðə ˈbʊk ˈjɛstɚˌdeɪ ."
en: "ˈaɪ ˈwɪl ˈɹɛd ðə ˈbʊk ."                <- should be ɹid
en: "ˈdɪd ˈju ɹəˈkɔɹd ðə ɹəˈkɔɹd ?"          <- second: ˈɹɛkɚd
en: "ˈaɪ ˈlaɪv ˈhiɹ . ə ˈlaɪv ˈʃoʊ ."        <- first: lɪv
en: "ðə ˈwaɪnd ˈbloʊz . ˈwaɪnd ðə ˈklɑk ."   <- first: wɪnd
en: "ˈaɪ ˈjus ˈɪt . ˈɪt ˈɪz ˈʌv ˈnoʊ ˈjus ." <- first: juz
en: "ˈkloʊs ðə ˈdɔɹ . ˈsteɪ ˈkloʊs ˈtu ˈmi ." <- first: kloʊz
```

Root cause 1: `englishWordToIpa(word)` in `src/g2p/english.js` gets one word
and no neighbours, and the dictionary is a `Map` with one value per spelling.
`pronounceWord()` in `src/g2p/index.js` calls it as
`WORD_PRONOUNCERS[language](word)`.

Root cause 2: `readCmudict()` in `scripts/build-g2p-data.mjs` drops every
second pronunciation of CMUdict, so the data never had both readings:

```js
if (/\(\d+\)$/.test(word) || entries.has(word)) {
  continue;
}
```

## What to do

1. Create `src/g2p/english-heteronyms.js` with a hand-written table
   `ENGLISH_HETERONYMS`. A word maps to a list of readings; the **first**
   reading is the default. Tags: `N` noun, `A` adjective, `V` verb (base or
   present), `D` past tense or participle.

   ```js
   record: [{ tags: 'N', ipa: 'ˈɹɛkɚd' }, { tags: 'V', ipa: 'ɹəˈkɔɹd' }],
   close: [
     { tags: 'V', ipa: 'ˈkloʊz' },
     { tags: 'A', ipa: 'ˈkloʊs', next: ['to', 'by', 'enough', 'together'] },
   ],
   bass: [
     { tags: 'NA', ipa: 'ˈbeɪs' },
     { tags: 'N', ipa: 'ˈbæs', cues: ['fish', 'fishing', 'lake', 'swam'] },
   ],
   ```

   `next` lists words that select the reading when they come directly after;
   `cues` lists words that select it when they occur anywhere in the sentence.

2. Fill the table with at least these words. Format: `word first|second`.

   Noun or adjective first (tags `NA`), verb second (tag `V`):

   ```
   record ˈɹɛkɚd|ɹəˈkɔɹd  present ˈpɹɛzənt|pɹɪˈzɛnt  object ˈɑbd͡ʒɛkt|əbˈd͡ʒɛkt
   project ˈpɹɑd͡ʒɛkt|pɹəˈd͡ʒɛkt  permit ˈpɝmɪt|pɚˈmɪt  house ˈhaʊs|ˈhaʊz
   conduct ˈkɑndʌkt|kənˈdʌkt  conflict ˈkɑnflɪkt|kənˈflɪkt  desert ˈdɛzɚt|dɪˈzɝt
   contest ˈkɑntɛst|kənˈtɛst  contract ˈkɑntɹækt|kənˈtɹækt  rebel ˈɹɛbəl|ɹɪˈbɛl
   contrast ˈkɑntɹæst|kənˈtɹæst  convict ˈkɑnvɪkt|kənˈvɪkt  survey ˈsɝveɪ|sɚˈveɪ
   decrease ˈdikɹis|dɪˈkɹis  increase ˈɪnkɹis|ɪnˈkɹis  escort ˈɛskɔɹt|ɪˈskɔɹt
   digest ˈdaɪd͡ʒɛst|daɪˈd͡ʒɛst  export ˈɛkspɔɹt|ɪkˈspɔɹt  address ˈædɹɛs|əˈdɹɛs
   import ˈɪmpɔɹt|ɪmˈpɔɹt  insult ˈɪnsʌlt|ɪnˈsʌlt  perfect ˈpɝfɪkt|pɚˈfɛkt
   progress ˈpɹɑɡɹɛs|pɹəˈɡɹɛs  protest ˈpɹoʊtɛst|pɹəˈtɛst  abuse əˈbjus|əˈbjuz
   subject ˈsʌbd͡ʒɛkt|səbˈd͡ʒɛkt  suspect ˈsʌspɛkt|səˈspɛkt  wind ˈwɪnd|ˈwaɪnd
   defect ˈdifɛkt|dɪˈfɛkt  transport ˈtɹænspɔɹt|tɹænˈspɔɹt  tear ˈtɪɹ|ˈtɛɹ
   compound ˈkɑmpaʊnd|kəmˈpaʊnd  extract ˈɛkstɹækt|ɪkˈstɹækt
   frequent ˈfɹikwənt|fɹiˈkwɛnt  absent ˈæbsənt|æbˈsɛnt
   excuse ɪkˈskjus|ɪkˈskjuz  separate ˈsɛpɚət|ˈsɛpɚˌeɪt
   estimate ˈɛstəmət|ˈɛstəˌmeɪt  graduate ˈɡɹæd͡ʒuət|ˈɡɹæd͡ʒuˌeɪt
   alternate ˈɔltɚnət|ˈɔltɚˌneɪt  moderate ˈmɑdɚət|ˈmɑdɚˌeɪt
   ```

   Verb first (tag `V`, the default), noun second (tag `N`):

   ```
   use ˈjuz|ˈjus   refuse ɹɪˈfjuz|ˈɹɛfjus   produce pɹəˈdus|ˈpɹoʊdus
   reject ɹɪˈd͡ʒɛkt|ˈɹid͡ʒɛkt   convert kənˈvɝt|ˈkɑnvɝt   insert ɪnˈsɝt|ˈɪnsɝt
   combine kəmˈbaɪn|ˈkɑmbaɪn   resume ɹɪˈzum|ˈɹɛzəˌmeɪ   sow ˈsoʊ|ˈsaʊ
   ```

   Other pairs (tags in brackets; a reading without a tag is chosen only by
   its `cues`):

   ```
   read ˈɹid[V]|ˈɹɛd[D]   live ˈlɪv[V]|ˈlaɪv[A]   lives ˈlɪvz[V]|ˈlaɪvz[N]
   wound ˈwund[N]|ˈwaʊnd[D]   dove ˈdʌv[N]|ˈdoʊv[D]
   close ˈkloʊz[V]|ˈkloʊs[A, next as in step 1]
   content ˈkɑntɛnt[N]|kənˈtɛnt[A, next: with]
   invalid ɪnˈvælɪd[NA]|ˈɪnvəlɪd[cues: nurse hospital wheelchair bedridden]
   minute ˈmɪnət[N]|maɪˈnut[A, next: detail details amount amounts quantity]
   lead ˈlid[VN]|ˈlɛd[N, cues: pipe pipes pencil paint poisoning metal]
   bow ˈbaʊ[VN]|ˈboʊ[N, cues: arrow arrows tie violin ribbon rainbow string]
   bass ˈbeɪs[NA]|ˈbæs[N, cues as in step 1]
   ```

   For every entry with an `N` and a `V` reading except `house`, the `-s`
   form (`records`) is also a heteronym: add the plural ending to both
   readings (`ɪz` after `s z ʃ ʒ t͡ʃ d͡ʒ`, `s` after `p t k f θ`, else `z`).

3. Create `src/g2p/english-context.js` with exported word lists and the
   exported function `chooseReading(readings, context)`:

   ```
   DETERMINERS  the a an this that these those my your his her its our
                their some any no each every another many few several all
                both two three four five six seven eight nine ten
   SUBJECTS     i you we they he she it who
   MODALS       to will would can could shall should may might must do
                does did don't doesn't didn't won't can't let's
   BE           am is are was were be been being seem seems
   HAVE         have has had having
   DEGREE       very so too quite more most as
   PREPOSITIONS of in on at for with by from about into without
   OBJECTS      me him us them it this that
   SKIPPED      not never always often just also really still only
   PAST_CUES    yesterday ago last earlier already once was were
   ```

   `context` is `{before, after, sentence}`: lowercased words before the word
   (nearest first) and after it inside the same clause, and all words of the
   sentence. Let `p` be the first word of `before` that is not in `SKIPPED`,
   and `n` the first word of `after`. Apply the first rule that matches and
   whose tag exists in `readings`, and return the first reading that has
   that tag:
   1. A reading whose `next` contains `n`, or whose `cues` share a word with
      `sentence`;
   2. `p` in `MODALS`: `V`;
   3. `p` in `HAVE`: `D`; `p` in `BE`: `A`, else `D`;
   4. Readings have `V` and `D`, and `p` is `he`, `she` or `it`, or
      `sentence` has a word of `PAST_CUES`: `D`;
   5. `p` in `SUBJECTS`: `V`, else `D`;
   6. `p` in `DEGREE`: `A`;
   7. `p` in `DETERMINERS` or `PREPOSITIONS`, or `p` ends in `'s`: `N`, else
      `A`;
   8. `n` in `DETERMINERS` or `OBJECTS`: `V` (this covers the imperative
      `Record the song`);
   9. Otherwise the first reading.

4. `englishWordToIpa(word, context)`: look the lowercased word up in the
   table first. With a `context` return
   `{ipa, source: 'heteronym', tag}` from `chooseReading()`; without one
   return the first reading. Words outside the table behave as today.
5. In `src/g2p/index.js` build the context in `textToIpa()` from the list
   `normalized`: a clause ends at any item with `kind === 'break'`; a
   sentence ends at a break whose symbol ends in `.`, `!`, `?` or `…`. Pass it
   through `pronounceItem()` and `pronounceSource()` to
   `pronounceWord(word, language, context)`. Pronouncers of other languages
   ignore the third argument ({{P36}} uses it for Russian).
6. Leave `readCmudict()` as it is: the table is the only source of both
   readings. Add `'heteronym'` to the type of `source` in `src/index.d.ts`.

## Tests

Add `tests/english-heteronyms.test.js` (`describe('English heteronyms')`):

- `has at least 60 words with two different readings`.
- `every reading parses`: `parseIpa()` accepts each `ipa` of the table.
- `chooses by the word before`, with `textToIpa(text, {lang: 'en'}).ipa`:
  - `I will read the book.` contains `ˈɹid`; `I read the book yesterday.`
    and `She read the letter.` and `I have read it.` contain `ˈɹɛd`;
  - `Did you record the record?` contains `ɹəˈkɔɹd ðə ˈɹɛkɚd`;
  - `I live here.` has `ˈlɪv`; `A live show.` has `ˈlaɪv`;
  - `The wind blows.` has `ˈwɪnd`; `Wind the clock.` has `ˈwaɪnd`;
  - `I use it.` has `ˈjuz`; `It is of no use.` has `ˈjus`;
  - `Close the door.` has `ˈkloʊz`; `Stay close to me.` has `ˈkloʊs`;
  - `They present the plan.` has `pɹɪˈzɛnt`; `A present for you.` has
    `ˈpɹɛzənt`; `He dove in.` has `ˈdoʊv`; `The dove flew.` has `ˈdʌv`;
  - `A bass swam by.` has `ˈbæs`; `The bass guitar.` has `ˈbeɪs`;
  - `A lead pipe.` has `ˈlɛd`; `They lead the team.` has `ˈlid`;
  - `He records songs.` has `ɹəˈkɔɹdz`; `The records are old.` has
    `ˈɹɛkɚdz`.
- `falls back to the first reading without context`:
  `englishWordToIpa('record').ipa` is `ˈɹɛkɚd`.

## Acceptance criteria

- [ ] `node experiments/issue-11-audit-m3a.mjs` prints the readings marked
      `<-` in the block above; the first line keeps `ˈɹɛd`.
- [ ] The table has at least 60 words and every test sentence above gets
      the expected reading.
- [ ] No model file, no training step and no new dependency is added.
- [ ] `npm run check` and `npm test` pass; a patch changeset is added.

## Out of scope

- A full part-of-speech tagger and a large lexicon: {{P35}}.
- Weak forms of function words (`the` before a vowel, `used to`): {{P73}}.
- Russian homographs: {{P36}}. Manual overrides in markup: {{P38}}.

## References

- CMU Pronouncing Dictionary, https://github.com/cmusphinx/cmudict (holds
  the variants as `word(2)`; use it to cross-check the table by hand).
- Yarowsky, D. (1997). Homograph disambiguation in text-to-speech synthesis.
  In van Santen et al. (eds.), Progress in Speech Synthesis. Springer.
