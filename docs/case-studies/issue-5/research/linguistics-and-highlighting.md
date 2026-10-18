# Linguistics: punctuation prosody, accents, syllables and highlighting

Issue #5 asks for configurable accents and punctuation, and for word plus
syllable highlighting while audio plays. This file surveys how established
systems handle these and proposes concrete rules. Values marked
**(heuristic)** are our proposals, not sourced measurements.

## Current state in our code

`src/g2p/index.js` maps punctuation to three break types (`PUNCTUATION_BREAKS`):

- `.` (full stop): `.`, `!`, `…`, `。`, `！`, `।`, `॥`
- `?` (question): `?`, `？`
- `|` (minor break): `,`, `;`, `:`, `—`, `–`, `，`, `、`, `；`, `：`

The tokenizer drops quotes, parentheses and brackets entirely. Exclamation
and ellipsis are indistinguishable from a full stop.

## How eSpeak NG does it

Source: https://github.com/espeak-ng/espeak-ng/blob/master/docs/intonation.md

- Clause tunes by punctuation:
  - A voice declares `tunes s1 c1 q1 e1`, the tunes used for clauses ending
    in a full stop, comma, question mark and exclamation mark.
  - Each clause has four parts:
    - pre-head: unstressed syllables before the first stress
    - head: first stressed syllable up to the nucleus
    - nucleus: the last stressed syllable, which eSpeak takes as the focus
    - tail: syllables after the nucleus
- A tune definition gives pitch envelopes per part, in percent of the voice's
  pitch range. Example from the doc:

```text
tune s1
prehead   46 57
headenv   fall 16
head       4 80 55 -8 -5
headextend 0 63 38 13 0
nucleus  fall 70 18 24 12
nucleus0 fall 64 8
endtune
```

- Voice and language files
  (https://github.com/espeak-ng/espeak-ng/blob/master/docs/voices.md):
  - `brackets` increases the pause around parentheses (default 4).
  - `intonation` selects variants:
    - 3: a comma does not raise pitch
    - 4: rising at sentence end
  - `stressLength` / `stressAmp` set per-stress-level durations and
    amplitudes.
  - A `words` attribute adds pauses between words or after vowel-final words.
- Dictionary flags `$pause` and `$brk` insert a short or very short pause
  before words such as conjunctions
  (https://github.com/espeak-ng/espeak-ng/blob/master/docs/dictionary.md).
- Phoneme strings use `_:` for a short pause and `_` for a shorter one (same
  doc).

## ToBI as the intonation vocabulary

- ToBI (Tones and Break Indices), developed by Beckman and Pierrehumbert in
  the early 1990s (summary: https://legacy.cs.indiana.edu/~port/teach/306/tobi.summary.html;
  MIT course: https://ocw.mit.edu/courses/6-911-transcribing-prosodic-structure-of-spoken-utterances-with-tobi-january-iap-2006/pages/lecture-notes/).
- Pitch accents:
  - `H*`: a peak, the default accent
  - `L*`: a low accent
  - `L+H*`: a contrastive or focus accent
- Phrase accents (intermediate phrase): `H-`, `L-`.
- Boundary tones (intonational phrase): `H%`, `L%`.
  - `L-L%`: a declarative fall to the baseline.
  - `H-H%`: the yes/no question rise
    (https://ocw.mit.edu/courses/6-911-transcribing-prosodic-structure-of-spoken-utterances-with-tobi-january-iap-2006/875ff50dbaba20359cf742c0d491f5d5_chap2_4.pdf).
- Break indices, 0-4:
  - 1: an ordinary word boundary
  - 3: an intermediate phrase
  - 4: an intonational phrase (https://arxiv.org/pdf/1803.07295)

## Proposed punctuation rules

The boundary tones follow the ToBI conventions above. Pause lengths and
scales are **(heuristic)**.

| Mark              | Break index    | Boundary tone                   | Pause (ms) | Other effects                                                    |
| ----------------- | -------------- | ------------------------------- | ---------- | ---------------------------------------------------------------- |
| `,`               | 3              | `H-` (continuation rise, small) | 150-250    | slight final lengthening (~20%)                                  |
| `;` `:`           | 3-4            | `L-`                            | 250-350    | -                                                                |
| `.`               | 4              | `L-L%`                          | 400-600    | declination reset after                                          |
| `?` (yes/no)      | 4              | `H-H%`                          | 400-600    | final rise ~+30-50% of range                                     |
| `?` (wh-question) | 4              | `L-L%`                          | 400-600    | wh-word gets the focus accent                                    |
| `!`               | 4              | `L-L%` with larger nucleus      | 400-600    | +20-30% pitch range, +3 dB, faster                               |
| `…`               | 4 (incomplete) | level or `H-L%`                 | 600-900    | slower tail, fade loudness                                       |
| `—` (dash)        | 3              | `L-` or level                   | 200-300    | parenthetical: lower range until the closing dash                |
| `( )`             | 3 each side    | -                               | 150-250    | compress range to ~70%, -3 dB, slightly faster                   |
| `" "` / `« »`     | 1-3            | -                               | 0-150      | optional voice-quality or pitch-register shift for quoted speech |

Additional rules:

- Telling yes/no questions from wh-questions:
  - Check whether the clause starts with a wh-word: who, what, where, when,
    why, which, how; in Russian кто, что, где, когда, почему, как.
  - eSpeak's `intonation` attribute shows that languages differ here.
  - Russian yes/no questions use a rise-fall on the focused word (IK-3),
    not a final rise **(well-known phonology, not sourced here)**.
- Focus: accent the last content word by default (eSpeak's nucleus rule).
  Allow explicit focus via `*word*` or SSML `<emphasis>`. Focus gets
  `L+H*`, +25% range and +15% duration **(heuristic)**.
- Declination: about -10% of range across an intonational phrase. Reset at
  each `.` **(heuristic)**.
- Mandarin: lexical tones already come from `src/g2p/pinyin.js`. Apply only
  a phrase-level register shift and final lowering, not English tunes.

## Accents

Wells' standard lexical sets, defined on RP and General American, are the
standard way to specify accent differences (https://en.wikipedia.org/wiki/Lexical_set;
handout: https://users.castle.unc.edu/~jlsmith/ling520/handouts/Wells-lexical-sets.pdf).

| Lexical set | GA (US)                         | RP (UK) | Example     |
| ----------- | ------------------------------- | ------- | ----------- |
| TRAP        | æ                               | æ       | cat         |
| BATH        | æ                               | ɑː      | bath, dance |
| LOT         | ɑ                               | ɒ       | hot         |
| THOUGHT     | ɔ (or ɑ with cot-caught merger) | ɔː      | caught      |
| GOAT        | oʊ                              | əʊ      | go          |
| NURSE       | ɝ                               | ɜː      | bird        |
| START       | ɑr                              | ɑː      | car         |
| NEAR        | ɪr                              | ɪə      | near        |

Sources for the rows: the Wikipedia lexical set page and the MIT handout
https://ocw.mit.edu/courses/24-914-language-variation-and-change-spring-2019/4eb09080f12272fd13de61acf7eb1397_MIT24_914s19_lexicalsets.pdf.

Other features:

- Rhoticity: GA pronounces /r/ before consonants and word-finally; RP does
  not, except as linking or intrusive /r/ before a vowel
  (https://en.wikipedia.org/wiki/Lexical_set).
- T-flapping: GA flaps intervocalic /t/ after stress, for example
  `water [ˈwɑɾɚ]` **(well-known; not sourced here)**.
- How eSpeak defines accents
  (https://github.com/espeak-ng/espeak-ng/blob/master/docs/languages.md):
  - Separate voice/language files: `en-us`, `en-gb-x-rp`, `en-gb-scotland`,
    `en-gb-x-gbclan`, `en-gb-x-gbcwmd`.
  - Each selects a phoneme table (for example `phonemes en-us`), dictionary
    rule variants (`dictrules 3 6`) and phoneme replacements (`replace 03 I
i`, final unstressed /ɪ/ becomes /i/).
  - Each also sets stress timings (`stressLength 140 120 190 170 0 0 255
300`, `stressAmp ...`).
  - These values are read from `espeak-ng-data/lang/gmw/en-US`.

Proposal:

- Accent profile = `{ lexicalSetMap, rhotic, flapT, replaceRules,
stressLength, tunes }`.
- Apply it as a post-G2P rewrite on lexical-set-tagged vowels.
- The dictionary in `src/g2p/english-dict.js` would need lexical-set tags, or
  a rule mapping from GA vowels plus spelling. For example, BATH is
  `æ` + `ss/st/th/nce/nt/f` in RP.
- Start with GA (default) and RP. Speaking styles (slow/clear, fast/casual,
  whisper, shout) are presets over tempo, pitch range, Rd and aspiration.

## Syllabification

- Maximal onset principle:
  - Intervocalic consonants go to the following syllable's onset as long as
    the onset is legal for the language.
  - Examples: `diploma = di.plo.ma`, and `polka = pol.ka` because /lk/ is not
    a legal onset
    (https://git.owoga.com/eihli/phonetics/media/commit/737e577f0edfcbaa21c356a855111e13e6e1b21b/resources/110%20Guest%20Lecture%20-%20Syllables%20and%20Phonotactics.pdf).
- Sonority sequencing principle (Clements 1990):
  - Sonority rises toward the nucleus and falls after it.
  - Scale: vowels > glides > liquids > nasals > obstruents
    (https://users.castle.unc.edu/~jlsmith/syllsem/pdf/sonority.pdf;
    https://pressbooks.nvcc.edu/eng200h5p/?p=150).
  - English /s/+stop clusters (`st`, `sp`, `sk`) violate the principle but
    are legal onsets, so whitelist them.
- Algorithm (language-parameterised):
  1. Find nuclei: vowels and syllabic consonants `n̩ l̩ ɹ̩`.
  2. For each consonant cluster between nuclei, give the longest suffix that
     is a legal onset (from a per-language onset list, or by rising sonority
     plus the s-cluster exception) to the next syllable.
  3. Respect stress marks: `ˈ`/`ˌ` in IPA already mark syllable starts.
     Russian G2P inserts `ˈ` before the stressed onset
     (`src/g2p/russian.js`).
  4. Never split inside affricates (`tʃ`, `dʒ`) or diphthongs.
- Mandarin: each Hanzi is one syllable, already split in `src/g2p/chinese.js`.
- Hindi: the akshara (orthographic syllable) is a good approximation.

## Word and syllable karaoke highlighting

### Existing APIs

- SSML 1.1 `<mark name="..."/>` (W3C Recommendation, 7 September 2010,
  https://www.w3.org/TR/2010/REC-speech-synthesis11-20100907/):
  - Places a named reference point in the text.
  - The engine raises an event carrying the name when that point is reached
    (summarised in
    https://learn.microsoft.com/en-us/previous-versions/office/developer/communication-server-2007/bb812497(v=office.12)).
- Web Speech API, `SpeechSynthesisUtterance` `boundary` event:
  - Fires at word and sentence boundaries.
  - `SpeechSynthesisEvent` has `name` (`word`/`sentence`), `charIndex`,
    `charLength` and `elapsedTime`.
  - Limited availability, and reported unreliable in some browsers
    (https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisUtterance/boundary_event).
- Azure Speech `WordBoundary`:
  - Fires per word, punctuation and sentence.
  - Gives the audio offset in 100 ns ticks (10,000 per ms), `TextOffset` and
    `WordLength` in characters.
  - Separate `VisemeReceived` events give mouth poses
    (https://learn.microsoft.com/it-it/dotnet/api/microsoft.cognitiveservices.speech.speechsynthesiswordboundaryeventargs?view=azure-dotnet).
- AWS Polly "speech marks" provide similar JSON timing **(mentioned in an
  Azure Q&A thread, https://learn.microsoft.com/en-us/answers/questions/531771/text-to-speech-with-timestamp-in-json-format;
  not verified on AWS docs)**.

### Our advantage

We synthesise from our own articulation plan, so exact timings are known
before audio is rendered. There is no need for events from a black box.

Proposal:

1. Keep source spans through the pipeline:
   - Tokenizer: `token = { text, start, end }` in the original string.
   - G2P: `word = { tokenIndex, ipa, syllables: [{ phones, stress }] }`.
   - Plan: every phone gets `{ wordIndex, syllableIndex, t0, t1 }`.
2. Emit a timing track: `[{ kind: 'word'|'syllable', index, charStart,
charEnd, t0, t1 }]`. Its JSON is similar to Polly speech marks and Azure
   WordBoundary, so it can be exported.
3. Map original characters to syllables:
   - English: split the orthographic word proportionally to the phone count,
     or use a hyphenation dictionary. Display-level accuracy is enough.
   - Chinese: one character per syllable.
   - Russian: vowel-letter count equals syllable count, so split before each
     vowel letter's onset.
4. In the UI, drive highlighting from `audioContext.currentTime -
startTime`, adding `outputLatency` where available. Use
   `requestAnimationFrame` and binary-search the timing track. Mark the word
   with a class and the syllable with a nested `<span>`.
5. Export the same track as WebVTT cues (word-level, with syllable inline
   timestamps `<00:00:01.200>`) alongside the audio file **(WebVTT inline
   timestamps are part of the WebVTT spec; not fetched here)**.
6. Accept SSML-like input (`<mark>`, `<break time>`, `<emphasis>`,
   `<prosody rate pitch>`) as an optional advanced mode. Marks then appear in
   the timing track.

## Recommendations (summary)

1. Extend `PUNCTUATION_BREAKS` to distinct break classes, each mapped to a
   tune and a pause length from the table above:
   - `stop`, `question`, `exclaim`, `ellipsis`, `comma`, `semicolon`, `dash`
   - `parenOpen`, `parenClose`, `quoteOpen`, `quoteClose`
2. Implement eSpeak-style clause tunes (pre-head/head/nucleus/tail),
   parameterised per language and accent. Store tunes as data, not code.
3. Add accent profiles (GA, RP first) using Wells lexical sets and simple
   rewrite rules (rhoticity, BATH, LOT, GOAT, flapping).
4. Add a language-parameterised maximal-onset syllabifier with sonority
   checks, used for both prosody (stress placement) and highlighting.
5. Carry character spans through G2P and the plan, and emit a word plus
   syllable timing track for the UI and for export (JSON, WebVTT).
