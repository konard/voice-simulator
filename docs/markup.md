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

| Field                 | Default | Meaning                                                                                         | Heard today                                                                                                            |
| --------------------- | ------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `effort`, `effortEnd` | 0.5     | vocal effort 0 (very soft) … 1 (shout) at the start and end of a span; `(effort - 0.5) * 40` dB | level, pitch, tilt, F1, vowel length, noise ([Vocal effort](#vocal-effort))                                            |
| `lombard`             | false   | speech in noise: only vowels with primary stress get longer                                     | vowel length                                                                                                           |
| `gain`                | 0       | plain level change in dB                                                                        | level                                                                                                                  |
| `rate`                | 1       | speed factor: 2 halves the durations                                                            | durations                                                                                                              |
| `pitch`               | 0       | shift in semitones                                                                              | pitch targets                                                                                                          |
| `range`               | 1       | factor on pitch movements                                                                       | pitch targets                                                                                                          |
| `emphasis`            | 0       | -0.5 reduced, 0 none, 0.5 moderate, 1 strong                                                    | focus: pitch, duration, level (#51)                                                                                    |
| `phonation`           | all 0   | `breathy`, `creaky`, `tension` (-1 lax … 1 pressed), `falsetto`, `harsh`, `whisper`, each 0 … 1 | breath noise, pitch and pulse shape ([Phonation types](#phonation-types)); `whisper`: the source ([Whisper](#whisper)) |
| `emotion`             | neutral | `name`, `intensity`, `arousal`, `valence`, `dominance`                                          | carried (#55)                                                                                                          |
| `tune`                | null    | intonation label (`TUNE_LABELS`)                                                                | the tune of the phrase (#51)                                                                                           |
| `lang`                | null    | language tag of the span                                                                        | transcription and tunes                                                                                                |

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
|                          | `volume`: `x-soft` -20, `soft` -10, `medium` 0, `loud` +10, `x-loud` +20 dB (the effort of `{pp}`, `{p}`, normal, `{f}`, `{ff}`), `+NdB`, `-NdB` change the effort by dB/40; `silent` sets `gain` -120                                                                   | `<prosody volume="x-soft">Hello</prosody> there.`                  | `{pp həˈloʊ pp} ˈðɛɹ .`; effort 0                                        |
| `vs:gain` (on `prosody`) | `vs:gain="-6dB"`: plain gain                                                                                                                                                                                                                                             | `<prosody vs:gain="-6dB">Hello</prosody> there.`                   | `həˈloʊ ˈðɛɹ .`; gain -6                                                 |
| `emphasis`               | `level`: `strong` 1 (default), `moderate` 0.5, `none` 0, `reduced` -0.5                                                                                                                                                                                                  | `Hello <emphasis>world</emphasis>.`                                | `həˈloʊ ˈˈwɝld .`; emphasis 1                                            |
| `say-as`                 | `interpret-as`: `characters` (or `spell-out`), `cardinal` (or `number`), `ordinal`, `digits`; other values read the content as plain text with a warning                                                                                                                 | `<say-as interpret-as="characters">abc</say-as>.`                  | `ˈeɪ ˈbi ˈsi .`                                                          |
| `phoneme`                | `alphabet="ipa"` and `ph`: the words inside are spoken as `ph`                                                                                                                                                                                                           | `A <phoneme alphabet="ipa" ph="təˈmɑːtəʊ">tomato</phoneme>.`       | `ə təˈmɑːtəʊ .`                                                          |
| `lang`                   | `xml:lang`: language of the content                                                                                                                                                                                                                                      | `Say <lang xml:lang="ru">привет</lang>.`                           | `ˈseɪ prʲɪˈvʲet .`; lang ru                                              |
| `sub`                    | `alias`: spoken instead of the content                                                                                                                                                                                                                                   | `<sub alias="World Wide Web">WWW</sub>.`                           | `ˈwɝld ˈwaɪd ˈwɛb .`                                                     |
| `vs:effort`              | `level`: `whisper` (whisper 1), `soft`, `normal`, `loud`, `lombard`, `shout`, or `value="0.75"`; `to` sets `effortEnd`                                                                                                                                                   | `<vs:effort level="whisper">Hello</vs:effort> there.`              | `{W həˈloʊ W} ˈðɛɹ .`; whisper 1                                         |
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
| `[lombard]`                                                                         | effort 0.75, only primary-stressed vowels get longer                                                                      | `[lombard]Hello[/lombard] there.`                             | `{f həˈloʊ f} ˈðɛɹ .`; lombard true                                          |
| `[crescendo]`, `[diminuendo]`                                                       | `effortEnd` = effort + 0.25, effort - 0.25                                                                                | `[crescendo]Hello there[/crescendo] now.`                     | `{crescendo həˈloʊ ˈðɛɹ } ˈnaʊ .`; effortEnd 0.75                            |
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

- `plan.channels.effort` (dB) and `plan.channels.tension` (offset on
  `head.tenseness`), see [Vocal effort](#vocal-effort).
- `plan.channels.whisper` (0 … 1), see [Whisper](#whisper).

Measured with `node experiments/issue-50-realise.mjs` ("Hello there, my
good friend" against the plain text): `[fast]` gives 0.769 of the plain
duration of its words, `[pitch +12]` a mean f0 ratio of 2.0000; `[pause
1.5]`, `[laugh]` and `[cough 0.5]` last 1.500, 0.300 and 0.500 s.

## Vocal effort

Effort is more than a level: a louder voice also has a higher pitch, a
flatter spectrum, a higher first formant and longer vowels (issue 52). The
effort of a span is written in decibels, `E = (effort - 0.5) * 40`, from
-20 dB (`effort` 0) to +20 dB (`effort` 1). `EFFORT_RULES` and
`effortChanges(E, head)` (src/articulation/effort.js) give the rules:

| Quantity           | Rule                                    | -10 dB (`[soft]`) | +10 dB (`[loud]`) | +20 dB (`[shout]`) | Source                                                                  |
| ------------------ | --------------------------------------- | ----------------- | ----------------- | ------------------ | ----------------------------------------------------------------------- |
| level              | `E` dB                                  | -10 dB            | +10 dB            | +20 dB             | definition                                                              |
| lung pressure      | × `2^(E/9)`                             | × 0.463           | × 2.16            | × 4.67             | Titze & Sundberg 1992: 8-9 dB per doubling of the pressure              |
| pitch              | +5 Hz per dB, -4 … +12 st               | -4 st             | +6.03 st          | +10.49 st          | Liénard & Di Benedetto 1999 (120 Hz speaker)                            |
| F1                 | +3.5 Hz per dB                          | -35 Hz            | +35 Hz            | +70 Hz             | Liénard & Di Benedetto 1999                                             |
| F2, F3             | unchanged                               | 0                 | 0                 | 0                  |                                                                         |
| tilt (above 1 kHz) | +0.2 dB per dB                          | -2 dB             | +2 dB             | +4 dB              | Liénard & Di Benedetto 1999: F3 gains 2 dB over F1 per 10 dB of effort  |
| vowel duration     | × 1, 1.1, 1.3 at 0, +10, +20 dB         | × 1               | × 1.1             | × 1.3              | research notes (proposal)                                               |
| consonant duration | unchanged                               | × 1               | × 1               | × 1                | research notes (proposal)                                               |
| noise              | `0.5 E` dB above normal, `1.25 E` below | -12.5 dB          | +5 dB             | +10 dB             | project choice: below normal effort the airflow falls with the pressure |

Where they are realised: the planner fills the `effort` and `tension`
channels, shifts the pitch, opens the jaw of open vowels (F1), lengthens
vowels and raises the lung pressure channel. The LF source (the default)
adds the tension to its tenseness, scales its voiced part and passes it
through a shelf above 1 kHz so that the level and the alpha ratio follow
the level and tilt rules; the renderer scales aspiration, frication and
bursts by the noise rule. The fold source (`source: 'folds'`) takes its
level and tilt from the raised lung pressure itself; its fold tension is
set for the pitch less the rise the folds give on their own
(`FOLD_PITCH_RISE`, measured on `ˈa` with
`node experiments/issue-52-folds-pitch.mjs`: -0.39, 0 and +0.74 st at -10,
+10 and +20 dB on the statement tune of #51), so both sources keep the
pitch rule. The Rust engine realises the same gains
(`crates/voice-simulator-core/src/effort.rs`).

Measured with `node experiments/issue-52-effort-tuning.mjs` ("Please call
Stella.", tier medium, seed 1, LF source; F1 on `ˈa`), against plain
speech:

| Span        | Level     | Pitch     | Alpha ratio | H1-H2    | F1 of `ˈa` | Vowels  | Consonants |
| ----------- | --------- | --------- | ----------- | -------- | ---------- | ------- | ---------- |
| `[soft]`    | -10.60 dB | -4.00 st  | -1.84 dB    | +2.34 dB | -20 Hz     | × 1.000 | × 1.000    |
| `[loud]`    | +11.25 dB | +6.05 st  | +0.31 dB    | -3.67 dB | +35 Hz     | × 1.100 | × 1.000    |
| `[shout]`   | +21.55 dB | +10.50 st | -0.45 dB    | -7.41 dB | +40 Hz     | × 1.300 | × 1.000    |
| `[lombard]` | +11.25 dB | +6.04 st  | +0.23 dB    | -3.74 dB |            | × 1.084 | × 1.000    |

`<prosody vs:gain="-6dB">` is a plain gain: -5.95 dB and +0.18 dB of
alpha ratio.

The alpha ratio and F1 of one rendering depend on where the harmonics
fall: F2 of [ɔ] in "call" lies near the 1 kHz edge of the alpha ratio and
the F1 estimate follows the nearest harmonic, so half a semitone of
speaker pitch moves the alpha ratio of `[shout]` from -1.84 to +1.95 dB
(+1.03 to +6.34 dB before the tunes of #51). The alpha ratio is defined on
a long-term average spectrum, so `tests/effort.test.js` pools the spectra
of seven renderings with the speaker pitch 120 Hz × 2^(s/12), s = -3 … 3,
and averages the F1 shifts over the same pitches: `[soft]`, `[loud]` and
`[shout]` measure -2.80, +2.98 and +3.16 dB of alpha ratio, `{f ˈa f}` and
`{ff ˈa ff}` +46.8 and +61.4 Hz of F1
(`node experiments/issue-51-effort-alpha.mjs`; the same pooling gives
-1.74, +3.29, +3.75 dB and +45.4, +67.5 Hz before #51).

### Level convention

Effort 0.5 is conversational speech at 60 dB SPL at 1 m:
`effortToSpl(effort) = 60 + E` and `splToEffort(spl)` is its inverse, so
`[loud]` is 70 dB SPL and `[shout]` 80 dB SPL. `effortToDecibels()` and
`decibelsToEffort()` convert between effort and `E`.

The output is lowered by the loudest span, `maxModeLevel(plan.modes)`
(`E + gain`, at least 0), so that a shout does not clip: the result carries
it as `levelOffsetDb` (-20 for a whole shout, 0 for plain text). With
`headroom` (`--headroom`) the offset is `-headroom` instead, so renderings
of different modes keep comparable levels. `loudnessTarget` (`--loudness`,
LUFS) measures the integrated loudness of ITU-R BS.1770
(`integratedLoudness()`, K-weighting and gating) and scales the result to
it, never above a peak of 0.98; `result.loudness` is the loudness reached
and `levelOffsetDb` includes the gain. Streams have no loudness target.

```sh
voice-simulator say --markup "[shout]Hey![/shout]" --out hey.wav   # peak below 0.98
voice-simulator say --loudness=-23 "Hello there." --out hello.wav    # -23 LUFS
```

### Ramps and Lombard speech

A span from `effort` to `effortEnd` (`[crescendo]`, `[diminuendo]`,
`{crescendo …}`, `<vs:effort value="0.25" to="0.75">`) ramps linearly in dB
from the end of its first vowel to the start of its last, so the first
vowel keeps the start value and the last has the end value. Natural ramps
are 5 to 10 dB/s; a span that asks for more than `EFFORT_RAMP_LIMIT` (40
dB/s) gets a warning in `result.warnings` (`fastEffortRamps()`). Measured
with `node experiments/issue-52-crescendo.mjs`:
`[crescendo]la la la la la la[/crescendo]` rises by 9.14 dB from the first
to the last vowel, a diminuendo falls by 10.30 dB.

`[lombard]` and `<vs:effort level="lombard">` (speech in noise) are effort
0.75 with one difference: only vowels with primary stress get longer. In
IPA they are written `{f … f}`, like `[loud]`.

### How a mode is written and recognised

| Text / SSML                                       | IPA           | Correlates that can be measured (#71)         |
| ------------------------------------------------- | ------------- | --------------------------------------------- |
| `[soft]`, `<prosody volume="soft">`               | `{p … p}`     | alpha ratio -2 dB, pitch -4 st re the speaker |
| `[loud]`, `[lombard]`, `<vs:effort level="loud">` | `{f … f}`     | alpha ratio +2 dB, pitch +6 st, F1 +35 Hz     |
| `[shout]`                                         | `{ff … ff}`   | alpha ratio +4 dB, pitch +10 st, F1 +70 Hz    |
| `[crescendo]`, `to="…"`                           | `{crescendo}` | the same measures rising inside the span      |
| `vs:gain="-6dB"` on `prosody`                     | not written   | level only; not recognisable                  |

`levelDb(samples, from, to)` (RMS in dB re full scale) and
`alphaRatio(samples, sampleRate, from, to)` (level of 1-5 kHz minus level
of 50 Hz-1 kHz) of src/analysis/mode-features.js measure them.

## Phonation types

A phonation type changes the voice source, not the words (issue 54).
`PHONATION` and `phonationChannels(mode, token, head)`
(src/articulation/phonation.js) move the LF shape parameter Rd (Fant 1995)
from the speaker's own value `rdVoice = 3 (1 - tenseness)` towards the
target of the type and set the other source channels of the plan:
`rd = rdVoice + d (target - rdVoice)` at degree `d`, which becomes the
`tension` channel `(rdVoice - rd) / 3` (added to the tenseness like the
tension of [Vocal effort](#vocal-effort)). Tension offsets add, every other
channel takes the maximum. The lowest Rd of a pulse is now 0.3 (it was
0.5), so pressed voice (Rd 0.4) is not clipped.

| Type     | Rd target | Other channels at `d` = 1  |
| -------- | --------- | -------------------------- |
| breathy  | 2.5       | `breath` 1                 |
| lax      | 1.8       | none                       |
| pressed  | 0.4       | none                       |
| creaky   | 0.5       | `creak` 1                  |
| falsetto | 2.3       | `falsetto` 1, `breath` 0.3 |
| harsh    | 0.4       | `harsh` 1                  |

The channels `breath`, `creak`, `falsetto` and `harsh` (0 … 1, smoothed with
τ = 0.03 s) reach the glottis through `shape.glottis`; `PHONATION_SOURCE`
(src/acoustics/glottis.js) realises them:

- `breath` adds `0.6 breath` to the breathiness of the breath noise and of
  the mean glottal area (`noiseBreathiness`): breathy voice at 1 has its
  breath noise 13.6 dB below the pulses at the source (the issue asks for
  10 to 20 dB; a gain of 1 instead of 0.6 gave 8.9 dB);
- `creak` lowers f0 by `12 c` semitones (not below 25 Hz; a period may now
  be as long as 1/20 s instead of 1/30 s), adds `10 c` % jitter and makes
  every second period weaker (× `1 - 0.5 c`) and longer (× `1 + 0.2 c`;
  both periods shrink by half of that, so a pair keeps the length of two
  periods of the lowered f0);
- `falsetto` raises f0 by `12 f` semitones and lowers the voiced part by
  `6 f` dB; a one-pole low-pass at `1.5 f0 / f` smooths the pulse of the
  thin folds that barely close;
- `harsh` adds `4 h` % jitter, `10 h` % shimmer and the breath noise of
  breath `0.3 h`.

One phone: `a̤` (U+0324) and `a̰` (U+0330) get the breathy or creaky row at
`d` = 0.67 for their own duration (the old aspiration 0.4 of `a̤` is gone).
Hindi breathy-voiced stops `bʱ dʱ ɖʱ ɡʱ dʒʱ` get a voiced release of
`0.08 · rate` s with voicing 1, breath 1 and Rd 2.5, whose f0 starts 1.5 st
lower and glides into the vowel (`BREATHY_RELEASE`). The head parameter
`finalCreak` (0 … 1, default 0) creaks the last syllable before `.` or `‖`
where the pitch falls below 0.8 of the speaker pitch:
`creak = finalCreak · min(1, (0.8 pitch - f0) / (0.1 pitch))`
(`FINAL_CREAK`; the issue proposed 0.2 pitch, but the statements of the
model end at 0.74 to 0.81 of the pitch, which gave 2.7 % jitter in the
last vowel of `You are coming.` instead of the 5 % asked; 0.1 gives
10.1 %). With the default head and no markup the samples do not
change, except Hindi words with breathy-voiced stops. The fold source
(`source: 'folds'`) takes the phonation as adduction (breathy apart,
pressed together), fold tension (creak slack an octave down, falsetto stiff
an octave up) and lung pressure (creak halves it on the folds); the Rust
engine realises the same channels.

### How a phonation is written and recognised

Targets against modal voice of the same speaker; measured on "Please call
Stella." (tier medium, seed 1, LF source) with
`node experiments/issue-54-measures.mjs` and
`node experiments/issue-54-scenarios.mjs`. Modal: f0 128.34 Hz, H1-H2
4.72 dB, HNR 20.41 dB, CPP 28.01 dB, jitter 0.76 %.

| Type     | Inline / `vs:phonation name` | IPA span, segment | Correlates (targets at `d` = 1)       | Measured at `d` = 1                                     |
| -------- | ---------------------------- | ----------------- | ------------------------------------- | ------------------------------------------------------- |
| breathy  | `[breathy]`                  | `{V̤ … V̤}`, `a̤`    | H1-H2 ≥ 7 dB; HNR and CPP lower       | H1-H2 11.72 dB, HNR 4.74 dB, CPP 15.83 dB, f0 -0.24 st  |
| creaky   | `[creaky]`                   | `{V̰ … V̰}`, `a̰`    | f0 -12 st, jitter ≥ 5 %, H1-H2 < 0 dB | pulse f0 -12.52 st, jitter 7.06 %, pulse H1-H2 -1.16 dB |
| creak    | `degree="1"`                 | `{C … C}`         | f0 below 70 Hz                        | `{C ˈa C}`: pulse f0 64.72 Hz                           |
| pressed  | `[pressed]`                  | `{V͈ … V͈}`         | H1-H2 < 0 dB, HNR not lower           | H1-H2 -4.55 dB, HNR 19.33 dB                            |
| lax      | `[lax]`                      | `{V͉ … V͉}`         | H1-H2 + 3 dB                          | H1-H2 9.66 dB (+4.94), HNR 20.04 dB                     |
| falsetto | `[falsetto]`                 | `{F … F}`         | f0 + 12 st, H1-H2 ≥ 8 dB              | f0 +11.78 st, H1-H2 13.11 dB                            |
| harsh    | `[harsh]`                    | `{V! … V!}`       | H1-H2 < 0 dB, HNR lower, jitter ≥ 3 % | H1-H2 -4.40 dB, HNR 8.02 dB, jitter 3.46 %              |

Breathy H1-H2 rises with the degree: 8.52, 10.50 and 11.72 dB at 0.33, 0.67
and 1. In `ˈma̤ma` the first vowel has H1-H2 10.82 dB against 5.43 dB in the
second; in `ˈma̰ma` its f0 is 86.26 Hz against 134.33 Hz in `ˈmama`. The
release of Hindi `bʱaː` lasts 80 ms, is voiced for 0.86 of its length and
has H1-H2 12.11 dB. `You are coming.` with `finalCreak: 1` has 10.09 %
jitter in its last vowel and 0.18 % in its first.

The creaky pulses fall below the 60 Hz floor of the YIN pitch of
`analyzeVoice()`, so creak is measured pitch-synchronously: `pulseF0`,
`pulseH1H2` and `glottalPeriods` find the glottal closures in the LPC
residual. `cpp(samples, sampleRate)` is the cepstral peak prominence (40 ms
Hann frames, peak between 1/300 and 1/60 s above the regression line, median
over voiced frames) and `jitterPercent(samples, sampleRate)` the mean
absolute difference of neighbouring periods over the mean period
(src/analysis/mode-features.js).

## Whisper

A whisper (issue 53) has no fold vibration: the glottis is held half open
(40 ± 30 mm² against about 5 mm² in a modal voice, Solomon et al. 1989)
and the air passing it is turbulent. The formants come from the tract as
in a voice, but they are higher, the speech is longer and much quieter, and
the voiced and voiceless consonants stay apart by their closures, bursts
and frication.

### How it is written

`[whisper]`, `<vs:phonation name="whisper">`, `<vs:effort level="whisper">`
and `{W … W}` set `mode.phonation.whisper` to 1; `{1W … 1W}` and
`{3W … 3W}` (`[whisper][soft]`, `[whisper][loud]`) add effort 0.25 and 0.75;
`{Ṿ … Ṿ}` and `<vs:phonation name="whispery">` give a whispery voice
(whisper 0.25 … 0.75). A phone with U+0323 (`ạ`) is whispered, and a
vowel or sonorant written voiceless with U+0325 (`ḁ`, `l̥`) gets the same
source. Every form gives the same `plan.channels.whisper`
(tests/whisper.test.js).

### What the plan and the source do

- **Plan** (src/articulation/whisper.js): the channel `whisper` (0 … 1,
  smoothed with a time constant of 0.03 s) is the whisper of the mode of
  each segment, and 1 for `ạ`, `ḁ` and `l̥`, whose voicing target becomes 1
  (the drive of the source). Every segment of a whisper span (timed
  pauses and sounds excepted) is `1 + 0.3 · whisper` times as long
  (`WHISPER_DURATION`). Effort does not change the pitch of a whisper.
- **Source** (src/acoustics/glottis.js, src/acoustics/whisper.js): the
  voiced part is multiplied by `1 - whisper`; at 1 there is no pulse and
  the pulse phase stands still. The whisper noise has the drive
  `whisper · voicing · (1 - closure)`, × 0.5 in the closure of a voiced
  stop (`WHISPER_STOP_DRIVE`) and × 0.25 in a voiced fricative. It is the
  turbulence of issue 35 at a glottis of 40 mm² (`WHISPER_AREA`) with the
  lung pressure of the effort, not modulated by pulses and without the
  800 Hz band of the aspiration: white noise through a low-pass at the
  Strouhal frequency of the glottal jet. Values between 0 and 1 give a
  whispery voice: pulses and noise, the noise 6 dB louder at 0.5
  (`WHISPERY_BOOST`).
- **Reflection**: the glottal end of the tract reflects
  `GLOTTAL_REFLECTION · (1 - WHISPER_OPENING · whisper)`, with
  `WHISPER_OPENING` 1.65 (-0.49 at whisper 1): an open glottis raises and
  widens F1. Source-tract interaction (issue 34) gives the fold source the
  load of the tract and the trachea, but only for the folds with
  interaction; the LF source (the default) and the folds without it have
  only this reflection to show an open glottis, so `WHISPER_OPENING` stays
  for them.
- **Level**: the whisper and the noise of the consonants are 25 dB below
  the voice at effort 0.5, 30 dB at 0.25, and 20 dB at 0.75 and above,
  where the glottis of a stage whisper narrows to 20 mm²
  (`STAGE_WHISPER_AREA`).
- **Pitch**: the whisper noise follows the intended pitch by +0.7 dB per
  semitone of the f0 channel above the speaker's pitch, at most ±6 dB
  (`WHISPER_PITCH_GAIN`, `WHISPER_PITCH_LIMIT`; Higashikawa et al. 1996).
- **Consonants**: they keep their cues. A voiceless stop has the longer
  closure and the stronger burst, a voiceless fricative is longer and
  stronger than a voiced one.

### Measured

`voicedShare()`, `frameAperiodicities()`, `energyRatio()` (level above
2.5 kHz minus 50 Hz-1 kHz) and `centreOfGravity()` of
src/analysis/mode-features.js measure a whisper. "Please call Stella.",
tier medium, seed 1, headroom 20, against plain speech; measured with
`node experiments/issue-53-quick.mjs` and the commands below (IPA forms
against the plain IPA):

| Markup                                                  | Expected                | Measured                                                                                                         |
| ------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `[whisper]`, `<vs:phonation name="whisper">`, `{W … W}` | voiced < 0.05, ER +6 dB | voiced 0 (plain 0.83), ER +15.8 dB (`{W}` +16.5 dB), level -25.8 dB (`{W}` -27.4 dB), CoG 1214 Hz (plain 416 Hz) |
| soft `[whisper][soft]`, `{1W … 1W}`                     | -30 dB                  | -31.8 dB (-5.9 dB re `[whisper]`), `{1W}` -34.0 dB                                                               |
| stage `[whisper][loud]`, `{3W … 3W}`                    | -20 dB                  | -20.8 dB (+5.1 dB re `[whisper]`), `{3W}` -21.6 dB                                                               |
| whispery `{Ṿ … Ṿ}`                                      | voiced, HNR < 10 dB     | voiced 0.94, HNR 8.9 dB (`ˈama` 21.9 dB)                                                                         |
| `ạ`, `ḁ`                                                | no periodicity          | voiced 0, YIN aperiodicity ≥ 0.66 in every frame                                                                 |

More, from the same commands:

- the whispered sentence is 1.290 times as long; 98.7 % of its frames have
  a YIN aperiodicity above 0.4 and its HNR is 0.0 dB (plain 20.4 dB);
- `node experiments/issue-53-contrasts.mjs`: closure of `{W ˈapa W}` 92 ms
  against 71 ms of `{W ˈaba W}`, burst -41.9 against -45.7 dB; `s` 105 ms
  and -64.2 dB, `z` 65 ms and -68.7 dB;
- `node experiments/issue-53-whisper-tuning.mjs high` (tier high, one LPC
  fit over the middle 60 % of the vowel): F1 of whispered [a], [i], [u]
  +265, +120, +140 Hz, mean +175 Hz (target 255 ± 90); F2 of [i] 2225 Hz;
- `node experiments/issue-53-languages.mjs`: the voiced share of a whisper
  is 0 in English, Russian, Hindi and Mandarin (plain 0.83, 0.64, 0.87,
  0.91);
- `voice-simulator say --markup "[whisper]Hello.[/whisper]" --out w.wav`
  (the default tier) has a voiced share of 0.000.

Plain text renders the same samples as before the whisper
(`node experiments/issue-53-plain-identity.mjs <checkout of main>`,
experiments/issue-53-plain-identity.txt).

### Limits

- Every tier has a vocal tract, so there is no tract-less tier to whisper
  through a filter.
- At tier high (the 3D solver) the glottal reflection stops at
  `MIN_GLOTTAL_REFLECTION` (-0.5), and a whispered `{W ˈa W}` is about
  6 dB quieter than at tier medium (-68.2 against -62.1 dB with headroom
  20; `node experiments/issue-53-whisper-level-tiers.mjs`).
- The WebGPU solver keeps the decay of the cells it was uploaded with, so
  it does not lower the glottal reflection, nor does source-tract
  interaction; both still get the whisper source.
- The Rust engine has no whisper source yet
  ([#82](https://github.com/konard/voice-simulator/issues/82)): a plan that
  whispers is rendered by the JavaScript renderer (see
  [RUST-ENGINE.md](RUST-ENGINE.md)).
- Recognising whispered speech is issue 71 and 72; Mandarin tones in a
  whisper are not modelled beyond the level cue of the pitch.
