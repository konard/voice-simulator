---
id: P31
title: Mandarin erhua is spoken as a separate syllable
type: Bug
milestone: M3
blocked_by: []
requirements: [R17, R19]
---

## Goal

A Mandarin word with erhua (the suffix 儿 written after another character, or
`r` at the end of a pinyin syllable) must be spoken as **one** syllable whose
rime ends in an r-sound: 花儿 `huār` is `xwaɻ˥`. Today it is two syllables,
`xwa˥ ɚ˧˥`, and pinyin with erhua is not read as Chinese at all.

## Why

Erhua is part of standard Mandarin: 一点儿, 哪儿, 玩儿 and 小孩儿 are beginner
words. An extra syllable with a rising tone changes the rhythm, the tone
pattern and the syllable count that the highlighting shows. The same form is
needed in the other direction: IPA to text ({{P56}}) and tone recognition
({{P58}}) must agree with what the synthesiser says.

## Current state

Reproduce with `node experiments/issue-11-audit-m3a.mjs` (section 1):

```
zh 花儿: "xwa˥ ɚ˧˥"            <- two syllables, should be xwaɻ˥
zh 一点儿: "i˥˩ tjɛn˨˩ ɚ˧˥"     <- should be i˥˩ tjaɻ˨˩˦
zh 小孩儿: "ɕjɑʊ˨˩ xaɪ˧˥ ɚ˧˥"   <- should be ɕjɑʊ˨˩ xaɻ˧˥
zh 事儿: "ʂɻ̩˥˩ ɚ˧˥"            <- should be ʂəɻ˥˩
zh 空儿: "kʰʊŋ˥ ɚ˧˥"           <- one syllable; kòngr needs a dictionary
zh 儿子: "ɚ˧˥ t͡sɹ̩˨˩˦"          <- correct: 儿 is a full syllable here
zh 女儿: "ny˨˩ ɚ˧˥"            <- correct
zh huār: "ˈhʌɹ"               <- read with English rules
zh yìdiǎnr: "ˈjdɪnɹ"          <- read with English rules
```

Root cause 1: `hanziToPinyin()` in `src/g2p/chinese.js` looks up every
character on its own and nothing merges 儿 into the syllable before it:

```js
result.push({
  char: chars[index],
  pinyin: getReadings().get(chars[index]) ?? null,
  group: index,
});
```

The table in `src/g2p/chinese-dict.js` gives 儿 the reading `ér`.

Root cause 2: `pinyinSyllableToIpa()` in `src/g2p/pinyin.js` has no final that
ends in `r` except `er`, so `segmentWord('huār')` returns `null`, `isPinyin()`
is false and the word goes to the English rules.

Root cause 3 (would appear after a fix): `hanSpans()` in
`src/g2p/orthography.js` returns `null` unless there is exactly one Han
character per syllable, so 花儿 with one syllable would lose its highlighting.

## What to do

1. In `src/g2p/pinyin.js` add an exported constant `ERHUA_FINALS`. Its keys
   are the keys of `FINALS`; its values are the r-coloured rimes:

   ```
   a ai an        -> aɻ      ia ian       -> jaɻ
   ua uai uan     -> waɻ     üan          -> ɥaɻ
   ang -> ɑ̃ɻ      iang -> jɑ̃ɻ             uang -> wɑ̃ɻ
   e   -> ɤɻ      ei en -> əɻ             ui uei un uen -> wəɻ
   eng -> ə̃ɻ      ueng -> wə̃ɻ
   i in -> jəɻ    ing -> jə̃ɻ              ü ün -> ɥəɻ
   ie  -> jɛɻ     üe  -> ɥɛɻ              o uo -> woɻ
   ao  -> ɑʊɻ     iao -> jɑʊɻ             ou -> oʊɻ    iu iou -> joʊɻ
   u   -> uɻ      ong -> ʊ̃ɻ               iong -> jʊ̃ɻ
   ```

   The apical vowel (`i` after `z c s zh ch sh r`, written `ɹ̩` or `ɻ̩` by
   `finalIpa()`) becomes `əɻ`. The rules are: a final `i` glide or `n` is
   dropped; `ng` is dropped and the vowel is nasalised; high vowels `i` and
   `ü` become glides before `əɻ`.

2. Add an exported function `erhuaIpa(initial, final)` next to `finalIpa()`
   that returns the initial consonant plus the rime from the table (or `əɻ`
   for the apical vowel).
3. `pinyinSyllableToIpa(syllable)`: when the letters end in `r`, are not `er`
   and the letters without the `r` are a valid syllable, return
   `{ipa, tone, base, erhua: true}` with `ipa` from `erhuaIpa()`. The tone is
   the tone of the syllable (`huār` is tone 1). Accept the tone digit before
   or after the `r`: `huar1` and `hua1r`.
4. `segmentPinyin()`: let the pattern take an `r` after the tone digit only
   when no letter follows. `segmentWord()`: accept an erhua syllable only as
   the **last** syllable of the word, so `huaren` stays `hua` + `ren`.
5. In `src/g2p/chinese.js` add the exported sets `SYLLABIC_ER_BEFORE` (words
   that start with 儿: 儿子 儿童 儿女 儿孙 儿歌 儿科 儿媳 儿时 儿戏) and
   `SYLLABIC_ER_AFTER` (words that end with 儿: 女儿 婴儿 幼儿 孤儿 胎儿 少儿
   男儿 健儿 宠儿 患儿 妻儿 小儿 混血儿 新生儿 托儿).
6. In `hanziToPinyin()`, a 儿 is **erhua** when all of these hold: it is not
   the first character of the run; the text from this 儿 on does not start
   with a word of `SYLLABIC_ER_BEFORE`; the text up to and including this 儿
   does not end with a word of `SYLLABIC_ER_AFTER`; the character before it
   has a known reading that is not `er`. For an erhua 儿 push the item below
   and replace the `pinyin` of the previous item by the same pinyin with `r`
   appended (`huā` becomes `huār`):

   ```js
   { char: '儿', pinyin: null, group: previous.group, erhua: true }
   ```

7. `chineseSyllables()` already gives `ipa: null` to items without pinyin;
   `splitHanRun()` in `src/g2p/index.js` then builds the word 花儿 with one
   syllable because both characters share one `group`. Check this with the
   test below; change `splitHanRun()` only if the test fails.
8. `hanSpans(word, count)` in `src/g2p/orthography.js`: when there are more
   Han characters than syllables, merge the span of the last 儿 that is not
   the first character into the span before it, and repeat until the counts
   match. Return `null` only when no such 儿 is left.
9. The tone sandhi in `applyToneSandhi()` must see the merged syllable with
   the tone of the host: 一点儿 before a pause keeps the full third tone.
10. Extend the header comment of `pinyin.js` with one sentence on erhua.

Do not change how 儿 is read at the start of a word or in the words of the two
sets. Do not add a rhotic diacritic (`˞`) form; the output uses the consonant
`ɻ` after the vowel, which `parseIpa()` already reads as one syllable.

## Tests

Add to `tests/text-to-ipa.test.js` a `describe('erhua', ...)` block:

- `merges 儿 into the previous syllable`: with `{ lang: 'zh' }`, 花儿 gives
  `xwaɻ˥`; 一点儿 gives `i˥˩ tjaɻ˨˩˦`; 小孩儿 gives `ɕjɑʊ˨˩ xaɻ˧˥`; 玩儿 gives
  `waɻ˧˥`; 事儿 gives `ʂəɻ˥˩`; 哪儿 gives `naɻ˨˩˦`.
- `keeps a syllabic 儿`: 儿子 starts with `ɚ˧˥`; 女儿 is `ny˨˩ ɚ˧˥`; 儿童 is
  `ɚ˧˥ tʰʊŋ˧˥`; 他儿子 has three syllables.
- `reads pinyin erhua`: `huār`, `huar1` and `hua1r` give `xwaɻ˥`; `yìdiǎnr`
  gives `i˥˩ tjaɻ˨˩˦`; `huaren` (no tone) still has two syllables.
- `covers every final`: for every key of `FINALS` except `er` and `ê`,
  `ERHUA_FINALS` has a value that ends in `ɻ`, and `parseIpa()` of
  `'p' + value + '˥'` gives tokens that `syllabifyTokens()` groups into
  exactly one syllable.

Add to `tests/syllables.test.js` (or the file that tests `syllableSpans`):

- `gives an erhua word one span`: `syllableSpans('花儿', [one syllable])`
  returns `[{ start: 0, end: 2 }]`; `syllableSpans('女儿', [two syllables])`
  still returns two spans.

Add to `tests/timeline.test.js`:

- `highlights an erhua word as one syllable`: the timeline of 我喜欢花儿 has a
  word with `text` 花儿 and exactly one syllable whose `text` is 花儿.

## Acceptance criteria

- [ ] `node experiments/issue-11-audit-m3a.mjs` prints `zh 花儿: "xwaɻ˥"` and
      no line of section 1 for 花儿, 一点儿, 小孩儿, 玩儿, 事儿, 空儿, 哪儿,
      `huār` or `yìdiǎnr` contains `ɚ` or `ˈ`.
- [ ] The lines for 儿子, 女儿 and 儿童 are unchanged.
- [ ] The planned duration of 花儿 is shorter than before: one vowel segment
      instead of two in `planUtterance(textToIpa('花儿', {lang:'zh'}).ipa)`.
- [ ] The new tests exist and pass; all existing tests pass unchanged.
- [ ] `npm run check` and `npm test` pass; a patch changeset is added; the
      refreshed `experiments/issue-11-audit-m3a.txt` is committed.

## Out of scope

- Deciding from a large dictionary which words take erhua and which reading
  a character has (空儿 is `kòngr`): {{P35}}.
- The neutral tone and tone coarticulation: {{P37}}.
- Regional accents with more or less erhua than the standard: {{P45}}.
- The acoustic quality of `ɻ` itself (tongue shape): not changed here.

## References

- Duanmu, S. (2007). The Phonology of Standard Chinese, 2nd edition. Oxford
  University Press. Chapter on the `[r]` suffix.
- Lin, Y.-H. (2007). The Sounds of Chinese. Cambridge University Press.
- Sources differ in small details of the table (the vowel of `ie`, `üe` and
  `o` with erhua). The table above is the plan's choice; keep it in one
  constant so that it is easy to correct.
- Research notes:
  `docs/case-studies/issue-11/research/4-linguistics-and-speech-modes.md`.
