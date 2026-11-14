---
id: P30
title: Mandarin third tone is spoken as a plain rise because the dip is dropped
type: Bug
milestone: M3
blocked_by: []
requirements: [R17, R19]
---

## Goal

A Mandarin syllable with the third tone (`˨˩˦`, pinyin `mǎ`) must fall to the
bottom of the voice and then rise. Today it only rises, so `mǎ` sounds like a
low version of `má`.

## Why

Tones carry the meaning of words in Mandarin. The vision asks for every common
mode of speech, tones included, in both directions; a tone that cannot be told
from another tone breaks speaking now and will break tone recognition later
({{P58}}).

## Current state

Reproduce with `node experiments/issue-11-audit.mjs`. The five numbers are the
planned pitch (Hz) at 0, 25, 50, 75 and 100 % of the voiced part of the
syllable:

```
zh má: {"ipa":"ma˧˥","f0":[120,123,145,155,156]}
zh mǎ: {"ipa":"ma˨˩˦","f0":[105,108,128,136,137]}   <- never goes below its start
zh mà: {"ipa":"ma˥˩","f0":[156,151,111,93,92]}
```

Root cause: `syllablePitch()` in `src/articulation/prosody.js` returns only two
targets and reads only the first and the last tone level:

```js
const tone = segment.token.tone;
if (tone) {
  const scale = (1.2 + 0.35 * head.pitchRange) * register.range;
  return [
    semitones(base, (tone[0] - 3) * scale),
    semitones(base, (tone.at(-1) - 3) * scale),
  ];
}
```

`segment.token.tone` is an array of Chao levels from 1 (lowest) to 5 (highest),
for example `[2, 1, 4]` for `˨˩˦` (see `addTone()` in `src/ipa/parse.js`). The
middle level `1` is never used. `fillPitch()` in `src/articulation/plan.js`
then draws a straight line between the two targets.

Any tone with three or more levels in any language is affected, for example
Cantonese or Vietnamese contours written in IPA.

## What to do

1. In `src/articulation/prosody.js` add an exported function
   `tonePitch(tone, base, scale)` that returns one pitch in Hz per tone level:
   `tone.map((level) => semitones(base, (level - 3) * scale))`.
2. Change `syllablePitch()` so that for a tonal syllable it returns the whole
   list from `tonePitch()` (two or more values). For non-tonal syllables keep
   returning exactly two values, unchanged.
3. Change `pitchTargets()` in the same file to return
   `{segment, from, to, points}` where `points` is the full list and `from` and
   `to` stay the first and the last value (other code reads them).
4. Change `fillPitch()` in `src/articulation/plan.js` to draw a piecewise
   linear curve through `points`:
   - with `n` points, point `i` sits at fraction `position(i)` of the nucleus;
   - for `n = 2` the positions are `0` and `1` (same as today);
   - for `n = 3` the positions are `0`, `0.4` and `1`: the lowest point of the
     third tone is reached before the middle of the vowel (Xu 1997, figure 3);
   - for `n > 3` the positions are evenly spaced.
     Put the positions in an exported constant
     `TONE_POINT_POSITIONS = {3: [0, 0.4, 1]}` in `prosody.js`.
5. A single-level tone (`˥`, `[5]`) must still give a level pitch: when the
   tone has one level, return that level twice.
6. Update the header comment of `prosody.js` (the paragraph that starts with
   "Tonal languages keep their lexical tones") to say that every level of the
   tone is a pitch target.
7. Extend `experiments/issue-11-audit.mjs` only if its output format changes;
   re-run it and commit the new `experiments/issue-11-audit.txt`.

Do not change the scale `(1.2 + 0.35 * head.pitchRange) * register.range`, the
tone sandhi in `src/g2p/pinyin.js` or the half-third tone `˨˩` that sandhi
produces before another syllable. Those are correct.

## Tests

Add to `tests/articulation.test.js`, next to `uses Mandarin tone contours`:

- `dips in the middle of the Mandarin third tone`: plan `ma˨˩˦` with
  `normalizeHeadConfig({ vibrato: 0 })` and `language: 'zh'`. Sample `f0` with
  `sampleState()` at 10 %, 45 % and 95 % of the vowel. Expect
  `f0(45 %) < f0(10 %) * 0.97` and `f0(95 %) > f0(45 %) * 1.15`.
- `keeps the second tone rising all the way`: plan `ma˧˥`; `f0` at 25 %, 50 %,
  75 % and 95 % must be non-decreasing.
- `keeps a level first tone`: plan `ma˥`; the ratio of the largest to the
  smallest `f0` inside the vowel is below `1.03`.

Add to `tests/prosody.test.js`:

- `returns one pitch target per tone level`: `pitchTargets()` for the segments
  of `ma˨˩˦` returns an entry whose `points` has length 3 and whose middle
  value is the smallest.

All existing tests must pass without changes.

## Acceptance criteria

- [ ] `node experiments/issue-11-audit.mjs` prints an `f0` list for `zh mǎ`
      whose second or third value is at least 5 Hz below the first and whose
      last value is at least 15 Hz above the minimum.
- [ ] The output for `mā`, `má`, `mà` and `ma` changes by less than 2 Hz at
      every quartile.
- [ ] The new tests exist and pass on Node.js, Bun and Deno.
- [ ] `npm run check` and `npm test` pass; a patch changeset is added.

## Out of scope

- A dynamic tone model with targets and slopes, the neutral tone and tone
  coarticulation: {{P37}}.
- Question intonation on top of tones: {{P39}}.

## References

- Xu, Y. (1997). Contextual tonal variations in Mandarin. Journal of
  Phonetics 25, 61-83.
- Chao, Y. R. (1930). A system of tone letters. Le Maître Phonétique 45,
  24-27.
- Research notes:
  `docs/case-studies/issue-11/research/4-linguistics-and-speech-modes.md`.
