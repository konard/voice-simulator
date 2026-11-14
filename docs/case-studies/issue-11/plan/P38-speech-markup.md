---
id: P38
title: 'Speech markup: an SSML subset, inline tags and voice-quality symbols in IPA'
type: Feature
milestone: M3
blocked_by: []
requirements: [R17, R7, R10, R5]
---

## Goal

Give the project one way to say _how_ a text is spoken (loud, fast, whispered,
angry, with a laugh). It has three written forms that mean the same thing: an
SSML subset, light inline tags for plain text, and ExtIPA/VoQS marks inside
IPA. All three end in one data structure, the mode track `plan.modes`. This
issue builds the parsers, the data structure and the plumbing. The issues
{{P39}} to {{P44}} make each mode sound right.

## Why

The vision says "always through IPA" and "one model, two directions". A mode
that cannot be written in IPA cannot be returned by recognition ({{P58}},
{{P59}}, {{P60}}). A mode without a shared data structure would be built seven
times in seven ways.

## Current state

Reproduce with `node experiments/issue-11-audit-m3b.mjs`:

```
markup <speak>Hello <emphasis>world</emphasis>.</speak>:
  "ˈspik həˈloʊ ˈɛmfəsəs ˈwɝld ˈɛmfəsəs . ˈspik"      <- tags are read aloud
markup [whisper]Hello[/whisper] world.: "( ˈwɪspɚ ) həˈloʊ ( ˈwɪspɚ ) ˈwɝld ."
ipa {W ma W}: {"segments":2,"unknown":["{","W","W","}"]}
ipa a̤: {"segments":1,"unknown":["̤"]}       (same for a̰ and ạ)
ipa ⸨cough⸩ ma: {"segments":7,"unknown":["⸨","⸩"]}  <- "cough" becomes phones
ipa ma (.) ma: {"segments":4,"unknown":[]}   <- read as "(" + "." + ")"
```

There is no `src/markup/`. `planUtterance()` in `src/articulation/plan.js`
returns `{ tokens, segments, head, frameRate, frameCount, duration, channels }`
and no `modes`. `parseIpa()` in `src/ipa/parse.js` returns
`{ tokens, unknown }`. Every token already has `token.word`, the index of its
IPA word; this issue uses that index to place spans.

## What to do

1. Create `src/markup/modes.js` with the mode object. `MODE_DEFAULTS` is:

   ```js
   {
     effort: 0.5, // 0 very soft, 0.25 soft, 0.5 normal, 0.75 loud, 1 shout
     effortEnd: 0.5, // effort at the end of the span (ramps, see P40)
     gain: 0, // plain level change in dB, no change of voice quality
     rate: 1, // speed factor: 2 means half the durations
     pitch: 0, // shift in semitones
     range: 1, // factor on pitch movements
     emphasis: 0, // -0.5 reduced, 0 none, 0.5 moderate, 1 strong
     phonation: { breathy: 0, creaky: 0, tension: 0, falsetto: 0,
                  harsh: 0, whisper: 0 }, // 0..1; tension -1 lax .. 1 pressed
     emotion: { name: 'neutral', intensity: 0,
                arousal: 0, valence: 0, dominance: 0 }, // -1..1
     tune: null, // optional intonation label, owned by P39
     lang: null, // language tag of the span or null
   }
   ```

   Effort in decibels is `(effort - 0.5) * 40`, so the range is -20 to +20 dB.
   Export `composeMode(outer, change)`: `rate` and `range` multiply, `pitch`
   and `gain` add, everything else is replaced by the inner value. A `change`
   may mark a value as absolute (labels such as `rate="fast"`, `pitch="200Hz"`);
   absolute values replace. Clamp after composing: `rate` 0.25 to 4, `pitch`
   -24 to 24, `range` 0 to 4, `gain` -120 to 12, `effort` 0 to 1.

2. Create `src/markup/ssml.js` with `parseSsml(text)`: a small reader written
   by hand (no dependency) for elements, attributes, text, comments, the five
   entities `&lt; &gt; &amp; &quot; &apos;` and numeric references. Supported:

   | Element                  | Attributes and meaning                                                                                                                                                                 |
   | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `speak`                  | root; `xml:lang` sets `lang`                                                                                                                                                           |
   | `p`, `s`                 | end with a sentence break if the text has no final punctuation                                                                                                                         |
   | `break`                  | `time="300ms"` or `"1.5s"`; `strength`: `none` 0 s, `x-weak` 0.05 s, `weak` 0.2 s, `medium` 0.4 s, `strong` 0.8 s, `x-strong` 1.2 s                                                    |
   | `prosody`                | `rate`: `x-slow` 0.5, `slow` 0.75, `medium` 1, `fast` 1.3, `x-fast` 1.6, or `N%` (factor N/100)                                                                                        |
   |                          | `pitch`: `x-low` -6, `low` -3, `medium` 0, `high` +3, `x-high` +6 st, `+Nst`, `-Nst`, `+N%`, `NHz` (absolute, against `head.pitch`)                                                    |
   |                          | `range`: `x-low` 0.25, `low` 0.5, `medium` 1, `high` 1.5, `x-high` 2, `+N%`, `-N%`                                                                                                     |
   |                          | `volume`: `x-soft` -12, `soft` -6, `medium` 0, `loud` +6, `x-loud` +12 dB, `+NdB`, `-NdB`: effort changes by dB/40; `silent`: `gain` -120                                              |
   | `emphasis`               | `level`: `strong` 1 (default), `moderate` 0.5, `none` 0, `reduced` -0.5                                                                                                                |
   | `say-as`                 | `interpret-as`: `characters`, `cardinal`, `ordinal`, `digits`; other values read the content as plain text and add a warning                                                           |
   | `phoneme`                | `alphabet="ipa"` and `ph`: the words inside get this IPA                                                                                                                               |
   | `lang`                   | `xml:lang`: language of the content                                                                                                                                                    |
   | `sub`                    | `alias`: text spoken instead of the content                                                                                                                                            |
   | `vs:effort`              | `level`: `whisper` (also sets whisper 1), `soft`, `normal`, `loud`, `shout`, or `value="0.75"`; `to="1"` sets `effortEnd`                                                              |
   | `vs:phonation`           | `name`: `modal`, `breathy`, `creaky`, `pressed`, `lax`, `falsetto`, `harsh`, `whisper`, `whispery`; `degree` 0..1 (default 0.67)                                                       |
   | `vs:emotion`             | `name` (`neutral happy sad angry afraid surprised disgusted tender bored sarcastic confident hesitant`), `intensity` 0..1 (default 0.67), or `arousal`, `valence`, `dominance` (-1..1) |
   | `vs:sound` (no content)  | `name`: `laugh`, `inhale`, `exhale`, `sigh`, `cough`, `throat`, `filler`, `click`; optional `duration="0.5s"`                                                                          |
   | `vs:gain` (on `prosody`) | attribute `vs:gain="-6dB"`: plain gain                                                                                                                                                 |

   The prefix `vs:` is the project namespace `urn:voice-simulator:markup:1`.
   The `xmlns:vs` declaration is accepted and not required. Unknown elements
   are skipped with a warning and their text is kept. Malformed input throws
   `MarkupError` with a `position` (offset in the input).

3. Create `src/markup/inline.js` with `parseInline(text)`. Span tags are
   `[name]…[/name]`, sound tags are `[name]` alone, values follow a space:
   `[whisper] [soft] [loud] [shout] [effort 0.75] [fast] [slow] [rate 1.3]`
   `[high] [low] [pitch +2] [breathy] [creaky] [pressed] [lax] [falsetto]`
   `[harsh]`, every emotion name (`[angry]`, `[angry 0.8]`), `[lang ru]`,
   `[ipa həˈloʊ]` (a spoken word given in IPA), `[pause 0.3]` and the sounds
   `[laugh] [inhale] [exhale] [sigh] [cough] [throat] [filler] [click]`.
   `*word*` is `emphasis` 1: the opening star stands before a non-space and
   after a space or the start, the closing star stands after a non-space.
   `\[`, `\]`, `\*` and `\\` are literal characters. An unknown tag stays in
   the text and adds a warning. A tag that is never closed runs to the end of
   the input and adds a warning. Inline parsing never throws.

4. Create `src/markup/index.js` exporting `parseMarkup(text, options)`,
   `MarkupError` and `MARKUP_LIMITS`. Detection: when `options.markup` is
   `false` the text is plain. When the trimmed text starts with `<speak` it is
   SSML. Otherwise inline tags are read only when `options.markup === true`.
   Plain text stays plain: `a < b`, `[1]` and `2 * 3` are never markup by
   default. The result is:

   ```js
   {
     text: 'Hello world.', // what the text front end reads
     offsets: [7, 8, …], // offsets[i] = position of text[i] in the input
     spans: [{ start: 0, end: 5, mode }], // characters of `text`, composed,
                                          // not overlapping, sorted
     breaks: [{ at: 5, seconds: 0.3 }],
     sounds: [{ at: 6, name: 'laugh', duration: null }],
     overrides: [{ start: 6, end: 11, ipa: 'ˈwɝld' }], // phoneme, [ipa …]
     warnings: [{ position: 12, message: 'unknown tag [foo]' }],
   }
   ```

5. IPA side, in `src/ipa/parse.js` and `src/ipa/inventory.js`. A brace marker
   is a chunk between spaces that starts with `{` or ends with `}`; it is not
   a word and nothing inside it is read as a phone. Add `MODE_LABELS`:

   | IPA span                                  | Change (degree digit 1, none or 2, 3 before the label, e.g. `{3V̤`) |
   | ----------------------------------------- | ------------------------------------------------------------------ |
   | `{pp … pp}`, `{p … p}`                    | effort 0, 0.25 (also `𝆏𝆏`, `𝆏`)                                    |
   | `{f … f}`, `{ff … ff}`                    | effort 0.75, 1 (also `𝆑`, `𝆑𝆑`)                                    |
   | `{crescendo …}`, `{diminuendo …}`         | `effortEnd` = effort + 0.25, effort - 0.25                         |
   | `{allegro … allegro}`, `{lento … lento}`  | rate 1.3, rate 0.75                                                |
   | `{V̤ … V̤}` breathy, `{V̰ … V̰}` creaky voice | breathy or creaky 0.33, 0.67, 1                                    |
   | `{C … C}` creak                           | creaky 1                                                           |
   | `{V͈ … V͈}` pressed, `{V͉ … V͉}` lax          | tension +0.33, +0.67, +1 or the same negative                      |
   | `{F … F}` falsetto, `{V! … V!}` harsh     | falsetto or harsh 0.33, 0.67, 1                                    |
   | `{W … W}` whisper                         | whisper 1; degree sets effort 0.25, unchanged, 0.75                |
   | `{Ṿ … Ṿ}` whispery voice                  | whisper 0.25, 0.5, 0.75                                            |
   | `{V … V}` modal                           | all phonation values 0                                             |

   Also parse: the pauses `(.)` 0.2 s, `(..)` 0.4 s, `(...)` 0.8 s and `(1.2)`
   (seconds) as one pause token `{ kind: 'pause', strength: 1, seconds }` that
   does not end the sentence; `⸨name⸩` as one token
   `{ kind: 'sound', name }`; `ˈˈ` as `stress: 1, emphasis: 1`; the diacritics
   U+0324 (`token.breathy`), U+0330 (`token.creaky`) and U+0323
   (`token.whispered`) on single phones. `parseIpa()` returns
   `{ tokens, unknown, modes }` with `modes: [{ from, to, mode }]` in IPA word
   indexes (`to` exclusive). A word with `ˈˈ` counts as a one-word span with
   `emphasis: 1`. Unknown labels go to `unknown` and change nothing.
   `pitch`, `range`, `gain`, `emotion` and `lang` have no ExtIPA symbol; they
   are never written in IPA and travel only in the `modes` list.

6. `textToIpa(text, { markup })` in `src/g2p/index.js` calls `parseMarkup`,
   transcribes `text`, applies `overrides`, inserts `breaks` and `sounds`,
   and returns the usual result plus `modes` (word-index spans) and
   `warnings`. Its `ipa` contains the marks of step 5 for every change that
   has a symbol; `formatIpa(tokens, modes)` writes them. Every word gets
   `sourceStart = offsets[sourceStart]` and
   `sourceEnd = offsets[sourceEnd - 1] + 1`, so the timeline still points
   into the original input; the words of a `sub` or `say-as` share the range
   of the whole element.

7. `planUtterance(ipa, { modes })`: use `options.modes` when given, else the
   spans found in the IPA. Set `token.mode` on every token. Return
   `plan.modes`: spans in seconds, sorted, not overlapping, covering 0 to
   `plan.duration`, each `{ start, end, ...mode }` with every field of
   `MODE_DEFAULTS`; and `plan.sounds: [{ name, start, end }]`. A pause belongs
   to the span before it. Export `modeAt(plan, time)`.

8. Realise only what the engine can do today: `rate` (divide the durations of
   the tokens in `buildSegments()`), `pitch` and `range` (in
   `syllablePitch()`), `gain` and effort (multiply `channels.loudness` by
   `10^(dB/20)` with effort limited to -20…+6 dB until {{P40}}), timed
   pauses, and a sound as 0.3 s of silence until {{P44}}. `phonation`,
   `emotion`, `emphasis` and `tune` are carried and not yet heard.

9. Interfaces: `synthesize(text, { markup })` and `prepareUtterance` pass the
   option on and return `modes` and `warnings`; CLI flags `--markup` (inline
   tags on) and `--plain` (no markup) in `bin/voice-simulator.js`; field
   `markup` in `synthesisOptions()` of `src/server/server.js`; types in
   `src/index.d.ts`; export `parseMarkup` from `src/index.js`.

10. Safety. Throw `MarkupError` for `<!DOCTYPE`, `<!ENTITY`, `<![CDATA[`,
    processing instructions and any named entity other than the five above.
    `MARKUP_LIMITS` is `maxLength: 20000` (characters), `maxDepth: 32`,
    `maxElements: 2000`, `maxPauseSeconds: 10`; going over a limit throws
    `MarkupError`. The server applies `MAX_TEXT` to the plain `text` and
    `4 * MAX_TEXT` to the raw input and answers 400 on `MarkupError`.

11. Write `docs/markup.md` with the three tables above and one example per
    row, and link it from `README.md`.

## Tests

Create `tests/markup.test.js`:

- `leaves plain text alone`: `parseMarkup('a < b [1] 2 * 3')` returns the same
  text and no spans.
- `reads the SSML subset`: one case per row of the table in step 2; for
  `<speak><prosody rate="fast" pitch="+2st">a b</prosody> c</speak>` expect
  one span with `rate` 1.3 and `pitch` 2 over `a b`.
- `composes nested spans`: `rate="200%"` inside `rate="50%"` gives 1;
  `+2st` inside `+3st` gives 5; `[loud]` inside `[soft]` gives effort 0.75.
- `reads inline tags only when asked`, `keeps escaped brackets`,
  `warns about unknown and unclosed tags`.
- `rejects entities and doctypes`: a DOCTYPE with an entity, `&foo;`, depth
  33 and 20 001 characters each throw `MarkupError`.
- `maps offsets back to the input`: for
  `<speak>Hello <emphasis>world</emphasis>.</speak>` the timeline word `world`
  has `sourceStart` 23 and `sourceEnd` 28.
- `writes and reads the same IPA marks`: for each row of the table in step 5,
  `parseIpa(formatIpa(tokens, modes)).modes` equals `modes`; `unknown` is
  empty for `{W ma W}`, `a̤`, `a̰`, `ạ`, `⸨cough⸩ ma`, `ma (.) ma`.
- `text and IPA give the same plan`: `[whisper]Hello[/whisper] world.` with
  `markup: true` and its own `ipa` output give equal `plan.modes`.
- `fills plan.modes`: spans are sorted, do not overlap and cover the plan.
- `changes rate, pitch and level`: `[fast]` shortens the span to 0.77 ± 0.05
  of its plain duration; `[pitch +12]` doubles `channels.f0` within 3 %;
  `[soft]` lowers peak `channels.loudness` to 0.32 ± 0.02 of plain.

Add to `tests/server.test.js`: `markup` is passed on; a DOCTYPE gives 400.
Add to `tests/cli-audio.test.js`: `--markup` is an option.

## Acceptance criteria

- [ ] `node experiments/issue-11-audit-m3b.mjs` prints `həˈloʊ ˈˈwɝld .` for
      the `<speak>` line and an empty `unknown` list for all eight `ipa`
      lines.
- [ ] `voice-simulator ipa --markup "[whisper]Hello[/whisper] world."` prints
      `{W həˈloʊ W} ˈwɝld .`.
- [ ] Without `markup`, the IPA and the samples of every text that does not
      start with `<speak` are identical to the previous release.
- [ ] `plan.modes` covers 0 to `plan.duration` without gaps for every test
      input, and every span has all fields of `MODE_DEFAULTS`.
- [ ] A 20 000 character SSML input is parsed in less than 50 ms on Node.js.
- [ ] The new tests pass on Node.js, Bun and Deno.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- How each mode sounds: {{P39}} (intonation, emphasis), {{P40}} (effort),
  {{P41}} (whisper), {{P42}} (phonation), {{P43}} (emotion), {{P44}} (sounds).
- SSML `voice`, `audio`, `mark`, `lexicon`, `prosody contour` and `duration`.
- Returning these marks from audio: {{P58}}, {{P59}}, {{P60}}. They use the
  shape of `plan.modes` and add `confidence` to each span.
- The Rust copy of the parser: {{P70}}.

## References

- Speech Synthesis Markup Language (SSML) Version 1.1, W3C Recommendation,
  https://www.w3.org/TR/speech-synthesis11/
- Emotion Markup Language (EmotionML) 1.0, W3C Recommendation,
  https://www.w3.org/TR/emotionml/
- extIPA symbols for disordered speech (ICPLA chart) and the Voice Quality
  Symbols (VoQS) of Ball, Esling and Dickson (1995): brace notation, loudness
  and tempo terms, pauses, `⸨ ⸩`, degree digits.
- Research notes:
  `docs/case-studies/issue-11/research/4-linguistics-and-speech-modes.md`
  (sections 8.1 and 8.2).
