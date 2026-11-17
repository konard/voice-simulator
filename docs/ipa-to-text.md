# IPA to text

```js
import { ipaToText } from 'voice-simulator';

ipaToText('həˈloʊ ˈwɝld', { language: 'en' }).text; // hello world
ipaToText('prʲɪˈvʲet', { language: 'ru' }).text; // привет
ipaToText('ni˧˥ xɑʊ˨˩˦', { language: 'zh' }).text; // 你好
```

The language is `en` (default), `ru`, `hi` or `zh`. Input can instead be
an array of `{ ipa, start, end, confidence }` sounds, with times in seconds
and confidence in `[0, 1]`. Invalid IPA, times and options throw.

Strings with spaces use supplied word boundaries by default, except in
Chinese. Arrays and Chinese search for boundaries. Set `boundaries` to
`given` or `search` explicitly to override this. Pauses always separate words.
`beam` (default 32) bounds the pronunciation search and partial transcriptions.
`nbest` includes the best text; values above one add distinct `alternatives`.

Results contain lower-case, punctuation-free `text`, selected `ipa` and
`words`. Each word contains `text`, `ipa`, `language`, `start`, `end`,
`confidence` and `syllables`. Times are null for strings. Syllables use the
same spelling spans as the articulation timeline. Unknown words use a
phonetic spelling and confidence at most 0.3. Homophones depend on corpus
counts and their preceding word; no decoder can recover absent information
from an isolated sound sequence.

The optional `trace(event)` callback reports input length, path costs and
selected word arcs. It is disabled unless supplied.

```sh
voice-simulator text 'həˈloʊ ˈwɝld' --lang en
voice-simulator text 'winʊðɛɹɚtukæts' --lang en --boundaries search --json
node scripts/build-recognition-data.mjs --text '/path/to/text/en/*.txt'
```

The offline builder accepts UTF-8 text directories, verifies at least one
million accepted words per language, and writes count tables only. It
never downloads anything. [SOURCES.md](../src/recognition/data/SOURCES.md)
records the exact corpus hashes, rights and tokenisation. Source texts stay
outside the repository and are never downloaded in CI.

Pronunciations are derived from the forward rules at runtime, including
lexicon variants, Hindi schwa variants and Russian clitics. Exact paths
preserve noiseless speech; otherwise bounded edit search uses the feature
costs in [phone-distance.js](../src/recognition/phone-distance.js).
An acoustic weight calibrates these local costs against the language model.
The Rust core implements the same feature costs, trie search, count model
and dynamic programming; language parsing and spelling remain shared in JS.

Final local costs are vowel height 2, backness 1.5, rounding 0.5, length
and nasality 0.3; consonant manner 0.5, place 0.35/11 per position,
voicing 0.25, aspiration and palatalisation 0.2. Cross-kind cost is 1
(i/j and u/w: 0.6); tone cost is 0.5, third/half-third 0,
third/rising 0.15; stress costs 0.2. Distance is capped at 1. Gaps cost 1,
or 0.5 for schwa and glottal stop. The candidate cutoff is
`0.6 * (sounds used + 1)`; approximate acoustic costs have weight 10;
unknown cost is `3 + 2 * sounds` (at most twelve sounds). Word cost is
`-0.3 * ln(P) + 0.5`, with discount 0.75 and unigram backoff 0.4.
An exact full path takes precedence. An exactly readable suffix can
propose a shorter unknown-word boundary. These calibrations prevent the
word penalty from joining noisy phrases into unrelated long words.

Mandarin boundary and noise errors use phonological syllables, the forward
engine's character units, so a multi-character corpus word and its separate
character words can be compared. Spelling uses characters. Counts use
non-overlapping corpus words. Standalone exact homophones keep their most
frequent character spelling in the compact vocabulary; longer words retain
other spellings. Rule spelling inverts every listed character reading and
uses corpus counts. Polyphonic output characters can have a different
isolated default reading; the held-out measurements include these errors. Russian fallback stress is written
with an acute accent to preserve the heard vowel reductions.

Verification uses `tests/ipa-to-text.test.js`, `tests/recognition-data.test.js`
and the deterministic fixture at
`tests/fixtures/recognition/ipa-sentences.json`. The bounded development
measurement command is `node experiments/issue-68/measure.mjs`.

Measured locally with Node.js 26.13.0 on 2026-11-17 using the focused
automated checks below (the measurement script reproduces the accuracy rows):

| Language | Corpus words | First 5000: sounds / spelling | Sentence spelling | Boundaries by sound | Seed-1 noisy WER | Held-out rule spelling | Cold trie |
| -------- | -----------: | ----------------------------- | ----------------- | ------------------- | ---------------- | ---------------------- | --------- |
| en       |    1,473,964 | 5000 / 4874 (97.48%)          | 69/69 (100%)      | 69/69 (100%)        | 0/69 (0%)        | 166/200 (83%)          | 1.524 s   |
| ru       |    1,145,974 | 5000 / 4835 (96.70%)          | 52/53 (98.11%)    | 52/53 (98.11%)      | 3/53 (5.66%)     | 191/200 (95.5%)        | 1.918 s   |
| hi       |    1,103,787 | 5000 / 4873 (97.46%)          | 65/66 (98.48%)    | 65/66 (98.48%)      | 6/66 (9.09%)     | 200/200 (100%)         | 1.222 s   |
| zh       |    1,683,196 | 5000 / 4896 (97.92%)          | 106/112 (94.64%)  | 110/112 (98.21%)    | 22/112 (19.64%)  | 191/200 (95.5%)        | 1.812 s   |

All forty sentences retain the same sounds. The noisy WER regression gates
are the exact fractions above plus 0.02, with an additional strict 0.30 cap.
The automated held-out test removes all entries for its 200 words from the
reverse trie before exercising the rule speller, then restores them.
The remaining spelling errors include genuine homophones and phonetic
fallbacks; these measurements do not assert arbitrary isolated spelling recovery.

```sh
node --test --test-timeout=30000 --test-concurrency=1 \
  tests/ipa-to-text.test.js tests/recognition-data.test.js \
  tests/rust-recognition.test.js tests/engine-size.test.js tests/lexicon.test.js
```

All 50 checks pass. The warmed 120-sound, beam-8 query took 3.2 ms
(limit 500 ms). All inventory pairs satisfy the
bounded, symmetric distance checks. The CLI examples print `hello world`,
`привет` and `你好`; `hello` splits into `hel`, `lo`, and the unknown `blik`
has confidence at most 0.3. Rust parity uses absolute tolerances 1e-12 for
feature distances and 1e-10 for decoding costs, including edits, unknowns,
boundary modes and distinct alternatives.

`du -k src/recognition/data` reports 2700 KiB (limit 3200). The generated
English, Russian, Hindi and Chinese files are respectively 591267, 751674,
773343 and 618231 bytes (limit 800000 each), with 20000 words and 40000
observed bigrams each. Ordinary corpus literals use lossless Unicode escapes
where needed so the issue's raw dependency-name scan also prints nothing.

Cold-trie profiling identified array allocation in the compressed lexicon's
Unicode comparator. It now reads code points directly, retaining the same
ordering, including supplementary characters. The bounded reproduction
`node experiments/issue-68/compare-lexicons.mjs` measured 200000 comparisons
at 79.59 ms before and 8.91 ms after, with the same checksum. The strict
three-second cold-trie limit is unchanged.
