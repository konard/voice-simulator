---
id: P37
title: Tone model with targets, the neutral tone and tone coarticulation
type: Feature
milestone: M3
blocked_by: [P30]
requirements: [R17, R19]
---

## Goal

Replace the straight pitch line per syllable by a tone model in which every
tone is a **pitch target** that the voice approaches during its syllable,
starting from where the previous syllable ended. The model must give the
Mandarin neutral tone a pitch that depends on the tone before it and a short
duration, fix the sandhi of 一 and 不, apply sandhi across spaces, and work
for any tone written with Chao tone letters (Cantonese, Thai, Vietnamese).

## Why

In real speech a tone starts where the tone before it ended. Xu (1997)
measured that the preceding tone changes the pitch of a Mandarin syllable by
up to 55 Hz at its start, 17 Hz in the middle and 4 to 7 Hz at the end.
Without this, tones sound like single words glued together. The neutral tone
is in the most common words (的, 了, 吗, 妈妈) and is wrong today. Tone
recognition ({{P58}}) calls the same model to predict the shape of a tone.

## Current state

Reproduce with `node experiments/issue-11-audit-m3a.mjs` (section 7). `f0` is
the pitch in Hz at the start and end of each vowel, `duration` is in ms:

```
zh f0 妈妈: [[155,152],[113,96]]  duration [121,169]
zh f0 爸爸: [[141,107],[108,95]]  duration [121,169]
zh 第一名: "ti˥˩ i˥˩ miŋ˧˥"    <- 一 must stay i˥ (ordinal)
zh 十一月: "ʂɻ̩˧˥ i˧˥ ɥɛ˥˩"     <- 一 must stay i˥ (number)
zh 一九九一: "i˥˩ t͡ɕjoʊ˧˥ t͡ɕjoʊ˨˩ i˥"   <- first 一 must be i˥
zh 看一看: "kʰan˥˩ i˧˥ kʰan˥˩"  <- 一 must be neutral
zh 是不是: "ʂɻ̩˥˩ pu˧˥ ʂɻ̩˥˩"    <- 不 must be neutral
zh 爷爷: "jɛ˧˥ jɛ˧˥"   zh 奶奶: "naɪ˧˥ naɪ˨˩˦"   <- second syllable neutral
```

Five defects:

1. No carry-over. `fillPitch()` in `src/articulation/plan.js` draws each
   syllable on its own: `values[frame] = from + (to - from) * t`.
2. The neutral tone has no tone letter, so `syllablePitch()` in
   `src/articulation/prosody.js` skips the `if (tone)` branch and treats it
   as an unstressed syllable of a non-tonal language. Its pitch is the same
   after every tone (113 Hz and 108 Hz above) and, when it is last, it gets
   the sentence contour `CONTOURS[phraseContour(phrase.pause)]`.
3. The neutral syllable is longer (169 ms) than the full one (121 ms):
   `vowelDuration()` in `plan.js` has no rule for it and adds final
   lengthening.
4. `applyToneSandhi()` in `src/g2p/pinyin.js` changes every 一 that is not
   last, and knows no neutral 一 or 不:

   ```js
   } else if (current.char === '一' && next.tone === 4) {
     current.tone = 2;
   } else if (current.char === '一' && next.tone !== 5) {
     current.tone = 4;
   }
   ```

5. Sandhi and the half third tone stop at every space. Section 4 of
   `node experiments/issue-11-audit-m3c.mjs` shows it:

   ```
   zh 我很好: "wo˨˩ xən˧˥ xɑʊ˨˩˦"
   zh 我 很 好: "wo˨˩˦ xən˨˩˦ xɑʊ˨˩˦"        <- must equal the line above
   zh wo3hen3hao3: "wo˨˩ xən˧˥ xɑʊ˨˩˦"
   zh wǒ hěn hǎo: "wo˨˩˦ xən˨˩˦ xɑʊ˨˩˦"      <- pinyin is written with spaces
   zh 不对: "pu˧˥ tweɪ˥˩"   zh 不 对: "pu˥˩ tweɪ˥˩"
   ```

   `chineseWordToIpa()` and `chineseSyllables()` in `src/g2p/chinese.js`
   call `syllablesToIpa()` for one word or one run of Hanzi, and
   `textToIpa()` in `src/g2p/index.js` only joins their results. Pinyin is
   normally typed with a space between syllables or words, so typed pinyin
   never gets sandhi.

## What to do

### 1. The model: `src/articulation/tone-model.js` (new)

Work in semitones (st). During one interval the target is the line
`x(t) = m·t + b` (`t` in seconds from the interval start). The pitch is

```
y(t)   = x(t) + P(t)·e^(−λt),   P(t) = c1 + c2·t + c3·t²
c1 = y(0) − b
c2 = y'(0) + c1·λ − m
c3 = (y''(0) + 2·c2·λ − c1·λ²) / 2
y'(t)  = m + (c2 + 2·c3·t − λ·P(t))·e^(−λt)
y''(t) = (2·c3 − 2·λ·(c2 + 2·c3·t) + λ²·P(t))·e^(−λt)
```

`y`, `y'` and `y''` at the end of an interval are the start values of the
next one. This is the quantitative target approximation model (Prom-on, Xu
and Thipakorn 2009). Export:

- `TONE_RATES = {level: 50, rise: 40, fall: 40, low: 35, neutral: 25}`: `λ`
  per second. The paper reports 34 to 55 for the four Mandarin tones;
  `neutral` is this plan's starting value (a weak, slow approach).
- `approachTargets(intervals, state, frameRate)`: `intervals` is a list of
  `{duration, from, to, rate}` (st, `m = (to − from) / duration`,
  `b = from`); `state` is `{value, velocity, acceleration}` or `null` (then
  `value = from` of the first interval, the rest 0). Returns
  `{values, state}`: one value per frame and the end state.
- `toneIntervals(tone, duration)`: turns Chao levels into intervals in level
  units. One level gives one interval with `from = to`. `n` levels give
  `n − 1` intervals between the positions of `TONE_POINT_POSITIONS` from
  {{P30}} (`[2, 1, 4]`: 40 % and 60 % of the duration). `rate`: `rise` when
  `to > from`, `fall` when `to < from`, else `low` when the level is 2 or
  less, else `level`.
- `NEUTRAL_LEVELS = {high: 2, rise: 3, low: 4, fall: 1, none: 2}` and
  `neutralLevel(previousTone)`: `fall` when the previous tone's first level
  is above its last; `low` when its highest level is 2 or less or it has
  three levels; `rise` when first is below last; `high` otherwise; `none`
  when there is no previous tone in the phrase or it was neutral.
- `toneCurve(tone, {start, scale, duration, count, previous})`: `count`
  values in st around level 3 for one syllable that starts at pitch `start`;
  an empty `tone` means neutral. {{P58}} uses it.

### 2. Planner

1. `pitchTargets()` in `prosody.js`: when a phrase has a nucleus with a
   tone, return for each nucleus `{segment, from, to, points, intervals}`.
   Levels become st relative to `head.pitch`:
   `st = shift + (level − 3) × scale`, with today's `scale` and with `shift`
   equal to the exponent of today's `base` (register shift minus
   declination). A nucleus without tone and without stress mark in such a
   phrase is **neutral**: one interval, `from = to = neutralLevel(...)`,
   `rate: TONE_RATES.neutral`. If it is the last nucleus and the phrase
   contour is `rise`, add `CONTOURS.rise[0] * range + CONTOURS.rise[1]` to
   `to`, so `好吗？` still rises. Phrases without any tone are unchanged.
2. `fillPitch()` in `plan.js`: for a tonal phrase, the interval of syllable
   `k` lasts from the end of nucleus `k − 1` (the first: its own first
   voiced frame) to the end of nucleus `k`. Call `approachTargets()` once
   per phrase with `state = null` and write `head.pitch × 2^(st / 12)` into
   every frame. Keep `interpolateGaps()` for pauses.
3. `vowelDuration()`: add `neutral: true` to the context for such a nucleus
   and multiply by the exported `NEUTRAL_DURATION = 0.6`.
4. Focus and question raises are additive: {{P39}} adds st to `shift` and
   multiplies `scale` per syllable. Do not build focus here.

### 3. Sandhi in `src/g2p/pinyin.js` and words in `src/g2p/chinese.js`

Change `applyToneSandhi()`; `prev` and `next` are the neighbour syllables:

- 一 or 不 with `prev.char === next.char` (看一看, 是不是, 好不好): tone 5.
- 一 keeps tone 1 when `prev.char` is one of `第十初〇零二三四五六七八九`,
  when `next.char` is one of `〇零一二三四五六七八九`, or when the text from
  this 一 starts with a word of the new exported set `YI_FIRST_TONE_WORDS`
  (`一月 一号 一楼 一班 一等 一级 一流 一年级`).
- Otherwise the rules of today stay (tone 2 before tone 4, else tone 4).

Add to `PHRASES` in `chinese.js`, written as spoken: 爷爷 `yé ye`, 奶奶
`nǎi nai`, 姐姐 `jiě jie`, 哥哥 `gē ge`, 弟弟 `dì di`, 妹妹 `mèi mei`, 叔叔
`shū shu`, 看看 `kàn kan`. Larger word lists: {{P35}}.

### 4. Sandhi across spaces

1. In `src/g2p/chinese.js` export `chineseRunToIpa(words)`. `words` is a
   list of `{text, pinyin}`: `pinyin` is the field that `chineseWordToIpa()`
   returns (syllables separated by spaces, before sandhi).
   1. Split every `pinyin` on spaces into syllables. Give a syllable its
      `char` only when all characters of `text` are Hanzi (`isHanzi`) and
      their count equals the count of syllables of that word.
   2. Call the existing `syllablesToIpa()` once with the syllables of all
      words in order. Do not copy its body: what it does later (for example
      after {{P31}}) must apply here too.
   3. If it returns fewer values than there are syllables, return `null`.
   4. Otherwise cut the list back into words and return one string per
      word, its syllables joined by spaces.
2. In `src/g2p/index.js` add `joinChineseRuns(items)` and call it in
   `textToIpa()` after the loop that fills `items` and before
   `markQuestions(items)`. A run is a longest sequence of neighbouring
   items that have `lang === 'zh'` and a non-empty string `pinyin`. A break
   item (`item.break`), an item of another language and an item without
   `pinyin` end the run. For every run of two or more items call
   `chineseRunToIpa()`; unless it returns `null`, set each `item.ipa` to its
   string. Nothing else of the items changes.
3. 一 and 不 typed as pinyin (`bu4 dui4`) keep the typed tone: without the
   character `bu4` may be another word. Say so in the comment.

## Tests

New `tests/tone-model.test.js` (`approachTargets` at 200 frames per second):

- `approaches a static target`: `{duration: 0.3, from: 0, to: 0, rate: 40}`
  from `{value: 5, velocity: 0, acceleration: 0}`: the values never rise; the
  value at 0.075 s is between 1.9 and 2.3; the last is below 0.01.
- `lags a ramp by 3 / rate`: `{duration: 1, from: 0, to: 10, rate: 50}` from
  `null`: the value at 0.5 s is between 4.35 and 4.45.
- `is continuous across intervals`: for `[5, 1]` then `[5]` (0.2 s each,
  levels × 2.3) no two neighbouring frames differ by more than 0.6 st.
- `splits tones into intervals`: `[5]` gives one `level` interval;
  `[2, 1, 4]` with duration 0.2 gives the durations 0.08 and 0.12 and the
  rates `fall` and `rise`.
- `picks the neutral level`: `[5]` → 2, `[3, 5]` → 3, `[2, 1]` and `[2, 1, 4]`
  → 4, `[5, 1]` → 1, `undefined` → 2.

Add to `tests/articulation.test.js` (`vibrato: 0`, `language: 'zh'`; `f0`
sampled inside the second vowel unless said otherwise):

- `starts a tone where the last one ended`: `f0` at 10 % in `ma˥˩ ma˥` is at
  least 2 st below `f0` at 10 % in `ma˥ ma˥`; at 95 % they differ by less
  than 1 st.
- `sets the neutral tone by the tone before it`: mean `f0` in `ma˥ ma` is at
  least 3 st above mean `f0` in `ma˥˩ ma`; in `ma˨˩ ma` `f0` at 90 % is at
  least 1 st above `f0` at 10 %.
- `shortens the neutral tone`: in `ma˥ ma ma˥` the second vowel lasts at most
  0.65 of the first; in `ma˥ ma` it is shorter than the first.
- `leaves non-tonal speech alone`: the `f0` channel of `həˈloʊ ˈwɝld` is
  equal, frame by frame, to a snapshot taken before the change.

Add to `tests/text-to-ipa.test.js` (`lang: 'zh'`), `describe('一 and 不')`:
第一名 `ti˥˩ i˥ miŋ˧˥`; 十一月 `ʂɻ̩˧˥ i˥ ɥɛ˥˩`; 一九九一
`i˥ t͡ɕjoʊ˧˥ t͡ɕjoʊ˨˩ i˥`; 看一看 `kʰan˥˩ i kʰan˥˩`; 是不是 `ʂɻ̩˥˩ pu ʂɻ̩˥˩`;
爷爷 `jɛ˧˥ jɛ`; 奶奶 `naɪ˨˩ naɪ`; unchanged: 一个 `i˧˥ kɤ˥˩`, 一天
`i˥˩ tʰjɛn˥`, 不是 `pu˧˥ ʂɻ̩˥˩`, 第一 `ti˥˩ i˥`.

Add to the same file, `describe('sandhi across spaces')`. Compare the `ipa`
of two inputs, so the tests do not depend on the tone letters:

- `joins Hanzi words`: `我 很 好` equals `我很好`; `你 好 吗` equals
  `你好吗`; `不 对` equals `不对`; `一 个` equals `一个`.
- `joins typed pinyin`: `wǒ hěn hǎo` and `wo3 hen3 hao3` equal
  `wo3hen3hao3`; `nǐ hǎo` equals `ni3hao3`.
- `keeps typed tones of bu and yi`: `bu4 dui4` gives the same `ipa` as
  before the change (`pu˥˩ tweɪ˥˩`).
- `stops at a break`: `我很好，你好` gives the same `ipa` as before the
  change.
- `stops at another language`: in `很 好 OK 你 好` the two words before `OK`
  have the `ipa` of `很好`, the two after it the `ipa` of `你好`.
- `keeps the word items`: `我 很 好` has three `words` with unchanged `text`,
  `sourceStart` and `sourceEnd`.

## Acceptance criteria

- [ ] `node experiments/issue-11-audit-m3a.mjs` prints for 妈妈 and 爸爸 a
      second duration below the first, and second-syllable `f0` values that
      differ between the two words by at least 15 Hz.
- [ ] The sandhi lines of section 7 match the IPA strings listed in Tests.
- [ ] Section 4 of `node experiments/issue-11-audit-m3c.mjs` prints the
      same IPA for `我 很 好` as for `我很好`, and for `wǒ hěn hǎo` as for
      `wo3hen3hao3`; the refreshed `experiments/issue-11-audit-m3c.txt` is
      committed.
- [ ] The tests of {{P30}} and `uses Mandarin tone contours` pass unchanged.
      If one fails, change `TONE_RATES`, not the test.
- [ ] `planUtterance('pʰaː˧ maː˥˩ kʰaː˩˩˦', {language: 'th'})` (any tone
      letters, no Mandarin table) gives an `f0` channel without a step
      larger than 0.6 st between frames.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added; the
      refreshed `experiments/issue-11-audit-m3a.txt` is committed.

## Out of scope

- Sentence tunes, focus and question raises on top of tones: {{P39}}.
- Creaky or breathy tones (Vietnamese, the low Mandarin dip): {{P42}}.
- Which words have a neutral syllable or another reading: {{P35}}.
- Reading tones from audio: {{P58}}. Text-to-IPA for new tone languages.

## References

- Xu, Y. (1997). Contextual tonal variations in Mandarin. Journal of
  Phonetics 25, 61-83.
- Xu, Y., Wang, Q. E. (2001). Pitch targets and their realization: evidence
  from Mandarin Chinese. Speech Communication 33, 319-337.
- Prom-on, S., Xu, Y., Thipakorn, B. (2009). Modeling tone and intonation in
  Mandarin and English as a process of target approximation. Journal of the
  Acoustical Society of America 125, 405-424. Source of the equations and
  of the range of `λ`; its slopes and heights per tone are **not** copied.
- Chao, Y. R. (1930). A system of tone letters. Le Maître Phonétique 45,
  24-27. Neutral levels 2, 3, 4, 1 after tones 1 to 4: textbook values.
- Research notes:
  `docs/case-studies/issue-11/research/4-linguistics-and-speech-modes.md`.
