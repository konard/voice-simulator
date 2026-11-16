# Speech markup

Text can say how it is spoken: louder, faster, whispered, with a pause or a
laugh. Three notations are read, and all three become the same **speech
mode** spans:

1. an **SSML subset** (W3C Speech Synthesis Markup Language 1.1) with a few
   `vs:` elements, for any text that starts with `<speak`;
2. **inline tags** such as `[whisper]Hello[/whisper]`, only when asked for
   (`markup: true`, `--markup`), so `[1]`, `a < b` or `2 * 3` in ordinary
   text stay text;
3. **ExtIPA/VoQS marks** in IPA strings: brace spans such as `{W … W}`,
   timed pauses `(.)`, sounds `⸨laugh⸩` and the strong emphasis `ˈˈ`.

`textToIpa()` writes the marks of every change that has an ExtIPA/VoQS
symbol into its `ipa`, so a marked-up text and its IPA give the same plan.
The examples below are the output of
`node experiments/issue-50-doc-examples.mjs` (saved in
`experiments/issue-50-doc-examples.txt`).

## Using it

```js
import { synthesize, textToIpa, parseMarkup, modeAt } from 'voice-simulator';

textToIpa('[whisper]Hello[/whisper] world.', { markup: true }).ipa;
// '{W həˈloʊ W} ˈwɝld .'
textToIpa('<speak>Hello <emphasis>world</emphasis>.</speak>').ipa;
// 'həˈloʊ ˈˈwɝld .'

const result = synthesize('[fast]Hello[/fast] world.', { markup: true });
result.modes; // [{ from: 0, to: 1, mode: { rate: 1.3, … } }] (IPA words)
result.plan.modes; // [{ start, end, effort, rate, pitch, … }] (seconds)
modeAt(result.plan, 0.1).rate; // 1.3
result.warnings; // unknown or unclosed tags: [{ position, message }]
```

```sh
voice-simulator ipa --markup "[whisper]Hello[/whisper] world."
# {W həˈloʊ W} ˈwɝld .
voice-simulator say "<speak>Hello <break time=\"1s\"/> world.</speak>" > a.wav
voice-simulator ipa --plain "<speak>Hi</speak>"   # the tags are read as words
```

The server takes `markup` in the query or the JSON body
(`/api/ipa?text=…&markup=true`); `/api/timeline` returns `modes`, `sounds`
and `warnings`.

When to read markup:

| Input                | `markup` unset | `markup: true` | `markup: false` |
| -------------------- | -------------- | -------------- | --------------- |
| starts with `<speak` | SSML           | SSML           | plain text      |
| anything else        | plain text     | inline tags    | plain text      |

Without markup the IPA and the samples are the same as before.

## The mode

Every span has all the fields of `MODE_DEFAULTS`:

| Field                 | Default | Meaning                                                                                         | Heard today                               |
| --------------------- | ------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `effort`, `effortEnd` | 0.5     | vocal effort 0 (very soft) … 1 (shout) at the start and end of a span; `(effort - 0.5) * 40` dB | level, limited to -20 … +6 dB (until #52) |
| `gain`                | 0       | plain level change in dB                                                                        | level                                     |
| `rate`                | 1       | speed factor: 2 halves the durations                                                            | durations                                 |
| `pitch`               | 0       | shift in semitones                                                                              | pitch targets                             |
| `range`               | 1       | factor on pitch movements                                                                       | pitch targets                             |
| `emphasis`            | 0       | -0.5 reduced, 0 none, 0.5 moderate, 1 strong                                                    | focus: pitch, duration, level (#51)       |
| `phonation`           | all 0   | `breathy`, `creaky`, `tension` (-1 lax … 1 pressed), `falsetto`, `harsh`, `whisper`, each 0 … 1 | carried (#53, #54)                        |
| `emotion`             | neutral | `name`, `intensity`, `arousal`, `valence`, `dominance`                                          | carried (#55)                             |
| `tune`                | null    | intonation label (`TUNE_LABELS`)                                                                | the tune of the phrase (#51)              |
| `lang`                | null    | language tag of the span                                                                        | transcription and tunes                   |

Nested spans compose: `rate` and `range` multiply, `pitch` and `gain` add,
everything else takes the inner value; named values such as `rate="fast"`
replace. After composing, `rate` is kept in 0.25 … 4, `pitch` in -24 … 24,
`range` in 0 … 4, `gain` in -120 … 12 and `effort` in 0 … 1.

A timed pause lasts exactly its length; a sound is silence of its length
(0.3 s unless one is written) until #56.

## SSML

The reader is written by hand (no dependency). It knows elements,
attributes, text, comments, the five entities `&lt; &gt; &amp; &quot;
&apos;` and numeric references. The `vs:` prefix is the namespace
`urn:voice-simulator:markup:1`; declaring `xmlns:vs` is accepted and not
required. Unknown elements are skipped with a warning and their text is
kept.

| Element                  | Attributes and meaning                                                                                                                                                                                                                                                   | Example                                                            | IPA and mode                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `speak`                  | root; `xml:lang` sets the language                                                                                                                                                                                                                                       | `<speak xml:lang="en-GB">Hello.</speak>`                           | `həˈləʊ .`                                                               |
| `p`, `s`                 | end with a sentence break if the text has no final punctuation                                                                                                                                                                                                           | `<speak><p>Hello there</p><p>Goodbye</p></speak>`                  | `həˈloʊ ˈðɛɹ . ˌɡʊdˈbaɪ .`                                               |
| `break`                  | `time="300ms"` or `"1.5s"`; `strength`: `none` 0 s, `x-weak` 0.05 s, `weak` 0.2 s, `medium` 0.4 s (default), `strong` 0.8 s, `x-strong` 1.2 s                                                                                                                            | `Wait<break time="300ms"/>now<break strength="strong"/>go.`        | `ˈweɪt (0.3) ˈnaʊ (...) ˈɡoʊ .`                                          |
| `prosody`                | `rate`: `x-slow` 0.5, `slow` 0.75, `medium` 1, `fast` 1.3, `x-fast` 1.6, `N%` or a factor such as `1.2`; `pitch`: `x-low` -6, `low` -3, `medium` 0, `high` +3, `x-high` +6 st, `+Nst`, `-Nst`, `+N%`, `-N%`, `NHz` (against the head's pitch, 120 Hz by default), `+NHz` | `<prosody rate="fast" pitch="+2st">Hello there</prosody> friend.`  | `{allegro həˈloʊ ˈðɛɹ allegro} ˈfɹɛnd .`; rate 1.3, pitch 2              |
|                          | `range`: `x-low` 0.25, `low` 0.5, `medium` 1, `high` 1.5, `x-high` 2, `+N%`, `-N%`                                                                                                                                                                                       | `<prosody pitch="200Hz" range="x-high">Hello</prosody> there.`     | `həˈloʊ ˈðɛɹ .`; pitch 8.84 (120 Hz head), range 2                       |
|                          | `volume`: `x-soft` -12, `soft` -6, `medium` 0, `loud` +6, `x-loud` +12 dB, `+NdB`, `-NdB` change the effort by dB/40; `silent` sets `gain` -120                                                                                                                          | `<prosody volume="x-soft">Hello</prosody> there.`                  | `həˈloʊ ˈðɛɹ .`; effort 0.2                                              |
| `vs:gain` (on `prosody`) | `vs:gain="-6dB"`: plain gain                                                                                                                                                                                                                                             | `<prosody vs:gain="-6dB">Hello</prosody> there.`                   | `həˈloʊ ˈðɛɹ .`; gain -6                                                 |
| `emphasis`               | `level`: `strong` 1 (default), `moderate` 0.5, `none` 0, `reduced` -0.5                                                                                                                                                                                                  | `Hello <emphasis>world</emphasis>.`                                | `həˈloʊ ˈˈwɝld .`; emphasis 1                                            |
| `say-as`                 | `interpret-as`: `characters` (or `spell-out`), `cardinal` (or `number`), `ordinal`, `digits`; other values read the content as plain text with a warning                                                                                                                 | `<say-as interpret-as="characters">abc</say-as>.`                  | `ˈeɪ ˈbi ˈsi .`                                                          |
| `phoneme`                | `alphabet="ipa"` and `ph`: the words inside are spoken as `ph`                                                                                                                                                                                                           | `A <phoneme alphabet="ipa" ph="təˈmɑːtəʊ">tomato</phoneme>.`       | `ə təˈmɑːtəʊ .`                                                          |
| `lang`                   | `xml:lang`: language of the content                                                                                                                                                                                                                                      | `Say <lang xml:lang="ru">привет</lang>.`                           | `ˈseɪ prʲɪˈvʲet .`; lang ru                                              |
| `sub`                    | `alias`: spoken instead of the content                                                                                                                                                                                                                                   | `<sub alias="World Wide Web">WWW</sub>.`                           | `ˈwɝld ˈwaɪd ˈwɛb .`                                                     |
| `vs:effort`              | `level`: `whisper` (whisper 1), `soft`, `normal`, `loud`, `shout`, or `value="0.75"`; `to` sets `effortEnd`                                                                                                                                                              | `<vs:effort level="whisper">Hello</vs:effort> there.`              | `{W həˈloʊ W} ˈðɛɹ .`; whisper 1                                         |
|                          |                                                                                                                                                                                                                                                                          | `<vs:effort value="0.5" to="0.75">Hello there</vs:effort>.`        | `{crescendo həˈloʊ ˈðɛɹ } .`; effortEnd 0.75                             |
| `vs:phonation`           | `name`: `modal`, `breathy`, `creaky`, `pressed`, `lax`, `falsetto`, `harsh`, `whisper`, `whispery`; `degree` 0 … 1 (default 0.67)                                                                                                                                        | `<vs:phonation name="breathy">Hello</vs:phonation> there.`         | `{V̤ həˈloʊ V̤} ˈðɛɹ .`; breathy 0.67                                      |
| `vs:emotion`             | `name` (`neutral happy sad angry afraid surprised disgusted tender bored sarcastic confident hesitant`), `intensity` 0 … 1 (default 0.67), or `arousal`, `valence`, `dominance` (-1 … 1)                                                                                 | `<vs:emotion name="sad" intensity="0.8">Hello</vs:emotion> there.` | `həˈloʊ ˈðɛɹ .`; sad 0.8 (arousal -0.32, valence -0.48, dominance -0.24) |
| `vs:tune`                | `name`: a tune label (see [Intonation](#intonation)); an unknown name is a warning                                                                                                                                                                                       | `<speak><vs:tune name="IK6">Какой голос!</vs:tune></speak>`        | `{IK6 kəkɐj ˈɡoɫəs IK6} !`; tune IK6                                     |
| `vs:sound` (empty)       | `name`: `laugh`, `inhale`, `exhale`, `sigh`, `cough`, `throat`, `filler`, `click`; optional `duration="0.5s"`                                                                                                                                                            | `Hello <vs:sound name="laugh"/> there.`                            | `həˈloʊ ⸨laugh⸩ ˈðɛɹ .`                                                  |

The words of a `sub` or `say-as` share the range of the whole element in
the input, and every other word points at its characters in the input, so
the timeline still points into the marked-up text: in
`<speak>Hello <emphasis>world</emphasis>.</speak>` the word `world` has
`sourceStart` 23 and `sourceEnd` 28.

### Safety and limits

The reader never fetches anything and expands nothing. It throws
`MarkupError` (with `position`, the offset in the input) for `<!DOCTYPE`,
`<!ENTITY`, `<![CDATA[`, processing instructions (also `<?xml`), any named
entity other than the five above, malformed XML, and for going over
`MARKUP_LIMITS`:

| Limit             | Value                                                                    |
| ----------------- | ------------------------------------------------------------------------ |
| `maxLength`       | 20 000 characters of input                                               |
| `maxDepth`        | 32 nested elements                                                       |
| `maxElements`     | 2000 elements                                                            |
| `maxPauseSeconds` | 10 s for one break (inline pauses and sounds are clamped with a warning) |

The server applies `MAX_TEXT` (2000) to the text that is read and
`4 * MAX_TEXT` to the marked-up input, and answers 400 on `MarkupError`.

## Inline tags

Span tags are `[name]…[/name]`, sound tags `[name]` alone; a value follows a
space. `\[`, `\]`, `\*` and `\\` are literal characters. An unknown tag
stays in the text with a warning; a tag that is never closed runs to the
end of the input with a warning. Inline parsing never throws.

| Tag                                                                                 | Change                                                                                                                    | Example                                                       | IPA and mode                                                                 |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `[whisper]`                                                                         | whisper 1                                                                                                                 | `[whisper]Hello[/whisper] there.`                             | `{W həˈloʊ W} ˈðɛɹ .`                                                        |
| `[soft]`, `[loud]`, `[shout]`                                                       | effort 0.25, 0.75, 1                                                                                                      | `[soft]Hello[/soft] [loud]there[/loud] [shout]now[/shout].`   | `{p həˈloʊ p} {f ˈðɛɹ f} {ff ˈnaʊ ff} .`                                     |
| `[effort N]`                                                                        | effort N (0 … 1)                                                                                                          | `[effort 0.75]Hello[/effort] there.`                          | `{f həˈloʊ f} ˈðɛɹ .`                                                        |
| `[fast]`, `[slow]`, `[rate N]`                                                      | rate 1.3, 0.75, N                                                                                                         | `[fast]Hello[/fast] [slow]there[/slow] [rate 1.5]now[/rate].` | `{allegro həˈloʊ allegro} {lento ˈðɛɹ lento} ˈnaʊ .`; the last word rate 1.5 |
| `[high]`, `[low]`, `[pitch N]`                                                      | pitch +3, -3, N semitones                                                                                                 | `[high]Hello[/high] [low]there[/low] [pitch -2]now[/pitch].`  | `həˈloʊ ˈðɛɹ ˈnaʊ .`; pitch 3, -3, -2                                        |
| `[breathy]`, `[creaky]` (with a degree: `[creaky 1]`)                               | breathy, creaky 0.67 or the degree                                                                                        | `[breathy]Hello[/breathy] [creaky 1]there[/creaky].`          | `{V̤ həˈloʊ V̤} {3V̰ ˈðɛɹ V̰} .`                                                 |
| `[pressed]`, `[lax]`                                                                | tension +0.67, -0.67                                                                                                      | `[pressed]Hello[/pressed] [lax]there[/lax].`                  | `{V͈ həˈloʊ V͈} {V͉ ˈðɛɹ V͉} .`                                                  |
| `[falsetto]`, `[harsh]`                                                             | falsetto, harsh 0.67                                                                                                      | `[falsetto]Hello[/falsetto] [harsh]there[/harsh].`            | `{F həˈloʊ F} {V! ˈðɛɹ V!} .`                                                |
| every emotion name, `[angry 0.8]`                                                   | emotion with intensity 0.67 or N                                                                                          | `[angry 0.8]Hello[/angry] there.`                             | `həˈloʊ ˈðɛɹ .`; angry 0.8                                                   |
| `[lang ru]`                                                                         | language of the words                                                                                                     | `Say [lang ru]привет[/lang].`                                 | `ˈseɪ prʲɪˈvʲet .`                                                           |
| `[ipa X]`                                                                           | a word spoken as X; with `[/ipa]` the words inside are spoken as X                                                        | `A [ipa təˈmɑːtəʊ] please.`                                   | `ə təˈmɑːtəʊ ˈpliz .`                                                        |
| `[pause N]`                                                                         | a pause of N seconds                                                                                                      | `Wait [pause 0.3] now.`                                       | `ˈweɪt (0.3) ˈnaʊ .`                                                         |
| `[laugh] [inhale] [exhale] [sigh] [cough] [throat] [filler] [click]`, `[cough 0.5]` | a sound (0.3 s or N s)                                                                                                    | `Hello [laugh] there [cough 0.5] ok.`                         | `həˈloʊ ⸨laugh⸩ ˈðɛɹ ⸨cough 0.5⸩ ˈoʊˈkeɪ .`                                  |
| `[tune name]`                                                                       | the tune of the phrase (a tune label)                                                                                     | `[tune call]John![/tune]`                                     | `{call ˈd͡ʒɑn call} !`; tune call                                             |
| `*word*`                                                                            | emphasis 1: the opening star stands before a non-space and after a space or the start, the closing star after a non-space | `Hello *world*.`                                              | `həˈloʊ ˈˈwɝld .`                                                            |

## IPA marks

A brace marker is a chunk between spaces that starts with `{` or ends with
`}`; it is not a word, and nothing in it is read as a phone. A degree digit
`1`, none (or `2`) or `3` before a label gives the degrees 0.33, 0.67 and 1,
e.g. `{3V̤`. `parseIpa()` returns `{ tokens, unknown, modes }` with
`modes: [{ from, to, mode }]` in IPA word indexes (`to` exclusive); unknown
labels go to `unknown` and change nothing. `pitch`, `range`, `gain`,
`emotion` and `lang` have no ExtIPA symbol: they are never written in IPA
and travel only in the `modes` list (`planUtterance(ipa, { modes })`).

| IPA span                                  | Change                                                           | Example                                      | Mode                                 |
| ----------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------- | ------------------------------------ |
| `{pp … pp}`, `{p … p}` (also `𝆏𝆏`, `𝆏`)   | effort 0, 0.25                                                   | `{pp həˈloʊ pp} ˈwɝld`, `{𝆏 həˈloʊ 𝆏} ˈwɝld` | effort 0; effort 0.25                |
| `{f … f}`, `{ff … ff}` (also `𝆑`, `𝆑𝆑`)   | effort 0.75, 1                                                   | `{ff həˈloʊ ff} ˈwɝld`                       | effort 1                             |
| `{crescendo …}`, `{diminuendo …}`         | `effortEnd` = effort + 0.25, effort - 0.25                       | `{crescendo həˈloʊ ˈwɝld }`                  | effortEnd 0.75 over both words       |
| `{allegro … allegro}`, `{lento … lento}`  | rate 1.3, 0.75                                                   | `{lento həˈloʊ lento} ˈwɝld`                 | rate 0.75                            |
| `{V̤ … V̤}` breathy, `{V̰ … V̰}` creaky voice | breathy or creaky 0.33, 0.67, 1                                  | `{3V̤ həˈloʊ V̤} ˈwɝld`                        | breathy 1                            |
| `{C … C}` creak                           | creaky 1                                                         | `{C həˈloʊ C} ˈwɝld`                         | creaky 1                             |
| `{V͈ … V͈}` pressed, `{V͉ … V͉}` lax          | tension +0.33, +0.67, +1 or negative                             | `{V͈ həˈloʊ V͈} {1V͉ ˈwɝld V͉}`                  | tension 0.67; tension -0.33          |
| `{F … F}` falsetto, `{V! … V!}` harsh     | falsetto or harsh 0.33, 0.67, 1                                  | `{F həˈloʊ F} {V! ˈwɝld V!}`                 | falsetto 0.67; harsh 0.67            |
| `{W … W}` whisper                         | whisper 1; the degree sets effort 0.25, unchanged, 0.75          | `{W həˈloʊ W} {1W ˈwɝld W}`                  | whisper 1; whisper 1 and effort 0.25 |
| `{Ṿ … Ṿ}` whispery voice                  | whisper 0.25, 0.5, 0.75                                          | `{Ṿ həˈloʊ Ṿ} ˈwɝld`                         | whisper 0.5                          |
| `{V … V}` modal                           | all phonation values 0                                           | `{V̤ həˈloʊ {V ˈwɝld V} V̤}`                   | breathy 0.67 on the first word only  |
| `(.)`, `(..)`, `(...)`, `(1.2)`           | a pause of 0.2, 0.4, 0.8 s or N s that does not end the sentence | `həˈloʊ (.) ˈwɝld (1.2) ˈbaɪ`                | pauses 0.2 s and 1.2 s               |
| `⸨name⸩`, `⸨name 0.5⸩`                    | a sound                                                          | `⸨laugh⸩ həˈloʊ ⸨cough 0.5⸩`                 | laugh 0.3 s, cough 0.5 s             |
| `{IK4 … IK4}`, `{yesno … yesno}`, …       | the tune of the phrase (a tune label)                            | `{IK4 a tɨ IK4} ?`                           | tune IK4                             |
| `ˈˈ`                                      | emphasis 1 on the word                                           | `həˈloʊ ˈˈwɝld`                              | emphasis 1                           |
| U+0324, U+0330, U+0323 on a phone         | `token.breathy`, `token.creaky`, `token.whispered`               | `a̤ a̰ ạ`                                      | (on the phones)                      |

`formatIpa(tokens, modes)` writes the marks back: for every row,
`parseIpa(formatIpa(tokens, modes)).modes` equals `modes`
(tests/markup.test.js).

## Intonation

Every phrase gets a tune from its sentence type (issue 51, the tables in
`src/articulation/intonation.js`). The text front end writes the type in
the IPA before the punctuation mark (`src/g2p/phrasing.js`), so a text and
its IPA give the same plan. Examples from
`node experiments/issue-51-doc-examples.mjs` (saved in
`experiments/issue-51-doc-examples.txt`):

| Sentence type        | Written                                                                       | Example                       | IPA                                   |
| -------------------- | ----------------------------------------------------------------------------- | ----------------------------- | ------------------------------------- |
| statement            | `.`                                                                           | `You are coming.`             | `ju ɚ ˈkʌmɪŋ .`                       |
| yes/no question      | `?`                                                                           | `Are you coming?`             | `ɚ ju ˈkʌmɪŋ ?`                       |
| wh-question          | `↘ ?`: the first word is a question word (`ZH_WH_WORDS` anywhere in Mandarin) | `Where are you going?`        | `ˈwɛɹ ɚ ju ˈɡoʊɪŋ ↘ ?`                |
| echo question        | `↗ ?`: no question word and no auxiliary first (English)                      | `Really?`                     | `ˈɹɪli ↗ ?`                           |
| alternative question | `↗ \|` before `or`, `или`, `या`, `还是`, then `↘ ?`                           | `Tea or coffee?`              | `ˈti ↗ \| ˈɔɹ ˈkɑfi ↘ ?`              |
| tag question         | `, … ↗ ?` asks, `, … ↘ ?` confirms                                            | `You are coming, aren't you?` | `ju ɚ ˈkʌmɪŋ , ˈɑɹənt ju ↗ ?`         |
| list                 | `,` items rise (continuation), the last one falls                             | `Apples, pears and plums.`    | `ˈæpəlz , ˈpɛɹz ənd ˈplʌmz .`         |
| Russian IK4          | `{IK4 … IK4}`: an а-question of at most 3 words                               | `А ты?`                       | `{IK4 a tɨ IK4} ?`                    |
| Russian IK5          | `{IK5 … IK5}`: `!` after какой, как, сколько, …                               | `Какой сегодня день!`         | `{IK5 kəkɐj sʲɪˈvodʲnʲə dʲenʲ IK5} !` |

A stretch of more than 14 syllables between two punctuation marks gets a
phrase break `|` before the conjunction nearest to its middle when both
sides keep at least 4 syllables (`PHRASE_CONJUNCTIONS`); the phrase before
`|` gets the continuation tune (Russian: IK3 at 0.7):

```
The old man who lived next to the station walked slowly to the market and bought some bread.
ði ˈoʊld ˈmæn ˈhu ˈlɪvd ˈnɛkst tə ðə ˈsteɪʃən ˈwɔkt ˈsloʊli tə ðə ˈmɑɹkət | ənd ˈbɑt ˈsʌm ˈbɹɛd .
```

Each language maps the type onto its tunes: English nuclear tones,
the Russian intonation constructions IK1 to IK7 (statement IK1,
wh-question IK2, yes/no question and continuation IK3), Hindi accent
phrases, and in Mandarin the tones stay and a question without a particle
or question word raises the pitch towards its end. The tune labels
(`TUNE_LABELS`) are `statement wh yesno echo continuation alt-rise tag-ask
tag-confirm exclamation command parenthesis call IK1 IK2 IK3 IK4 IK5 IK6
IK7`; a label (`{IK3 … IK3}`, `[tune yesno]…[/tune]`, `<vs:tune
name="echo">`) wins over the punctuation, and a generic label in Russian
picks its IK. Focus (`*word*`, `<emphasis>`, `ˈˈ`) moves the nucleus to the
word: in English it is 2.9 semitones higher, 1.2 times longer and 3 dB
louder and the accents after it are compressed (`FOCUS`).

## The plan

`planUtterance(ipa, { modes })` uses `options.modes` when given, else the
spans of the IPA marks, and sets `token.mode` on every token (a pause or a
sound takes the mode of the word before it). The plan gets:

- `plan.modes`: spans in seconds, sorted, not overlapping, from 0 to
  `plan.duration`, each `{ start, end, ...mode }` with every field of
  `MODE_DEFAULTS`; `modeAt(plan, time)` finds the span at a time;
- `plan.sounds`: `[{ name, start, end }]`.

Measured with `node experiments/issue-50-realise.mjs` ("Hello there, my
good friend" against the plain text): `[fast]` gives 0.769 of the plain
duration of its words, `[pitch +12]` a mean f0 ratio of 2.0000, `[soft]` a
peak loudness ratio of 0.3162 (-10 dB); `[pause 1.5]`, `[laugh]` and
`[cough 0.5]` last 1.500, 0.300 and 0.500 s.
