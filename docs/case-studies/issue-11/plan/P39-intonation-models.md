---
id: P39
title: 'Intonation models per language: sentence types, focus and Russian contours'
type: Feature
milestone: M3
blocked_by: [P38]
requirements: [R17, R7, R19]
---

## Goal

Replace "one pitch movement on the last vowel" by a small intonation model
per language: a tune for every sentence type, a nucleus (the main accented
word) that focus can move, and phrase breaks. English gets ToBI-like tunes,
Russian the constructions IK-1 to IK-7, Hindi rising accent phrases, Mandarin
a pitch range that changes over its tones.

## Why

Intonation tells a statement from a question and old from new information. In
Russian a yes/no question differs from a statement only by intonation. The
same tunes, written with the same IPA marks, are what {{P58}} must recognise.

## Current state

`syllablePitch()` in `src/articulation/prosody.js` raises every stressed
syllable by `0.6 * range` st and puts one movement from `CONTOURS` on the
last vowel of the phrase; tonal syllables ignore it. `markQuestions()` in
`src/g2p/index.js` writes `↘ ?` when one of the first two words is a wh-word.
Planned pitch in Hz, start and end of each vowel (from
`experiments/issue-11-audit.txt` and `issue-11-audit-m3b.txt`):

```
en Tea or coffee?   [141,136] [137,132] [132,125] [116,144]  <- should fall
ru Это мама?        [141,132] [117,118] [130,124] [119,143]  <- wrong vowel
hi क्या तुम आओगे?    first 120, last 92                       <- falls
zh 你来。 = 你来？    first 102, last 140  <- "?" changes nothing
en You are coming, aren't you?  first 141, last 141
```

The Russian rise sits on the last vowel, not on stressed `ма`. The Hindi fall
is the bug {{P33}}. There is no nucleus, no focus, no post-focus compression
and no phrase break without punctuation.

## What to do

1. Create `src/articulation/intonation.js`. Model (all values in semitones
   relative to `head.pitch`; chosen because {{P37}} uses the same pitch
   targets, and targets are easier to invert than Fujisaki commands):

   `st(syllable) = register + declination(t) + raise(t) + range * (tune + tone)`

   `register` is `REGISTERS[...].shift + mode.pitch`; `declination` is
   today's; `range` is
   `head.pitchRange / 3 * REGISTERS[...].range * mode.range`; `tune` comes
   from the tables below (written for the default range of 3 st); `tone` is
   the lexical tone; `raise` is used by Mandarin only. Each syllable gets a
   target `{ from, to }`. If {{P37}} is merged, pass the targets to its
   filter; if not, write them into `pitchTargets()` as today.

2. Split every intonation phrase into pre-nucleus, nucleus and tail. The
   nucleus is the stressed syllable of the last word with primary stress,
   or of the word with `ˈˈ` / `mode.emphasis >= 0.5` if there is one. The
   tail is everything after it. `B` is the pitch at the end of the phrase.

3. English tunes, export `TUNES.en`:

   | Tune           | ToBI                 | Pre-nucleus accents | Nucleus from → to | Tail and B                    |
   | -------------- | -------------------- | ------------------- | ----------------- | ----------------------------- |
   | `statement`    | H\* L-L%             | +1.8                | +2 → +1           | falls to B -3.5               |
   | `wh`           | H\* L-L%             | first word +3       | +2 → +1           | falls to B -3.5               |
   | `yesno`        | L\* H-H%             | +1.8                | -1.5 → -1         | rises to B +7                 |
   | `echo`         | L+H\* … L\* H-H%     | +2.5                | -1.5 → 0          | rises to B +10                |
   | `continuation` | H\* L-H%             | +1.8                | +2 → +1           | dips to -1, B +3.5            |
   | `alt-rise`     | L\* H-               | +1.8                | -1 → +3           | B +5                          |
   | `tag-ask`      | L\* H-H%             | none                | -1.5 → -1         | rises to B +6                 |
   | `tag-confirm`  | H\* L-L%             | none                | +2 → 0            | B -3.5                        |
   | `exclamation`  | L+H\* L-L%           | +1.8                | -1 → +4           | falls to B -4.5               |
   | `command`      | H\* L-L%, high onset | first word +3       | +3 → 0            | at B -5 after one syllable    |
   | `parenthesis`  | compressed           | +0.9                | +1 → 0            | B -1.5; rate 1.1              |
   | `call`         | H\* !H-L% (vocative) | none                | +4 → +4           | level at +1 (3 st step), held |

   The rise sizes +6 to +10 st and the parenthesis values are proposals of
   the research notes; the calling contour is a textbook value. `exclamation`
   and `parenthesis` keep `REGISTERS` (shift +1.5 / -2 st, gain 1.41 / 0.71).
   A tag gets `tag-ask` after `↗ ?` and `tag-confirm` after `↘ ?`.

4. Russian tunes, export `TUNES.ru` (sizes are starting values: the textbook
   descriptions give shapes, not numbers). "Centre" is the nucleus:

   | Tune         | Before centre | Centre (stressed vowel)                        | After centre             | Default use                          |
   | ------------ | ------------- | ---------------------------------------------- | ------------------------ | ------------------------------------ |
   | `IK1`        | 0             | falls 0 → -5                                   | -5                       | statement (`.`)                      |
   | `IK2`        | 0             | +1 → -2, loudness +3 dB                        | -4                       | wh-question, address, demand         |
   | `IK3`        | 0             | rises -1 → +8 within 150 ms                    | -2 (below start)         | yes/no question; `,` with rise × 0.7 |
   | `IK4`        | 0             | dips to -3, then rises to +3                   | +3 … +4, high            | `А вы?`, lists                       |
   | `IK5`        | 0             | two centres: rise 0 → +6, plateau, fall to -2  | -2                       | `Какой сегодня день!`                |
   | `IK6`, `IK7` | 0             | rises 0 → +6; `IK7` ends in a glottal stop `ʔ` | `IK6` stays +6; `IK7` -2 | label only                           |

   Choice of tune: `.` → `IK1`; `?` with a word of `WH_WORDS.ru` → `IK2`,
   centre on that word; other `?` → `IK3`; `?` after a first word `а` and at
   most three words → `IK4`; `!` → `IK2`, or `IK5` when the first word is one
   of `какой какая какое какие как сколько` (first centre on it, second on
   the last stressed word). The yes/no question has no other cue than `IK3`.

5. Hindi, export `TUNES.hi`: every word before the last one that has two or
   more syllables is an accent phrase: first vowel -1, last vowel +3 (rise of
   3 to 5 st, proposal), each next phrase 1 st lower. Last word: statement
   falls to B -3.5; a rising question adds B +6 on the last syllable.
   Whether a Hindi question rises or falls is decided by `questionFalls()`
   of {{P33}}: do not change that here. Focus only compresses what follows
   (range × 0.5). These Hindi tunes are unverified: say so in a comment.

6. Mandarin, export `TUNES.zh`: tones are never replaced. `?` without a
   particle: `raise(t)` grows linearly from 0 at the phrase start to +3 st at
   its end, declination is halved, the tone range of the last syllable is
   × 1.3. `?` after `吗` (`ma`, neutral tone): `raise` ends at +1 st. Add the
   wh-words `谁 什么 哪 哪里 怎么 为什么 几 多少` to `WH_WORDS.zh`: such questions
   get no raise. `!`: tone range × 1.3 (already in `REGISTERS`).

7. Focus (`*word*`, `<emphasis>`, `ˈˈ`), export `FOCUS`:

   | Language | On the focused word                    | After it, to the phrase end   |
   | -------- | -------------------------------------- | ----------------------------- |
   | en       | nucleus +2.9 st, duration × 1.2, +3 dB | accents × 0.3, level -2 st    |
   | ru       | becomes the centre of the tune         | as the tune says              |
   | hi       | no change                              | range × 0.5                   |
   | zh       | tone range × 1.4 (H +2.3, L -2.4 st)   | tone range × 0.5, level -4 st |

   `mode.emphasis` scales these values (1 = full, 0.5 = half; -0.5 removes
   the accent of the word).

8. Sentence types from text, in a new file `src/g2p/phrasing.js` called from
   `textToIpa()`; the type is written in IPA so the planner needs no text:

   | Type                   | Cue in the text                                     | IPA written                |
   | ---------------------- | --------------------------------------------------- | -------------------------- |
   | statement, list, aside | `.`, `!`, `,`, `( )`                                | the same marks (as today)  |
   | yes/no question        | `?`                                                 | `?`                        |
   | wh-question            | `?` and a wh-word (rule below)                      | `↘ ?` (as today)           |
   | echo question          | English `?`, first word not an auxiliary or wh-word | `↗ ?`                      |
   | alternative question   | `?` and `or`, `или`, `या`, `还是` between two words | `↗ \|` before it, `↘ ?`    |
   | tag question           | English `, <auxiliary>[n't] <pronoun>?`             | `,` then `↗ ?`             |
   | command, call, IK4-7   | not guessed from text                               | `{command … command}` etc. |

   Wh-word rule: Hindi as {{P33}} decides; Mandarin anywhere; Russian
   anywhere before the first comma (`А ты куда идёшь?`); English among the
   first four words when no auxiliary stands before it. The last row adds
   the tune names to `MODE_LABELS` of {{P38}}, the element
   `<vs:tune name="…">` and the inline tag `[tune name]`; they set
   `mode.tune`, which wins over the punctuation. English auxiliaries:
   `am is are was were do does did have has had can could will would`
   `shall should may might must`.

9. Phrase breaks without punctuation, same file: when a stretch between two
   punctuation marks has more than 14 syllables, write `|` before the
   conjunction nearest to its middle if both sides keep at least 4
   syllables. Conjunctions: `and but or because that which who when if`;
   `и а но что чтобы который когда если`; `और लेकिन कि या क्योंकि जब तो`;
   `和 但是 因为 所以 可是 如果`. The phrase before `|` gets `continuation`
   (Russian: `IK3` × 0.7). Update the header comment of `prosody.js` and
   `docs/markup.md`.

## Tests

Create `tests/intonation.test.js`. Use planned pitch (`plan.channels.f0`,
`vibrato: 0`, 10 ms inside each vowel), converted to semitones. Update
`tests/prosody.test.js` only where a threshold moved; keep its cases.

- `falls in English statements`: `You are coming.` ends ≥ 5 st below its
  first vowel. `rises in yes/no questions`: `Are you coming?` ends ≥ 5 st
  above the start of its nucleus vowel. `falls in wh-questions`:
  `Where are you going?` ends ≥ 5 st below its first vowel.
- `rises then falls in alternative questions`: in `Tea or coffee?` the vowel
  of `tea` ends ≥ 3 st above its start; the last vowel ends ≥ 4 st below the
  end of `tea`.
- `rises in asking tags`: `You are coming, aren't you?` ends ≥ 4 st above
  the end of the vowel before the comma.
- `raises list items and lowers the last one`: in `Apples, pears and plums.`
  the words before the commas end ≥ 2 st above their stressed vowel; the
  sentence ends ≥ 4 st below its first vowel.
- `puts the Russian question rise on the stressed vowel`: in `Это мама?` the
  first vowel of `мама` rises ≥ 6 st and the last vowel ends below the first
  vowel of `это`; in `Это мама.` no vowel rises more than 1 st.
- `moves the Russian centre with emphasis`: `*Ты* придёшь?` with
  `markup: true` rises ≥ 6 st on `ты` and stays below it afterwards.
- `keeps Russian wh-questions falling`: `Кто пришёл?` ends ≥ 4 st below its
  start; the IPA of `А ты куда идёшь?` ends in `↘ ?`.
- `builds Hindi accent phrases`: in `लड़का घर जाएगा।` the last vowel of
  `लड़का` is ≥ 2 st above its first; `तुम आओगे?` ends ≥ 4 st above the end
  of `तुम आओगे।`; `तुम कहाँ जा रहे हो?` ends below its start.
- `raises Mandarin questions without breaking tones`: the mean of the last
  vowel of `你来？` is ≥ 2 st above `你来。`; in `他去？` the last vowel still
  falls ≥ 3 st; `你来吗？` raises `来` by less than 1.5 st.
- `boosts focus and compresses what follows`: in `*Anna* came with Manny.`
  the first vowel peak is ≥ 2.5 st above the plain sentence and the stressed
  vowel of `Manny` is ≥ 1.5 st lower than in the plain sentence.
- `breaks long phrases`: a 24-syllable sentence without commas has a `|`.

## Acceptance criteria

- [ ] `node experiments/issue-11-audit.mjs` prints `last` below 110 for
      `Tea or coffee?` (today 143) and below 100 for `You are coming.`;
      `issue-11-audit-m3b.mjs` prints a higher `mean` for `你来？` than for
      `你来。` (today both 116).
- [ ] The IPA of `Tea or coffee?` is `ˈti ↗ | ˈɔɹ ˈkɑfi ↘ ?`.
- [ ] `tests/intonation.test.js` passes on Node.js, Bun and Deno;
      `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- Tone targets, neutral tone, tone coarticulation: {{P37}}.
- The rise or fall of Hindi questions with `क्या`: {{P33}}.
- Loudness beyond +3 dB: {{P40}}. Emotions: {{P43}}. Recognition: {{P58}}.
- Syntactic parsing, Mandarin A-not-A questions, guessing vocatives.

## References

- Prom-on, S., Xu, Y., Thipakorn, B. (2009). Modeling tone and intonation in
  Mandarin and English as a process of target approximation. JASA 125(1).
- Брызгунова, Е. А. (1977). Звуки и интонация русской речи. Москва: Русский
  язык. (IK-1 to IK-7.)
- ToBI (tune inventory): https://en.wikipedia.org/wiki/ToBI
- Xu, R. B., Mok, P. P. K. (2014). Cross-linguistic perception of Mandarin
  intonation. Speech Prosody 2014.
- Research notes:
  `docs/case-studies/issue-11/research/4-linguistics-and-speech-modes.md`.
