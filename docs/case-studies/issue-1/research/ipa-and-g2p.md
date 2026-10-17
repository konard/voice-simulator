# Text to IPA (G2P) for English, Russian, Hindi and Chinese

Research notes for issue #1. The simulator needs to turn text into IPA in
four languages, and then turn IPA segments into articulatory targets. Every
factual claim links to its source. Registry data (versions, licenses, weekly
downloads) was retrieved on 2026-10-16.

## IPA as the interface

- The official IPA chart is published by the International Phonetic
  Association under CC BY-SA 4.0. Its latest content revision is 2015
  ([IPA chart page](https://www.internationalphoneticassociation.org/content/ipa-chart)).
  If we embed chart images or derived text, CC BY-SA attribution and
  share-alike apply. Using IPA symbols themselves does not.
- PanPhon (MIT) maps IPA segments to 22 articulatory features:
  `syl son cons cont delrel lat nas strid voi sg cg ant cor distr lab hi lo
back round velaric tense long`. The data lives in `ipa_bases.csv`, with
  diacritic rules in `diacritic_definitions.yml` that generate `ipa_all.csv`
  ([dmort27/panphon](https://github.com/dmort27/panphon)).
  This feature table is a good intermediate layer between IPA strings and
  vocal tract targets: `nas` drives the velum, `voi` drives glottal
  adduction, `sg` drives aspiration, `hi`/`lo`/`back` drive the tongue body,
  `round` drives lip protrusion and `cor`/`ant`/`distr` drive the tongue tip.

### Proposed IPA to articulatory target mapping (design, not sourced)

These ideas are ours, built on the Pink Trombone and Story models described in
`articulatory-synthesis.md`:

- Vowels: give each vowel a (tongueIndex, tongueDiameter, lip opening)
  triple, or better, a full 44-section area function taken from the Story
  2008 MRI table in `web-performance-and-delivery.md`. Interpolate between
  segments with a critically damped second-order (or fifth-order, as in
  VocalTractLab) target follower.
- Consonants: model them as multiplicative constriction functions on top of
  the vowel substrate, following Story's `A = V * prod C_k` model. Each one
  is a (location index, minimum area, width) triple plus a velum state and a
  glottal state.
- Tones and intonation: drive glottal F0 targets from the tone letters below.

## Tool landscape

| Tool                               | Languages relevant here                                                                 | License                                                                                                | Runs in browser?                                  | Source                                                                                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| eSpeak NG                          | `en`, `en-us`, `ru`, `hi`, `cmn` (127 languages and accents in the development version) | GPL-3.0                                                                                                | Via WASM ports                                    | [languages.md](https://github.com/espeak-ng/espeak-ng/blob/master/docs/languages.md), [GitHub](https://github.com/espeak-ng/espeak-ng)             |
| `espeak-ng` (npm, ianmarmour)      | Same as eSpeak NG                                                                       | GPL-3.0-or-later                                                                                       | Yes (JS + WASM)                                   | [npm registry](https://registry.npmjs.org/espeak-ng/latest)                                                                                        |
| `phonemizer` (npm, xenova)         | eSpeak NG voices                                                                        | Declared Apache-2.0, but it wraps eSpeak NG (GPL-3.0), so licensing needs review                       | Yes. A single 1.3 MB bundle with an eSpeak worker | [GitHub](https://github.com/xenova/phonemizer.js), [jsDelivr file list](https://data.jsdelivr.com/v1/packages/npm/phonemizer@1.2.1?structure=flat) |
| phonemizer (Python, bootphon)      | espeak backend "100+" languages; festival backend is American English only              | GPL-3.0                                                                                                | No                                                | [bootphon/phonemizer](https://github.com/bootphon/phonemizer)                                                                                      |
| Epitran                            | `hin-Deva`, `rus-Cyrl`, `cmn-Hans`, `cmn-Hant`, `eng-Latn`                              | MIT                                                                                                    | No (Python)                                       | [dmort27/epitran](https://github.com/dmort27/epitran)                                                                                              |
| CharsiuG2P                         | 100 languages (ByT5 transformer)                                                        | MIT                                                                                                    | Possible via ONNX export (not verified)           | [lingjzhu/CharsiuG2P](https://github.com/lingjzhu/CharsiuG2P)                                                                                      |
| gruut                              | Includes Russian. No Hindi or Chinese.                                                  | MIT. Archived on 2025-10-06.                                                                           | No                                                | [rhasspy/gruut](https://github.com/rhasspy/gruut)                                                                                                  |
| `@piper-plus/g2p`                  | Multilingual, "eSpeak-ng free"                                                          | MIT                                                                                                    | Yes (claims WASM)                                 | [npm registry](https://registry.npmjs.org/@piper-plus/g2p/latest), [README](https://cdn.jsdelivr.net/npm/@piper-plus/g2p@0.4.1/README.md)          |
| CMUdict                            | English, ARPAbet                                                                        | Permissive: "Use of this dictionary for any research or commercial purpose is completely unrestricted" | Yes, as data                                      | [cmusphinx/cmudict](https://github.com/cmusphinx/cmudict)                                                                                          |
| `cmu-pronouncing-dictionary` (npm) | English, "134,000+ words"                                                               | ISC                                                                                                    | Yes                                               | [npm registry](https://registry.npmjs.org/cmu-pronouncing-dictionary/latest)                                                                       |
| `pinyin-pro` (npm)                 | Hanzi to pinyin, with tones and polyphone handling                                      | MIT                                                                                                    | Yes                                               | [npm registry](https://registry.npmjs.org/pinyin-pro/latest), [zh-lx/pinyin-pro](https://github.com/zh-lx/pinyin-pro)                              |
| `pinyin` (npm, hotoo)              | Hanzi to pinyin                                                                         | MIT                                                                                                    | Yes                                               | [npm registry](https://registry.npmjs.org/pinyin/latest)                                                                                           |
| CC-CEDICT                          | Chinese to English dictionary with pinyin, 123,524 entries (2025-07-16)                 | CC BY-SA 3.0                                                                                           | Yes, as data                                      | [Wikipedia: CEDICT](https://en.wikipedia.org/wiki/CEDICT)                                                                                          |
| Unicode data files                 | Code point properties, including Unihan readings                                        | Unicode License V3, which permits redistribution with notice                                           | Yes, as data                                      | [unicode.org/license.txt](https://www.unicode.org/license.txt), [UAX #38](https://www.unicode.org/reports/tr38/)                                   |
| Silero Stress                      | Russian stress and homographs                                                           | MIT                                                                                                    | Not verified                                      | [snakers4/silero-stress](https://github.com/snakers4/silero-stress)                                                                                |

Weekly npm downloads for 2026-10-06 to 2026-10-12: `phonemizer` 379,956,
`pinyin-pro` 349,229 and `cmu-pronouncing-dictionary` 69,986
([npm downloads API](https://api.npmjs.org/downloads/point/last-week/pinyin-pro,phonemizer,three,cmu-pronouncing-dictionary)).

Additional details:

- Epitran's English mode requires CMU Flite (`lex_lookup`), and its Chinese
  mode requires a CC-CEDICT file passed as `cedict_file`. The CC-CEDICT
  dictionary "cannot be distributed with Epitran"
  ([epitran README](https://github.com/dmort27/epitran)).
- Epitran handles schwa deletion only through generic post-processor rules,
  for example `ə -> 0 / (::vowel::)(::consonant::) _ (::consonant::)(::vowel::)`
  ([epitran README](https://github.com/dmort27/epitran)).
- CharsiuG2P multilingual checkpoints and their reported averages:
  `tiny_8_layers` PER 0.107 and WER 0.314; `tiny_12_layers` 0.098 and
  0.287; `tiny_16_layers` 0.096 and 0.281; `small` 0.089 and 0.261. All are
  on the Hugging Face `charsiu` account
  ([CharsiuG2P README](https://github.com/lingjzhu/CharsiuG2P)).
- License implication (our reading): any GPL component (eSpeak NG, VocalTractLab,
  bootphon phonemizer) bundled into the JS library would make the library
  GPL. An MIT-friendly stack is CMUdict plus rules for English, pinyin-pro
  plus a pinyin-to-IPA table for Chinese, and hand-written rules for Russian
  and Hindi. eSpeak NG can be offered as an optional plug-in.

## English

### ARPAbet (CMUdict) to IPA

Mapping from [Wikipedia: ARPABET](https://en.wikipedia.org/wiki/ARPABET).

| ARPAbet | IPA | ARPAbet | IPA  |
| ------- | --- | ------- | ---- |
| AA      | ɑ   | B       | b    |
| AE      | æ   | CH      | tʃ   |
| AH      | ʌ   | D       | d    |
| AO      | ɔ   | DH      | ð    |
| AW      | aʊ  | F       | f    |
| AY      | aɪ  | G       | ɡ    |
| EH      | ɛ   | HH      | h    |
| ER      | ɝ   | JH      | dʒ   |
| EY      | eɪ  | K       | k    |
| IH      | ɪ   | L       | l    |
| IY      | i   | M       | m    |
| OW      | oʊ  | N       | n    |
| OY      | ɔɪ  | NG      | ŋ    |
| UH      | ʊ   | P       | p    |
| UW      | u   | R       | ɹ    |
|         |     | S, SH   | s, ʃ |
|         |     | T, TH   | t, θ |
|         |     | V, W    | v, w |
|         |     | Y, Z    | j, z |
|         |     | ZH      | ʒ    |

- Stress digits follow vowels: 0 means no stress, 1 primary and 2 secondary
  ([Wikipedia: ARPABET](https://en.wikipedia.org/wiki/ARPABET)).
- Our note: `AH0` (unstressed) is conventionally rendered as [ə], which is
  what eSpeak-style output expects. Out-of-vocabulary words need a fallback,
  either letter-to-sound rules or a small neural G2P such as a CharsiuG2P tiny
  model.

## Russian

All points below are from
[Wikipedia: Russian phonology](https://en.wikipedia.org/wiki/Russian_phonology).

- Stress: "Stress in Russian is phonemic and therefore unpredictable". It
  "may fall on any syllable", and "Stress shifts can even occur within an
  inflexional paradigm". G2P therefore needs a stress dictionary or a model,
  for example Silero Stress
  ([snakers4/silero-stress](https://github.com/snakers4/silero-stress)).
  The letter ё is "almost always stressed", but it is "frequently replaced
  with ⟨е⟩ in print"
  ([Wikipedia: Yo (Cyrillic)](<https://en.wikipedia.org/wiki/Yo_(Cyrillic)>)),
  so it cannot be relied on as a stress mark.
- Vowel reduction:
  - In akanye, unstressed /o/ and /a/ merge. The result is [ʌ] in the
    syllable just before the stress and word-initially, and [ə] elsewhere
    after a hard consonant.
  - In ikanye, after soft consonants and /j/, unstressed /a/, /o/ and /e/
    merge with /i/ as [ɪ].
- Final devoicing: voiced obstruents are "devoiced word-finally", unless the
  next word begins with a voiced obstruent.
- Regressive voicing assimilation: the last obstruent in a cluster sets
  voicing for the whole cluster. /v/ and /vʲ/ are exceptions before vowels
  and sonorants.
- Palatalization: "Most consonant phonemes come in hard–soft pairs". The
  exceptions are "always-hard /ts, ʂ, ʐ/ and always-soft /tɕ, ɕː, j/". After
  hard consonants, /i/ is retracted to [ɨ].
- Implementation note (ours): Cyrillic orthography is close to phonemic once
  stress is known. The soft sign ь and the vowel letters е, ё, ю, я, и mark
  palatalization of the preceding consonant, so a rule cascade is feasible:
  stress, then palatalization, then reduction, then voicing.

## Hindi

All points below are from
[Wikipedia: Hindustani phonology](https://en.wikipedia.org/wiki/Hindustani_phonology)
and
[Wikipedia: Schwa deletion in Indo-Aryan languages](https://en.wikipedia.org/wiki/Schwa_deletion_in_Indo-Aryan_languages).

- Stops occur at five places: bilabial, dental, retroflex, palatal and velar.
  Each has a four-way phonation contrast: tenuis /p/, voiced /b/, aspirated
  /pʰ/ and murmured /bʱ/.
- The retroflex series is /ʈ ʈʰ ɖ ɖʱ/ plus the flaps /ɽ ɽʱ/. Dental and
  retroflex stops contrast phonemically.
- The vowel system has ten vowels: short /ə ɪ ʊ/ and long
  /aː iː uː eː oː ɛː ɔː/, plus /æː/ in English loans.
- Nasalised long vowels occur. The anusvara (ं) marks a homorganic nasal or
  light nasalisation, and the chandrabindu (ँ) marks heavy nasalisation.
- Schwa deletion: Devanagari consonants carry an inherent schwa.
  - The schwa is deleted word-finally, as in राम, pronounced Rām and not
    Rāma.
  - It is deleted medially by the rule `ə -> ∅ / VC_CV`, as in नमकीन
    namkīn.
  - The rule alone is reported to be correct about 89% of the time
    (Choudhury, Basu and Sarkar 2004).
  - Morphology matters: हरकत is har.kat, while सरकना is sarak.na.
- Articulatory consequences (ours): murmured stops need a breathy glottal
  setting, which in the Pink Trombone model is low tenseness plus aspiration
  noise. Retroflexes need a tongue-tip constriction further back than the
  dentals.

## Mandarin Chinese

From [Wikipedia: Help:IPA/Mandarin](https://en.wikipedia.org/wiki/Help:IPA/Mandarin)
and
[Wikipedia: Standard Chinese phonology](https://en.wikipedia.org/wiki/Standard_Chinese_phonology).

### Pinyin initials to IPA

| Pinyin | IPA | Pinyin | IPA | Pinyin | IPA |
| ------ | --- | ------ | --- | ------ | --- |
| b      | p   | g      | k   | zh     | ʈʂ  |
| p      | pʰ  | k      | kʰ  | ch     | ʈʂʰ |
| m      | m   | h      | x   | sh     | ʂ   |
| f      | f   | j      | tɕ  | r      | ʐ   |
| d      | t   | q      | tɕʰ | z      | ts  |
| t      | tʰ  | x      | ɕ   | c      | tsʰ |
| n      | n   | l      | l   | s      | s   |

### Tones (Chao tone letters)

| Tone    | Example | Value                                                              |
| ------- | ------- | ------------------------------------------------------------------ |
| 1       | ā       | high level ˥                                                       |
| 2       | á       | mid rising ˧˥                                                      |
| 3       | ǎ       | low ˩ medially, ˧˩ initially, ˩˧ finally, dipping ˧˩˧ in isolation |
| 4       | à       | high falling ˥˩                                                    |
| Neutral | a       | mid ˧ after tones 1-3, low ˩ after tone 4                          |

Tone sandhi that the G2P must apply:

- Third tone sandhi: in a sequence 3 + 3, the first becomes tone 2, for
  example 老鼠 lǎoshǔ, pronounced like láoshǔ. In longer runs the result
  depends on word grouping.
- 一 yī becomes yí before a tone 4 syllable and yì before tones 1-3. It keeps
  tone 1 in final position, as an ordinal, or before another digit.
- 不 bù becomes bú before a tone 4 syllable.
- Erhua adds an /ɚ/ rhotic coda in Beijing speech.
- There are about 400 syllables without tone and about 1300 with tone.
  A small lookup table from pinyin syllable to IPA is therefore enough after
  Hanzi-to-pinyin conversion.

For Hanzi to pinyin, pinyin-pro (MIT) handles polyphonic characters in
context ([zh-lx/pinyin-pro](https://github.com/zh-lx/pinyin-pro)). Unihan
`kHanyuPinyin` readings list several readings per character, so they need
context to disambiguate ([UAX #38](https://www.unicode.org/reports/tr38/)).

### Tone to glottal control (design, not sourced)

The source model takes these per-syllable F0 targets:

- Map Chao levels 1-5 onto a speaker-relative F0 range, for example a
  low-to-high span of about one octave around the base F0.
- Interpolate the targets with the same smoothing filter used for
  articulators.

## Recommended pipeline (design summary)

1. Normalize the text and detect script per run: Latin to English, Cyrillic
   to Russian, Devanagari to Hindi, Han to Mandarin.
2. Run a per-language front end:
   - English: CMUdict with a G2P fallback.
   - Russian: stress, then rule cascade.
   - Hindi: akshara parse, schwa deletion, then a map to IPA.
   - Mandarin: pinyin-pro, then a syllable table and tone sandhi.
3. Output IPA with stress and tone marks. Then segment it into PanPhon
   feature vectors.
4. Convert features into articulatory targets (area function, velum,
   glottal tension, F0) with durations. A synthesis-side smoother produces
   the transitions.
5. Optionally offer eSpeak NG (GPL) as a pluggable alternative front end in
   the CLI and server builds.
