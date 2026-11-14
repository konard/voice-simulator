---
id: P45
title: Accents beyond English and foreign accents
type: Feature
milestone: M3
blocked_by: []
requirements: [R17, R5, R7]
---

## Goal

Add regional accents for Russian, Hindi and Mandarin and foreign accents
between the four languages (for example English with a Russian accent). An
accent is data: phone maps, feature changes, sound-pattern repairs, prosody
and articulation settings, loadable from a JSON file, with a strength 0…1.

## Why

Accent is the mode of speech people notice first. Recognition needs it too:
a rule set that turns the dictionary form into the accented form tells which
heard phones are an accent and which are a different word.

## Current state

Only English has accents, as code, and they change phones only. The header
of `src/g2p/accents.js` says: "English accents. The dictionary is General
American; other accents are derived word by word with lexical-set rules
(Wells)" and "Russian, Hindi and Mandarin have a single accent each."
`ACCENTS` has one key, `en` (`en-US`, `en-GB`, `en-AU`, `en-IN`). Measured
with `node experiments/issue-11-audit-m3b.mjs`:

```
ru ru-south город молоко: "ˈɡorət mɐˈɫokə", accent null
zh zh-TW 是不是: "ʂɻ̩˥˩ pu˧˥ ʂɻ̩˥˩", accent null
en ru think of the water: "ˈθɪŋk ˈʌv ðə ˈwɔɾɚ", accent "en-US"
```

`resolveAccent()` returns `null` for other languages and the default for an
unknown code, without a message. No accent changes prosody or the head. The
head parameter `accentStrength` means the pitch rise on stressed syllables,
so that name is taken. English aspiration is not written in IPA
(`isAspirated()` in `src/articulation/plan.js` adds it for `en`), and
`parseIpa()` does not know the unaspirated mark `˭`.

## What to do

1. Format. Create `src/accent/` with `index.js`, `apply.js` and one `.js`
   module per definition in `src/accent/definitions/` (JSON imports do not
   work on every runtime). The same object as JSON is an accent file:

   <!-- prettier-ignore -->
   ```json
   { "format": "voice-simulator/accent", "version": 1,
     "code": "en-x-ru", "name": "English with a Russian accent",
     "language": "en", "base": "en-US", "g2p": {},
     "rules": [
       { "map": { "θ": "s", "ð": "z" } },
       { "map": { "b": "p", "d": "t" }, "before": "#", "min": 0.5 },
       { "match": { "manner": "plosive", "voiced": false },
         "before": "V", "add": "˭" } ],
     "phonotactics": { "codas": "any", "maxOnset": 4,
                       "epenthesis": "ə", "prothesis": null },
     "prosody": { "tunes": "ru", "range": 1, "rate": 1,
                  "stressLengthening": 1 },
     "articulation": {} }
   ```

   - A rule works on the units of one word (`ipaUnits()` of
     `src/g2p/spelling.js`), in the listed order, once, left to right.
     `map` replaces units; `match` selects units by the fields of
     `getPhoneme()` (`kind`, `place`, `manner`, `voiced`, `height`,
     `backness`, `rounded`) and `add` or `remove` is a diacritic.
   - `before`, `after`: a unit or a class: `#` word edge, `V` vowel, `C`
     consonant, `voiceless` (voiceless obstruent), `front` (`i e ɛ j`).
     `stress`: `stressed` or `unstressed`. `min` (default 0): the rule runs
     when `strength >= min`.
   - `phonotactics`: a word-final consonant not in `codas` gets the
     `epenthesis` vowel after it; a word-initial cluster longer than
     `maxOnset` (`j`, `w` not counted) gets it between the consonants;
     `prothesis` goes before word-initial `s` + plosive, in front of the
     stress mark.
   - `base` is the accent applied first; `g2p` holds switches for the
     language's own rules (step 3).
   - `prosody`: `tunes` is the language whose tunes are used (`TUNES` of
     {{P39}} when merged, the language switch of
     `src/articulation/prosody.js` until then); `range`, `rate`,
     `stressLengthening` are factors on `head.pitchRange`,
     `head.speechRate`, `head.stressLengthening`.
   - `articulation`: offsets on head parameters by their key in
     `src/head-config.js`, clamped to the parameter's range. No built-in
     accent sets it (the research gives no measured base of articulation).
     With `strength`, an offset `o` becomes `o * strength` and a prosody
     factor `f` becomes `1 + (f - 1) * strength`.

2. `src/accent/index.js` exports `getAccent(code)`,
   `applyAccent(wordIpa, definition, strength)`, `explainAccent()` (step 6)
   and `loadAccent(json)`, which checks `format`, `version`, at most 500
   rules and that `parseIpa()` knows every unit, and throws `TypeError`
   naming the bad field. Extend `ACCENTS` with `ru`, `hi`, `zh` (defaults
   `ru-RU`, `hi-IN`, `zh-CN` first); each entry gets
   `kind: 'standard' | 'regional' | 'foreign'`. The four English accents
   stay in `src/g2p/accents.js` (they need the spelling). Add `˭` (U+02ED)
   to `DIACRITICS` in `src/ipa/inventory.js` as `unaspirated`;
   `isAspirated()` returns `false` for such a token.

3. Regional accents. Project choices, simplified from common descriptions
   (the research file has no source). Today's output → the output wanted.

   | Code         | Rules                                                                                                              | Example                                       |
   | ------------ | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
   | `ru-x-north` | okanye: unstressed `о` after a hard consonant stays `o` (`g2p.okanye`, in `reduceVowel()` of `src/g2p/russian.js`) | `хорошо` `xərɐˈʂo` → `xoroˈʂo`                |
   | `ru-x-south` | `г` is `ɣ`, devoiced to `x` (`g2p.fricativeG`, before `assimilateVoicing()`)                                       | `город` → `ˈɣorət`, `снег` `snʲek` → `snʲex`  |
   | `hi-x-east`  | `z → d͡ʒ`, `f → pʰ`, `ʃ → s`, `ɛː → əɪ`, `ɔː → əʊ`; word-initial `ʋ → b` (`min` 0.67)                               | `ज़रा फ़ोन शहर` → `d͡ʒəɾaː pʰoːn səɦəɾ`        |
   | `zh-TW`      | `ʂ ʈ͡ʂ ʈ͡ʂʰ → s t͡s t͡sʰ`, then `ɻ̩ → ɹ̩`; `iŋ → in` (`min` 0.67); no erhua (`g2p.erhua: false`)                         | `是` `ʂɻ̩˥˩` → `sɹ̩˥˩`, `一点儿` → `i˥˩ tjɛn˨˩` |
   | `zh-x-south` | as `zh-TW`, and initial `n → l` (`min` 0.67)                                                                       | `南` `nan˧˥` → `lan˧˥`                        |
   | `en-CA`      | base `en-US`; `ɔ → ɑ`; `aɪ → ʌɪ`, `aʊ → ʌʊ` before `voiceless`                                                     | `price about` → `ˈpɹʌɪs əˈbʌʊt`               |

   Reduction and devoicing lose the letter, so the `g2p` flags are options
   of `russianWordToIpa()` and `chineseWordToIpa()`. `erhua: false` drops a
   word-final `儿` in words of two or more characters (the suffix test of
   {{P31}} when merged), but not in `女儿`, `婴儿`, `幼儿`, `孤儿`.

4. Foreign accents are built, not written by hand. Add one profile per
   first language in `src/accent/profiles/` and
   `foreignAccent(target, first)`, which returns a definition with the code
   `<target>-x-<first>` (12 codes). It holds, in this order: the
   `substitutions` of the profile; for every other unit of the target
   language that is not in the profile's `inventory`, the nearest unit of
   it (same `kind`, fewest different fields among `place`, `manner`,
   `voiced` or `height`, `backness`, `rounded`; the first in the list wins
   a tie); the `processes`, `phonotactics` and `prosody`. `inventory` is a
   literal list: the units in the tables of the language's G2P module
   (`russian.js`, `hindi.js`, `pinyin.js`; for `en` the dictionary's units).

   | First language | `substitutions`                                                                                                                 | `processes`                                                                                                                           | `phonotactics`                 | `prosody`                             |
   | -------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------- |
   | `ru`           | `θ ð → s z`, `w → v`, `ɹ → r`, `ɚ ɝ → ər`, `h → x`, `ŋ → nɡ`, `æ → ɛ`, `ɪ → i`, `ʊ → u`, `ʌ ɑ → a`, `ɔ oʊ → o`, `eɪ aɪ → ɛj aj` | `˭` on voiceless plosives before `V`; `b d ɡ v z ʒ d͡ʒ → p t k f s ʃ t͡ʃ` before `#`; palatalised `t d n l s z` before `i` (`min` 0.67) | any coda, `maxOnset` 4         | `tunes: ru`                           |
   | `hi`           | for English the map `INDIAN_UNITS` (base `en-IN`); `x → kʰ`, `ɨ → i`, `Cʲ → Cj`                                                 | none                                                                                                                                  | `prothesis: ɪ`, `maxOnset` 2   | `tunes: hi`, `stressLengthening: 0.5` |
   | `zh`           | `θ → s`, `ð → l`, `v → w`, `r → l`; voiced plosives `b d ɡ → p˭ t˭ k˭`, voiceless ones get `ʰ`                                  | none                                                                                                                                  | codas `n ŋ`, `maxOnset` 1, `ə` | `tunes: zh`, `stressLengthening: 0.5` |
   | `en`           | `r → ɹ`, `x → h`, `ɨ → ɪ`, `y → u`, `Cʲ → Cj`, dental and retroflex stops → alveolar, `ʂ ɕ → ʃ`, `Cʱ → C`                       | `ʰ` on voiceless plosives before a stressed `V`; unstressed `a o → ə`                                                                 | any coda, `maxOnset` 3         | `tunes: en`                           |

   `stressLengthening: 0.5` is a start value: the research proposes a
   vocalic nPVI above about 55 for English, below about 45 for Mandarin and Hindi.

5. Wire it in `src/g2p/index.js`: call `applyAccent()` after the word is
   pronounced (and after `adaptEnglishWord()` for a base English accent).
   The results of `textToIpa()`, `prepareUtterance()` and `synthesize()`
   keep `accent` as the code and gain `accentLevel` (the strength used).
   `planUtterance()` gets `prosody` and `articulation` in `options.accent`.
   The option `accent` accepts a code, `{ code, strength }` or a
   definition object. CLI: `--accent <code|file.json>` and
   `--accent-level <0..1>`. Server: field `accent` (a code or an object,
   never a path). A code of the text's language that does not exist throws
   `RangeError`; a code of another language is ignored as today. A voice
   file of {{P29}} may carry `"accent"`; the option wins over the file, and
   the `articulation` offsets are added to the head of the voice.

6. Both directions. An accent has no mark in IPA: the phones show it and
   the result names it. For recognition,
   `explainAccent(expectedIpa, heardIpa, lang)` applies every accent of
   `lang` to `expectedIpa` and returns `[{ code, explained, total }]`, best
   first: `total` counts the units that differ between the two strings,
   `explained` those the accent produces. The acoustic tests below give the
   correlates recognition can measure.

## Tests

Extend `tests/accents.test.js`. Change `has no accents for the other
languages` and `leaves the other languages alone`: the accent is now
`ru-RU`. `say(text, lang, accent)` is `textToIpa(text, { lang, accent }).ipa`.

- `keeps o in northern Russian`: `хорошо говорит` → `xoroˈʂo ɡovoˈrʲit`.
- `has a fricative g in southern Russian`: `город снег друг его` →
  `ˈɣorət snʲex drux jɪˈvo`.
- `follows the table of regional accents`: other rows of step 3; `女儿` keeps `ɚ`.
- `speaks English with a Russian accent`:
  `say('the thing with strong street wives and bad bed', 'en', { code: 'en-x-ru', strength: 0.5 })`
  → `zə ˈsink ˈvis ˈstronk ˈstrit ˈvajvs ənt ˈbɛt ˈbɛt`; `pit` → `ˈp˭it`.
- `scales with strength`: 0 gives the plain output; 1 gives `ˈsʲink`.
- `repairs clusters`: `school` with `en-x-hi` → `ɪˈskul`; with `en-x-zh`
  `bed` ends in `ə` and `street` does not start with two consonants.
- `builds all twelve foreign accents`: every `foreignAccent()` result passes
  `loadAccent()`, and its output has an empty `unknown` in `parseIpa()`.
- `loads an accent file`; `rejects a bad file` (wrong `format`, unknown
  unit, 501 rules); `rejects an unknown code` (`ru-south`: `RangeError`).
- `explains an accent`: for `ˈɡorət` and `ˈɣorət`, `explainAccent()` puts
  `ru-x-south` first with `explained` 1 of `total` 1.
- Acoustic (tier `medium`, `seed: 1`): (a) `город` with `ru-x-south`: the
  lowest 10 ms level in the first consonant is less than 10 dB below the
  vowel (plain: more than 20 dB); (b) `pit` with `en-x-ru`: the time from
  burst to voicing is at most half the plain one; (c) `bad` with `en-x-ru`:
  `voicedShare` of the last consonant below 0.2; (d) `是` and `四` with
  `zh-TW`: centre of gravity of the two initials within 10 % (plain: more
  than 20 % apart); (e) nPVI of the vowel durations in `plan.segments` of
  the sentence above is at least 10 lower with `en-x-zh` than plain.

## Acceptance criteria

- [ ] `ACCENTS` lists at least 2 accents for `ru`, `hi` and `zh`, 5 base
      accents for `en`, and the 12 foreign codes.
- [ ] All tests above pass on Node.js, Bun and Deno.
- [ ] The IPA output without an `accent` option is the same as before for
      all sentences of `tests/accents.test.js` and `tests/text-to-ipa.test.js`.
- [ ] `voice-simulator ipa --lang en --accent en-x-ru "thing"` prints an IPA
      string that differs from the one without the flag.
- [ ] `docs/accents.md` lists every code with its rules and the file format.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- Other English accents that need lexical sets (Scottish, Irish, …).
- Russian yakanye and other patterns that need correct stress: {{P36}}.
- Recognising a speaker's accent as a task of its own ({{P57}}).
- The Rust version: {{P70}}.

## References

- Wells, J. C. (1982). Accents of English. Cambridge University Press.
- Research notes (accent strength, rhythm metrics):
  `docs/case-studies/issue-11/research/4-linguistics-and-speech-modes.md`.
