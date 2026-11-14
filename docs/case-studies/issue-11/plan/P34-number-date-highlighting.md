---
id: P34
title: Expanded numbers and dates are highlighted as one word
type: Bug
milestone: M3
blocked_by: []
requirements: [R10, R17]
---

## Goal

When the text holds a number, a date, a time or a sum of money, the timeline
must say **what is being spoken** inside it. The written token (`25`,
`3/4/2024`) stays one highlighted word, but every syllable of it carries the
spoken letters (`twen`, `ty`, `five`), and for dates, times and money also
the part of the token it reads (`3`, `4`, `2024`).

## Why

The app highlights the syllable that is being spoken. For `3/4/2024` the
voice says seven syllables over about two seconds while one block of digits
is lit and nothing moves. A learner cannot see how the number is read. The
recognition result ({{P61}}, {{P62}}) uses the same timeline shape, so the
shape must be fixed before recognition is built on it.

## Current state

Reproduce with `node experiments/issue-11-audit-m3a.mjs` (section 4):

```
{"text":"25","ipa":"ˈtwɛnti ˈfaɪv","syllables":[null,null,null]}
{"text":"3/4/2024","ipa":"ˈmɑɹt͡ʃ ˈfɔɹθ ˈtwɛnti ˈtwɛnti ˈfɔɹ",
 "syllables":[null,null,null,null,null,null,null]}
{"text":"$5","ipa":"ˈfaɪv ˈdɑlɚz","syllables":[null,null,null]}
{"text":"3:30","ipa":"ˈθɹi ˈθɝˌdi","syllables":[null,null,null]}
ru {"text":"25","ipa":"ˈdvat͡sətʲ pʲatʲ","syllables":[null,null,null]}
zh {"text":"25","ipa":"ɚ˥˩ ʂɻ̩˧˥ u˨˩˦","syllables":[null,null,null]}
```

`null` means that the syllable has no `text`. Two facts cause this in
`src/articulation/timeline.js`.

Fact 1: one timeline word per written token is **on purpose** (header
comment: "Words that verbalise the same source text ... form one timeline
word") and `tests/timeline.test.js` checks it. That part is right and stays.

Fact 2 (the defect): the spoken words are thrown away. `spellSyllables()`
returns early for every verbalised word, and `timelineWord()` copies only
`first.original` into the result:

```js
const [source] = sources;
if (sources.length !== 1 || !readAsWritten(source)) {
  return;
}
```

The words that were spoken are known at that point: `textToIpa('25').words`
holds `{text: 'twenty', original: '25', sourceStart: 7, sourceEnd: 9}` and
`{text: 'five', ...}` with the same range. A test even demands the loss:
`keeps verbalised text as one word without syllable spelling` expects
`date.syllables.every((s) => s.text === undefined)`.

## What to do

### New fields (all optional, nothing existing changes)

On a timeline **word** that is not read as written:

- `spoken`: string, the spoken words joined by one space
  (`"twenty five"`, `"March fourth twenty twenty four"`, zh `"二十五"`).

On every **syllable** of such a word:

- `spokenWord`: number, index of the spoken word this syllable belongs to
  (index into `word.spoken.split(' ')`).
- `spoken`: string, the letters of that spoken word that spell this
  syllable. Joining `spoken` of all syllables with the same `spokenWord`
  gives the spoken word exactly.
- `partStart`, `partEnd`: numbers, offsets in the original text of the part
  of the token that this spoken word reads. Present only when the part is
  known (dates, times, money, number with unit).

A syllable of a verbalised word never gets `text`, `sourceStart` or
`sourceEnd`. This keeps old readers working: `wordRanges()` in
`examples/universal-app/src/components/highlight.js` treats a word as
spelled only when every syllable has `sourceStart`.

Example for `I have 25 apples on 3/4/2024.` (`...` are the existing fields):

```js
{ text: '25', spoken: 'twenty five', sourceStart: 7, sourceEnd: 9, ...,
  syllables: [
    { ..., spoken: 'twen', spokenWord: 0 },
    { ..., spoken: 'ty', spokenWord: 0 },
    { ..., spoken: 'five', spokenWord: 1 } ] }
{ text: '3/4/2024', spoken: 'March fourth twenty twenty four',
  sourceStart: 20, sourceEnd: 28, ...,
  syllables: [
    { ..., spoken: 'March', spokenWord: 0, partStart: 20, partEnd: 21 },
    { ..., spoken: 'fourth', spokenWord: 1, partStart: 22, partEnd: 23 },
    { ..., spoken: 'twen', spokenWord: 2, partStart: 24, partEnd: 28 },
    { ..., spoken: 'ty', spokenWord: 2, partStart: 24, partEnd: 28 },
    ... ] }
```

### Steps

1. `src/g2p/normalize.js`: `emitWords()` already spreads extra fields of a
   word entry into the item. Let the handlers `date()`, `time()`, `money()`,
   `currencyFirst()` and `unit()` add `partStart` and `partEnd` (absolute
   offsets) to the words of each part. Get the offsets of the regular
   expression groups with the `d` flag (`found.indices`). The verbalizers
   (`src/g2p/verbalize-*.js`) must say which words belong to which part:
   let `date()` return an object with the word lists `year`, `month` and
   `day` and the spoken order, `order: ['month', 'day', 'year']`, or keep
   returning a flat list when a language cannot split it; a flat list means
   "no parts". Do the same for the time
   (`hour`, `minute`, `period`) and money (`amount`, `currency`) functions.
2. `src/g2p/index.js`: `pronounceSource()` copies `partStart` and `partEnd`
   from the item into the word (add them to `range` when defined).
3. `src/articulation/timeline.js`:
   - in `groupWords()` keep, next to `chunks`, a parallel list `chunkSources`
     with the source of every chunk;
   - add `speakSyllables(syllables, split, group)`: for a group that is not
     read as written, walk the chunks. Chunks with the same source form one
     spoken word when the language is not Chinese; for a Chinese source every
     chunk is one character of `source.text`. Compute the letters with
     `syllableSpans(source.text, counts)` as `spellSyllables()` does. When it
     returns `null`, give the whole spoken word to the first syllable and
     `''` to the others;
   - call it from `timelineWord()` after `spellSyllables()` and set
     `word.spoken` to the texts of `group.sources` joined by a space.
4. `src/index.d.ts`: add the optional fields to `TimelineSyllable` and
   `TimelineWord` with one-line comments.
5. `examples/universal-app/src/components/highlight.js`: export a new helper
   `spokenPieces(word)` that returns `[{text, syllable}]` built from the
   `spoken` fields with a space between spoken words, and in `wordRanges()`
   return one range per **part** (`partStart` to `partEnd`, with the index of
   the first syllable of the part) when every syllable has `partStart`.
   Show the spoken words of the active word in the existing IPA line or
   under the text; keep the layout of other words unchanged.
6. Change the old test that expects `s.text === undefined` (quoted under
   Current state): give it the new name listed under Tests and replace that
   check by the checks listed there.
7. Extend section 4 of `experiments/issue-11-audit-m3a.mjs` to print
   `spoken` instead of `text` for verbalised words and commit the new output.

## Tests

In `tests/timeline.test.js`:

- `keeps verbalised text as one word and exposes what is spoken`: for
  `On 3/5/2024 the U.S.A. paid` the word texts are still
  `['On', '3/5/2024', 'the', 'U.S.A.', 'paid']` and the date range is still
  `[3, 11]`; `date.spoken` is `March fifth twenty twenty four`; no syllable
  of the date has `text` or `sourceStart`; the `spoken` values are
  `['March', 'fifth', 'twen', 'ty', 'twen', 'ty', 'four']`; `partStart` and
  `partEnd` are `[3, 4]`, `[5, 6]` and five times `[7, 11]`.
- `spells the syllables of a spoken number`: `I have 25 apples` gives
  `spoken: 'twenty five'` and syllables `twen`, `ty`, `five` with
  `spokenWord` `0, 0, 1` and no `partStart`.
- `joins back to the spoken words`: for the texts `$5 at 3:30`,
  `У меня 25 яблок`, `我有25个苹果` and `मेरे पास 25 सेब हैं`, joining the
  syllable `spoken` values per `spokenWord` gives `word.spoken.split(' ')`.
- `leaves ordinary words alone`: in `I have 25 apples` the words `I`, `have`
  and `apples` have no `spoken` field and their syllables have `text`.

In `tests/universal-app-highlight.test.js`:

- `splits a date into its parts`: `wordRanges()` for the date word returns
  three ranges; for the word `25` it returns one range with
  `syllable: null`, as today.
- `lists the spoken syllables`: `spokenPieces()` for `25` returns the texts
  `twen`, `ty`, ` `, `five`.

## Acceptance criteria

- [ ] `node experiments/issue-11-audit-m3a.mjs` prints no `null` in the
      syllable lists of section 4 for English, Russian, Chinese and Hindi.
- [ ] Words read as written produce exactly the same timeline objects as
      before (compare `JSON.stringify` for `Hello world, how are you?`).
- [ ] The tests above exist and pass; `tests/highlight.test.js` passes
      unchanged.
- [ ] In the app, playing `I have 25 apples on 3/4/2024.` lights `3`, then
      `4`, then `2024`, and shows `twen·ty five` while `25` is lit
      (screenshot in the pull request).
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- Mapping single digits to syllables inside a plain number (`2` to `twenty`).
  It does not exist in general (`12` is `twelve`).
- Changing how numbers are read. The highlighting during recognition:
  {{P62}}.

## References

- `src/articulation/timeline.js`, `src/g2p/orthography.js`,
  `src/g2p/normalize.js`, `tests/timeline.test.js` (current behaviour).
- Taylor, P. (2009). Text-to-Speech Synthesis. Cambridge University Press.
  Chapter on text normalisation (verbalisation of non-standard words).
