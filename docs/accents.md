# Accents

<!-- Written by scripts/accents-doc.mjs; edit that script, not this file. -->

An accent is a code of a language (`ru-x-south`, `en-x-ru`) or an accent
file. It changes the IPA that the pronouncer gives (g2p switches, then
rules, then phonotactics), the intonation and timing (tunes, pitch range,
rate, stress lengthening) and the speaker's habits (head offsets). The
default accent of each language (`en-US`, `ru-RU`, `hi-IN`, `zh-CN`)
leaves the output unchanged.

```js
import { textToIpa, synthesize, loadAccent } from 'voice-simulator';

textToIpa('город', { lang: 'ru', accent: 'ru-x-south' }).ipa; // 'ˈɣorət'
textToIpa('thing', { lang: 'en', accent: { code: 'en-x-ru', strength: 0.5 } }).ipa; // 'ˈsink'
synthesize('pit', { lang: 'en', accent: 'en-x-ru', accentLevel: 0.7 });
synthesize('three', { lang: 'en', accent: loadAccent(json) }); // an accent file
```

```bash
npx voice-simulator ipa --lang en --accent en-x-ru "thing"         # ˈsʲink
npx voice-simulator ipa --accent examples/accents/en-x-th-stopping.json "the three red rivers"
npx voice-simulator say --lang ru --accent ru-x-south --accent-level 0.5 "город" -o gorod.wav
```

- **Strength** (`accentLevel`, or `strength` of `{ code, strength }`) goes
  from 0 to 1 (default 1). A rule applies from its `min` strength; an
  offset `o` becomes `o·s` and a factor `f` becomes `1 + (f − 1)·s`.
  Strength 0 is the base accent.
- **Where an accent comes from**: the `accent` option of `textToIpa`,
  `prepareUtterance` and `synthesize`; the CLI `--accent <code|file.json>`
  and `--accent-level`; the `accent` field of a voice file (an option
  wins); the server field `accent` (a code, `{ code, strength }` or an
  accent object in a JSON body, never a file path) and `accentLevel`.
- **An unknown code** of the language of the text is a `RangeError` (a 400
  on the server); an accent of another language is ignored (the text keeps
  its language's default accent).
- **Foreign accents** `<target>-x-<first>` exist for every pair of English,
  Russian, Hindi and Mandarin (`foreignAccent(target, first)` builds the
  definition from the profile of the first language in
  `src/accent/profiles/`).
- `explainAccent(expectedIpa, heardIpa, lang)` ranks the accents of a
  language by how many of the differences between two transcriptions their
  rules explain (`explainAccent('ˈɡorət', 'ˈɣorət', 'ru')[0]` is
  `{ code: 'ru-x-south', explained: 1, total: 1 }`).

## The accent file

`examples/accents/en-x-th-stopping.json`:

```json
{
  "format": "voice-simulator/accent",
  "version": 1,
  "code": "en-x-th-stopping",
  "name": "English with TH-stopping and a forward lip posture",
  "language": "en",
  "base": "en-US",
  "rules": [
    { "map": { "θ": "t̪", "ð": "d̪" }, "note": "TH-stopping: dental stops" },
    {
      "match": { "kind": "consonant", "manner": "plosive", "voiced": false },
      "remove": "ʰ",
      "after": "s",
      "note": "No aspiration after s (already so in en-US)"
    },
    {
      "map": { "ɹ": "ɾ" },
      "before": "V",
      "min": 0.5,
      "note": "A tapped r before a vowel, from strength 0.5"
    }
  ],
  "phonotactics": {
    "codas": "any",
    "maxOnset": 4,
    "epenthesis": "ə",
    "prothesis": null
  },
  "prosody": {
    "tunes": "en",
    "range": 1.2,
    "rate": 0.9,
    "stressLengthening": 1
  },
  "articulation": { "lipPosture": 0.2, "jawPosture": 0.1 }
}
```

| Field | Meaning |
| --- | --- |
| `format`, `version` | `"voice-simulator/accent"` and `1` |
| `code` | A language tag (`en-x-mine`) |
| `name` | Free text (defaults to the code) |
| `language` | `en`, `ru`, `hi` or `zh` |
| `base` | The built-in accent whose pronunciation the rules start from (defaults to the language's first accent) |
| `g2p` | Switches of the pronouncer: `en` `weakForms`; `ru` `okanye`, `fricativeG`; `zh` `erhua`, `lowThird` |
| `rules` | At most 500 rules, applied in order to every unit of the IPA |
| `phonotactics` | `codas` (`"any"` or the units allowed at the end of a word; others get `epenthesis` after them), `maxOnset` (longer onsets get `epenthesis` inside), `epenthesis` (a vowel), `prothesis` (a vowel put before an initial s + consonant, or null) |
| `prosody` | `tunes` (the intonation of a language), `range` (pitch range factor), `rate` (duration factor: above 1 is slower), `stressLengthening` (factor of the stressed lengthening) |
| `articulation` | Offsets added to head parameters (`lipPosture`, `jawPosture`, …) |

A rule has either `map` (units to units) or `match` (phoneme fields
`kind`, `place`, `manner`, `voiced`, `height`, `backness`, `rounded`;
a value or a list) with `add` and/or `remove` (a diacritic). `before` and
`after` restrict it to a context: a unit, `#` (a word edge), `V` (a vowel),
`C` (a consonant), `voiceless` or `front` (a front vowel). `stress` is
`"stressed"` or `"unstressed"`, `min` the lowest strength at which it
applies, `note` free text. `loadAccent(json)` checks a file and throws a
`TypeError` that names the wrong field (`Accent field rules[0].map["θ"] has
symbols the IPA parser does not know: Ж`).

## Codes

| Code | Language | Name | Base | Rules |
| --- | --- | --- | --- | --- |
| [`en-US`](#en-us-american) | en | American | none | 0 |
| [`en-GB`](#en-gb-british) | en | British | none | 0 |
| [`en-AU`](#en-au-australian) | en | Australian | none | 0 |
| [`en-IN`](#en-in-indian) | en | Indian | none | 0 |
| [`en-CA`](#en-ca-canadian-english) | en | Canadian English | `en-US` | 2 |
| [`en-x-ru`](#en-x-ru-english-with-a-russian-accent) | en | English with a Russian accent | `en-US` | 4 |
| [`en-x-hi`](#en-x-hi-english-with-a-hindi-accent) | en | English with a Hindi accent | `en-IN` | 1 |
| [`en-x-zh`](#en-x-zh-english-with-a-chinese-accent) | en | English with a Chinese accent | `en-US` | 1 |
| [`ru-RU`](#ru-ru-standard) | ru | Standard | none | 0 |
| [`ru-x-north`](#ru-x-north-northern-russian-okanye) | ru | Northern Russian (okanye) | `ru-RU` | 0 |
| [`ru-x-south`](#ru-x-south-southern-russian-fricative-g) | ru | Southern Russian (fricative g) | `ru-RU` | 2 |
| [`ru-x-en`](#ru-x-en-russian-with-an-english-accent) | ru | Russian with an English accent | `ru-RU` | 3 |
| [`ru-x-hi`](#ru-x-hi-russian-with-a-hindi-accent) | ru | Russian with a Hindi accent | `ru-RU` | 1 |
| [`ru-x-zh`](#ru-x-zh-russian-with-a-chinese-accent) | ru | Russian with a Chinese accent | `ru-RU` | 1 |
| [`hi-IN`](#hi-in-standard) | hi | Standard | none | 0 |
| [`hi-x-east`](#hi-x-east-eastern-hindi) | hi | Eastern Hindi | `hi-IN` | 2 |
| [`hi-x-en`](#hi-x-en-hindi-with-an-english-accent) | hi | Hindi with an English accent | `hi-IN` | 3 |
| [`hi-x-ru`](#hi-x-ru-hindi-with-a-russian-accent) | hi | Hindi with a Russian accent | `hi-IN` | 4 |
| [`hi-x-zh`](#hi-x-zh-hindi-with-a-chinese-accent) | hi | Hindi with a Chinese accent | `hi-IN` | 1 |
| [`zh-CN`](#zh-cn-standard-putonghua) | zh | Standard (Putonghua) | none | 0 |
| [`zh-TW`](#zh-tw-taiwan-mandarin) | zh | Taiwan Mandarin | `zh-CN` | 3 |
| [`zh-x-south`](#zh-x-south-southern-mandarin) | zh | Southern Mandarin | `zh-TW` | 1 |
| [`zh-x-en`](#zh-x-en-chinese-with-an-english-accent) | zh | Chinese with an English accent | `zh-CN` | 3 |
| [`zh-x-ru`](#zh-x-ru-chinese-with-a-russian-accent) | zh | Chinese with a Russian accent | `zh-CN` | 4 |
| [`zh-x-hi`](#zh-x-hi-chinese-with-a-hindi-accent) | zh | Chinese with a Hindi accent | `zh-CN` | 1 |

## Accents by code

### `en-US`: American

- Language `en`, base none, g2p switches: none.
- Phonotactics: none.
- Prosody: tunes `en`, range 1, rate 1, stress lengthening 1.
- Articulation offsets: none.

No rules: the pronunciation comes from the American dictionary and the English accent tables (`src/g2p/accents.js`).

### `en-GB`: British

- Language `en`, base none, g2p switches: none.
- Phonotactics: none.
- Prosody: tunes `en`, range 1, rate 1, stress lengthening 1.
- Articulation offsets: none.

No rules: the pronunciation comes from the American dictionary and the English accent tables (`src/g2p/accents.js`).

### `en-AU`: Australian

- Language `en`, base none, g2p switches: none.
- Phonotactics: none.
- Prosody: tunes `en`, range 1, rate 1, stress lengthening 1.
- Articulation offsets: none.

No rules: the pronunciation comes from the American dictionary and the English accent tables (`src/g2p/accents.js`).

### `en-IN`: Indian

- Language `en`, base none, g2p switches: none.
- Phonotactics: none.
- Prosody: tunes `en`, range 1, rate 1, stress lengthening 1.
- Articulation offsets: none.

No rules: the pronunciation comes from the American dictionary and the English accent tables (`src/g2p/accents.js`).

### `en-CA`: Canadian English

- Language `en`, base `en-US`, g2p switches: none.
- Phonotactics: none.
- Prosody: tunes `en`, range 1, rate 1, stress lengthening 1.
- Articulation offsets: none.

| # | Change | Where | From strength | Note |
| --- | --- | --- | --- | --- |
| 1 | ɔ → ɑ | everywhere | 0 |  |
| 2 | aɪ → ʌɪ, aʊ → ʌʊ | before `voiceless` | 0 |  |

### `en-x-ru`: English with a Russian accent

- Language `en`, base `en-US`, g2p switches: weakForms false.
- Phonotactics: codas any; at most 4 onset consonants; epenthesis `ə`; prothesis none.
- Prosody: tunes `ru`, range 1, rate 1, stress lengthening 1.
- Articulation offsets: none.

| # | Change | Where | From strength | Note |
| --- | --- | --- | --- | --- |
| 1 | θ → s, ð → z, ʃ → ʂ, ʒ → ʐ, h → x, t͡ʃ → t͡ɕ, d͡ʒ → d͡ʐ, ŋ → nɡ, l → ɫ, ɹ → r, w → v, ɾ → r, ɪ → i, eɪ → ɛj, ɑ → a, æ → ɛ, ɔ → o, oʊ → o, ʊ → u, ʌ → a, ɚ → ər, ɝ → ər, aɪ → aj, aʊ → au, ɔɪ → oj | everywhere | 0 |  |
| 2 | manner plosive, voiced false: add `˭` | before `V` | 0 |  |
| 3 | b → p, d → t, ɡ → k, v → f, z → s, ʒ → ʃ, d͡ʒ → t͡ʃ, ʐ → ʂ, d͡ʐ → t͡ɕ | before `#` | 0 |  |
| 4 | t → tʲ, d → dʲ, n → nʲ, l → lʲ, ɫ → lʲ, s → sʲ, z → zʲ | before `i` | 0.67 |  |

### `en-x-hi`: English with a Hindi accent

- Language `en`, base `en-IN`, g2p switches: weakForms false.
- Phonotactics: codas any; at most 2 onset consonants; epenthesis `ə`; prothesis `ɪ`.
- Prosody: tunes `hi`, range 1, rate 1, stress lengthening 0.5.
- Articulation offsets: none.

| # | Change | Where | From strength | Note |
| --- | --- | --- | --- | --- |
| 1 | t → ʈ, d → ɖ, v → ʋ, θ → t̪ʰ, ð → d̪, ʒ → z, h → x, ɹ → ɾ, w → ʋ, eɪ → eː, æ → ɛ, oʊ → oː, ʌ → ə, ɚ → əɾ, ɝ → əɾ | everywhere | 0 |  |

### `en-x-zh`: English with a Chinese accent

- Language `en`, base `en-US`, g2p switches: weakForms false.
- Phonotactics: codas n ŋ; at most 1 onset consonants; epenthesis `ə`; prothesis none.
- Prosody: tunes `zh`, range 1, rate 1, stress lengthening 0.5.
- Articulation offsets: none.

| # | Change | Where | From strength | Note |
| --- | --- | --- | --- | --- |
| 1 | p → pʰ, b → p˭, t → tʰ, d → t˭, k → kʰ, ɡ → k˭, v → w, θ → s, ð → l, z → s, ʃ → ʂ, ʒ → ʐ, h → x, t͡ʃ → ʈ͡ʂ, d͡ʒ → ʈ͡ʂ, ɹ → ɻ, ɾ → l, ɪ → i, æ → ɛ, ɔ → o, ʌ → ɑ, ɝ → ə, ɔɪ → oi | everywhere | 0 |  |

### `ru-RU`: Standard

- Language `ru`, base none, g2p switches: none.
- Phonotactics: none.
- Prosody: tunes `ru`, range 1, rate 1, stress lengthening 1.
- Articulation offsets: none.

No rules: the standard pronunciation.

### `ru-x-north`: Northern Russian (okanye)

- Language `ru`, base `ru-RU`, g2p switches: okanye true.
- Phonotactics: none.
- Prosody: tunes `ru`, range 1, rate 1, stress lengthening 1.
- Articulation offsets: none.

No rules: the standard pronunciation.

### `ru-x-south`: Southern Russian (fricative g)

- Language `ru`, base `ru-RU`, g2p switches: fricativeG true.
- Phonotactics: none.
- Prosody: tunes `ru`, range 1, rate 1, stress lengthening 1.
- Articulation offsets: none.

| # | Change | Where | From strength | Note |
| --- | --- | --- | --- | --- |
| 1 | ɡ → ɣ, ɡʲ → ɣʲ | everywhere | 0 |  |
| 2 | ɣ → x, ɣʲ → xʲ | before `#` | 0 |  |

### `ru-x-en`: Russian with an English accent

- Language `ru`, base `ru-RU`, g2p switches: none.
- Phonotactics: codas any; at most 3 onset consonants; epenthesis `ə`; prothesis none.
- Prosody: tunes `en`, range 1, rate 1, stress lengthening 1.
- Articulation offsets: none.

| # | Change | Where | From strength | Note |
| --- | --- | --- | --- | --- |
| 1 | pʲ → pj, bʲ → bj, tʲ → tj, dʲ → dj, kʲ → kj, ɡʲ → ɡj, fʲ → fj, vʲ → vj, ʂ → ʃ, ʐ → ʒ, sʲ → sj, zʲ → zj, x → h, xʲ → hj, mʲ → mj, nʲ → nj, ɫ → l, lʲ → lj, r → ɹ, rʲ → ɹj, t͡ɕ → t͡ʃ, t͡s → ts, d͡ʐ → d͡ʒ, ɕː → ʃ, a → ɑ, o → oʊ, ɨ → ɪ, e → ɛ, ɐ → ə | everywhere | 0 |  |
| 2 | manner plosive, voiced false: add `ʰ` | before `V`, stressed syllables | 0 |  |
| 3 | a → ə, o → ə, ɑ → ə, oʊ → ə | unstressed syllables | 0 |  |

### `ru-x-hi`: Russian with a Hindi accent

- Language `ru`, base `ru-RU`, g2p switches: none.
- Phonotactics: codas any; at most 2 onset consonants; epenthesis `ə`; prothesis `ɪ`.
- Prosody: tunes `hi`, range 1, rate 1, stress lengthening 0.5.
- Articulation offsets: none.

| # | Change | Where | From strength | Note |
| --- | --- | --- | --- | --- |
| 1 | pʲ → pj, bʲ → bj, t → t̪, tʲ → t̪j, d → d̪, dʲ → d̪j, kʲ → kj, ɡʲ → ɡj, fʲ → fj, v → ʋ, vʲ → ʋj, ʂ → ʃ, ʐ → z, sʲ → sj, zʲ → zj, x → kʰ, xʲ → kʰj, mʲ → mj, nʲ → nj, ɫ → l, lʲ → lj, rʲ → rj, t͡ɕ → t͡ʃ, t͡s → t͡ʃ, d͡ʐ → d͡ʒ, ɕː → ʃː, ɨ → i, ɐ → ə | everywhere | 0 |  |

### `ru-x-zh`: Russian with a Chinese accent

- Language `ru`, base `ru-RU`, g2p switches: none.
- Phonotactics: codas n ŋ; at most 1 onset consonants; epenthesis `ə`; prothesis none.
- Prosody: tunes `zh`, range 1, rate 1, stress lengthening 0.5.
- Articulation offsets: none.

| # | Change | Where | From strength | Note |
| --- | --- | --- | --- | --- |
| 1 | p → pʰ, pʲ → pʰ, b → p˭, bʲ → p˭, t → tʰ, tʲ → tʰ, d → t˭, dʲ → t˭, k → kʰ, kʲ → kʰ, ɡ → k˭, ɡʲ → k˭, fʲ → f, v → w, vʲ → w, sʲ → s, z → s, zʲ → s, xʲ → x, mʲ → m, nʲ → n, ɫ → l, lʲ → l, r → l, rʲ → l, d͡ʐ → ʐ, ɨ → i, e → ɛ, ɪ → i, ɐ → ə | everywhere | 0 |  |

### `hi-IN`: Standard

- Language `hi`, base none, g2p switches: none.
- Phonotactics: none.
- Prosody: tunes `hi`, range 1, rate 1, stress lengthening 1.
- Articulation offsets: none.

No rules: the standard pronunciation.

### `hi-x-east`: Eastern Hindi

- Language `hi`, base `hi-IN`, g2p switches: none.
- Phonotactics: none.
- Prosody: tunes `hi`, range 1, rate 1, stress lengthening 1.
- Articulation offsets: none.

| # | Change | Where | From strength | Note |
| --- | --- | --- | --- | --- |
| 1 | z → d͡ʒ, f → pʰ, ʃ → s, ɛː → əɪ, ɔː → əʊ | everywhere | 0 |  |
| 2 | ʋ → b | after `#` | 0.67 |  |

### `hi-x-en`: Hindi with an English accent

- Language `hi`, base `hi-IN`, g2p switches: none.
- Phonotactics: codas any; at most 3 onset consonants; epenthesis `ə`; prothesis none.
- Prosody: tunes `en`, range 1, rate 1, stress lengthening 1.
- Articulation offsets: none.

| # | Change | Where | From strength | Note |
| --- | --- | --- | --- | --- |
| 1 | kʰ → k, ɡʱ → ɡ, t͡ʃʰ → t͡ʃ, d͡ʒʱ → d͡ʒ, ɲ → nj, ʈ → t, ʈʰ → t, ɖ → d, ɖʱ → d, ɳ → n, t̪ → t, t̪ʰ → t, d̪ → d, d̪ʱ → d, pʰ → p, bʱ → b, ɾ → ɹ, r → ɹ, ʋ → w, ɦ → h, q → k, x → h, ɣ → ɡ, ɽ → ɹ, ɽʱ → ɹ, aː → ɑː, eː → eɪ, oː → oʊ, ə̃ → ə, ãː → ɑː, ĩː → iː, ũː → uː, ẽː → eɪ, ɛ̃ː → ɛː, õː → oʊ, ɔ̃ː → ɔː, ɪ̃ → ɪ, ʊ̃ → ʊ | everywhere | 0 |  |
| 2 | manner plosive, voiced false: add `ʰ` | before `V`, stressed syllables | 0 |  |
| 3 | a → ə, o → ə, ɑ → ə, oʊ → ə | unstressed syllables | 0 |  |

### `hi-x-ru`: Hindi with a Russian accent

- Language `hi`, base `hi-IN`, g2p switches: none.
- Phonotactics: codas any; at most 4 onset consonants; epenthesis `ə`; prothesis none.
- Prosody: tunes `ru`, range 1, rate 1, stress lengthening 1.
- Articulation offsets: none.

| # | Change | Where | From strength | Note |
| --- | --- | --- | --- | --- |
| 1 | kʰ → k, ɡʱ → ɡ, ŋ → n, t͡ʃ → t͡ɕ, t͡ʃʰ → t͡ɕ, d͡ʒ → d͡ʐ, d͡ʒʱ → d͡ʐ, ɲ → n, ʈ → t, ʈʰ → t, ɖ → d, ɖʱ → d, ɳ → n, t̪ → t, t̪ʰ → t, d̪ → d, d̪ʱ → d, pʰ → p, bʱ → b, ɾ → r, l → ɫ, ʋ → v, ʃ → ʂ, ɦ → x, q → k, ɣ → ɡ, ɽ → r, ɽʱ → r, ɪ → i, ʊ → u, ɔː → oː, ɔ → o, ə̃ → ə, ãː → aː, ĩː → iː, ũː → uː, ẽː → eː, ɛ̃ː → ɛː, õː → oː, ɔ̃ː → oː, ɪ̃ → i, ʊ̃ → u | everywhere | 0 |  |
| 2 | manner plosive, voiced false: add `˭` | before `V` | 0 |  |
| 3 | b → p, d → t, ɡ → k, v → f, z → s, ʒ → ʃ, d͡ʒ → t͡ʃ, ʐ → ʂ, d͡ʐ → t͡ɕ | before `#` | 0 |  |
| 4 | t → tʲ, d → dʲ, n → nʲ, l → lʲ, ɫ → lʲ, s → sʲ, z → zʲ | before `i` | 0.67 |  |

### `hi-x-zh`: Hindi with a Chinese accent

- Language `hi`, base `hi-IN`, g2p switches: none.
- Phonotactics: codas n ŋ; at most 1 onset consonants; epenthesis `ə`; prothesis none.
- Prosody: tunes `zh`, range 1, rate 1, stress lengthening 0.5.
- Articulation offsets: none.

| # | Change | Where | From strength | Note |
| --- | --- | --- | --- | --- |
| 1 | ɡ → k˭, ɡʱ → k˭, t͡ʃ → ʈ͡ʂ, t͡ʃʰ → ʈ͡ʂʰ, d͡ʒ → ʈ͡ʂ, d͡ʒʱ → ʈ͡ʂ, ɲ → ŋ, ʈ → t, ʈʰ → tʰ, ɖ → t˭, ɖʱ → t˭, ɳ → n, t̪ → t, t̪ʰ → tʰ, d̪ → t˭, d̪ʱ → t˭, b → p˭, bʱ → p˭, ɾ → l, r → l, ʋ → w, ʃ → ʂ, ɦ → x, q → k, ɣ → x, z → s, ɽ → l, ɽʱ → ɻ, ɪ → i, eː → ɛː, ɔː → oː, ɔ → o, ə̃ → ə, ãː → aː, ĩː → iː, ũː → uː, ẽː → ɛː, ɛ̃ː → ɛː, õː → oː, ɔ̃ː → oː, ɪ̃ → i, ʊ̃ → ʊ | everywhere | 0 |  |

### `zh-CN`: Standard (Putonghua)

- Language `zh`, base none, g2p switches: none.
- Phonotactics: none.
- Prosody: tunes `zh`, range 1, rate 1, stress lengthening 1.
- Articulation offsets: none.

No rules: the standard pronunciation.

### `zh-TW`: Taiwan Mandarin

- Language `zh`, base `zh-CN`, g2p switches: erhua false, lowThird true.
- Phonotactics: none.
- Prosody: tunes `zh`, range 1, rate 1, stress lengthening 1.
- Articulation offsets: none.

| # | Change | Where | From strength | Note |
| --- | --- | --- | --- | --- |
| 1 | ʂ → s, ʈ͡ʂ → t͡s, ʈ͡ʂʰ → t͡sʰ | everywhere | 0 |  |
| 2 | ɻ̩ → ɹ̩ | everywhere | 0 |  |
| 3 | iŋ → in | everywhere | 0.67 |  |

### `zh-x-south`: Southern Mandarin

- Language `zh`, base `zh-TW`, g2p switches: none.
- Phonotactics: none.
- Prosody: tunes `zh`, range 1, rate 1, stress lengthening 1.
- Articulation offsets: none.

| # | Change | Where | From strength | Note |
| --- | --- | --- | --- | --- |
| 1 | n → l | after `#` | 0.67 |  |

### `zh-x-en`: Chinese with an English accent

- Language `zh`, base `zh-CN`, g2p switches: none.
- Phonotactics: codas any; at most 3 onset consonants; epenthesis `ə`; prothesis none.
- Prosody: tunes `en`, range 1, rate 1, stress lengthening 1.
- Articulation offsets: none.

| # | Change | Where | From strength | Note |
| --- | --- | --- | --- | --- |
| 1 | pʰ → p, tʰ → t, kʰ → k, x → h, ʂ → ʃ, ɕ → ʃ, ʐ → ʒ, ʈ͡ʂ → t͡ʃ, ʈ͡ʂʰ → t͡ʃ, t͡ɕ → t͡ʃ, t͡ɕʰ → t͡ʃ, t͡s → ts, t͡sʰ → ts, ɥ → j, ɻ → ɹ, y → u, a → ɑ, o → oʊ, ɤ → ʌ, ɹ̩ → ə, ɻ̩ → ɚ | everywhere | 0 |  |
| 2 | manner plosive, voiced false: add `ʰ` | before `V`, stressed syllables | 0 |  |
| 3 | a → ə, o → ə, ɑ → ə, oʊ → ə | unstressed syllables | 0 |  |

### `zh-x-ru`: Chinese with a Russian accent

- Language `zh`, base `zh-CN`, g2p switches: none.
- Phonotactics: codas any; at most 4 onset consonants; epenthesis `ə`; prothesis none.
- Prosody: tunes `ru`, range 1, rate 1, stress lengthening 1.
- Articulation offsets: none.

| # | Change | Where | From strength | Note |
| --- | --- | --- | --- | --- |
| 1 | pʰ → p, tʰ → t, kʰ → k, l → ɫ, ʈ͡ʂ → t͡ɕ, ʈ͡ʂʰ → t͡ɕ, t͡ɕʰ → t͡ɕ, t͡sʰ → t͡s, w → v, ɥ → j, ŋ → n, ɻ → ʐ, y → ju, ɤ → o, ɑ → a, ʊ → u, ɚ → ər, aɪ → aj, eɪ → ɛj, oʊ → o, ɹ̩ → ɨ, ɻ̩ → ɨ | everywhere | 0 |  |
| 2 | manner plosive, voiced false: add `˭` | before `V` | 0 |  |
| 3 | b → p, d → t, ɡ → k, v → f, z → s, ʒ → ʃ, d͡ʒ → t͡ʃ, ʐ → ʂ, d͡ʐ → t͡ɕ | before `#` | 0 |  |
| 4 | t → tʲ, d → dʲ, n → nʲ, l → lʲ, ɫ → lʲ, s → sʲ, z → zʲ | before `i` | 0.67 |  |

### `zh-x-hi`: Chinese with a Hindi accent

- Language `zh`, base `zh-CN`, g2p switches: none.
- Phonotactics: codas any; at most 2 onset consonants; epenthesis `ə`; prothesis `ɪ`.
- Prosody: tunes `hi`, range 1, rate 1, stress lengthening 0.5.
- Articulation offsets: none.

| # | Change | Where | From strength | Note |
| --- | --- | --- | --- | --- |
| 1 | t → t̪, tʰ → t̪ʰ, x → kʰ, ʂ → ʃ, ɕ → ʃ, ʐ → z, ʈ͡ʂ → t͡ʃ, ʈ͡ʂʰ → t͡ʃʰ, t͡ɕ → t͡ʃ, t͡ɕʰ → t͡ʃʰ, t͡s → t͡ʃ, t͡sʰ → t͡ʃʰ, w → ʋ, ɥ → j, ɻ → ɾ, y → i, ɤ → o, ɑ → a, ɚ → ə, ɹ̩ → ɪ, ɻ̩ → ɪ | everywhere | 0 |  |

## Measured effects

Tier `medium`, seed 1 (`node experiments/issue-57-acoustics.mjs`; the
measures are in `tests/helpers/accent-measures.js` and checked by
`tests/accents.test.js`):

| Check | Plain | Accent |
| --- | --- | --- |
| `город` `ru-x-south`: quietest 10 ms of the first consonant below the vowel | 79.5 dB (`ˈɡorət`) | 7.7 dB (`ˈɣorət`) |
| `pit` `en-x-ru`: burst to voicing | 60.0 ms (`ˈpɪt`) | 12.5 ms (`ˈp˭it`) |
| `bad` `en-x-ru`: voiced share of the last consonant | 0.14 (`ˈbæd`) | 0.00 (`ˈbɛt`) |
| `是` and `四` `zh-TW`: centroid difference of the initials | 29.1 % (`ʂɻ̩˥˩` 5426 Hz, `sɹ̩˥˩` 7654 Hz) | 0.0 % (`sɹ̩˥˩` both) |
| `The tiger is the biggest animal of the family.` `en-x-zh`: vowel nPVI | 48.1 | 20.9 |

The retroflex place lies behind the postalveolar one (`PLACES` in
`src/articulation/phones.js`), which puts the noise of ʂ below that of s:
5946 against 7973 Hz in `ˈaʂa` and `ˈasa`
(`node experiments/issue-57-sibilants.mjs`; 8080 Hz before this issue).
The synthesizer devoices most of a final closure, so even a plain final d has a
voiced share of 0.14.
