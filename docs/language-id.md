# Language identification from IPA

```js
import { identifyLanguage, ipaToText, languageShares } from 'voice-simulator';

const ipa = 'ɐˈna skɐˈzaɫə ˈθæŋk ˈju i ˈuʂɫə';
const identified = identifyLanguage(ipa);
const result = ipaToText(ipa, { spans: identified.spans });
const languages = languageShares(result.words);
```

`identifyLanguage` accepts a string or the timed sounds accepted by `ipaToText`.
It returns `languages` sorted by descending share, `spans`, and `scores` (mean
log score per sound over the full input). A span has `language`, `from`, `to`,
`start`, `end`, `confidence`. Offsets count speech sounds, exclude pauses and
have an exclusive end. Times are seconds for timed input and null for strings.
Shares count sounds, or speech duration for timed input; silence contributes
nothing. Empty input returns `{ languages: [], spans: [], scores: {} }`.

Options are `languages` (a nonempty distinct subset of `Object.keys(LANGUAGES)`),
`switchPenalty` (6) and `minSounds` (8). Both numeric options must be finite
and nonnegative. Confidence is `1 - exp(-(best - second) * sounds / 4)` using
mean span scores; below `minSounds`, multiply by `sounds / minSounds`.
A single allowed language has no competing score and uses only that length
factor. With `minSounds: 0` there is no short-input scaling. Confidence
expresses separation between supported models, not accuracy on audio.

Each language model is built lazily from the current pronunciation trie.
Counts weight every symbol, pair and triple by the word count, including
word-edge `#` symbols, ignoring stress and tones. The final interpolation is
`0.6 * count(abc)/count(ab) + 0.3 * count(bc)/count(b) +
0.1 * max(count(c)/total, 0.0001)`; zero denominators contribute zero.
Scoring sums log probabilities over syllables, resetting context at spaces
and pauses. A syllable carrying a tone adds 3 to Mandarin. Viterbi charges
6 per language switch, halved at a pause. A single-syllable island between
equal labels is smoothed. When the top two scores differ by less than
0.5 per sound, the lower-cost monolingual lexical decoding decides the span.
These initial constants already clear every fixed acceptance threshold;
the final values are recorded in the source comments. No stored statistics,
recognition data, dependencies or recordings are added.

`ipaToText(ipa, { spans })` uses a single language as before when every span
has that language. Mixed spans search their lexicons together: span mismatch
costs 2 at the first sound of a word; changing word language costs 1 except
at a pause. Bigram counts apply only within one language, and the first word
after a change uses its unigram count. Output words carry `language`;
adjacent Mandarin words join without spaces, other neighbours use one space.
Supplied spans must cover all input sounds in order without gaps or overlaps.

`languageShares(words)` aggregates the final words using their language and
valid start/end times; otherwise it uses `from`/`to` sound offsets or parses
`ipa` to count sounds. It ignores zero weights and returns an empty array
when the total is zero. Use it after decoding so shares describe final words.
An optional `trace(event)` on identification reports units, the initial path
and the number of lexical comparisons; diagnostics are disabled by default.

```sh
node bin/voice-simulator.js language 'ɐˈna skɐˈzaɫə ˈθæŋk ˈju i ˈuʂɫə'
# ru 0-10 1.00
# en 10-16 0.75
# ru 16-21 0.60
voice-simulator language 'ni˧˥ xɑʊ˨˩˦' --languages en,zh --json
```

## Fixed acceptance measurements

Run `node --test --test-timeout=30000 tests/language-id.test.js` or
`node experiments/issue-69-measure.mjs`. All fixtures are deterministic forward
speech; these results do not measure identification from recordings.
Measured with Node.js 26.13.0 on 2026-11-17:

| Check                                            | Result                 | Required                     |
| ------------------------------------------------ | ---------------------- | ---------------------------- |
| Monolingual sentences                            | 40/40 (100%)           | 100%                         |
| English words, at least four sounds              | 1997/2000 (99.85%)     | 90%                          |
| Russian words                                    | 2000/2000 (100%)       | 90%                          |
| Hindi words                                      | 2000/2000 (100%)       | 90%                          |
| Mandarin words with tones                        | 2000/2000 (100%)       | 97%                          |
| Mandarin sentences without tones                 | 10/10 (100%)           | 90%                          |
| Mixed word language labels                       | 69/75 (92.00%)         | 90%                          |
| Mixed decoded sound/language units               | 75/79 (94.94%)         | 85%                          |
| Spans on each mixed fixture                      | At most true count + 1 | At most true count + 1       |
| English continuity                               | 30 syllables, one span | One span                     |
| Three-sound confidence                           | Below 0.5              | Below 0.5                    |
| Seed-1 nearest-sound noise, 10% chance per sound | 67/75 (89.33%)         | 75%; regression floor 87.33% |
| Warm 120-sound query, zero lexical comparisons   | 2.330 ms               | Below 50 ms                  |

Word confusion matrix, with rows as true and columns as predicted language:

|     |   en |   ru |   hi |   zh |
| --- | ---: | ---: | ---: | ---: |
| en  | 1997 |    1 |    1 |    1 |
| ru  |    0 | 2000 |    0 |    0 |
| hi  |    0 |    0 | 2000 |    0 |
| zh  |    0 |    0 |    0 | 2000 |

The twelve mixed fixtures are committed at
[tests/fixtures/recognition/mixed-sentences.json](../tests/fixtures/recognition/mixed-sentences.json),
three per en+ru, en+hi, en+zh and ru+zh pair. Ground truth comes from the
forward converter's word labels, including its pinyin interpretation; a
Latin word that the converter treats as pinyin is not an English fixture.
Decoded Mandarin words use phonological syllables for alignment, as in
[IPA recognition](ipa-to-text.md), allowing equivalent character segmentation.
All other decoded units are words, matched by sounds and language, with edit
penalties for missing or extra units. Tests also cover timed offsets/shares,
empty input, restrictions, invalid options, model arithmetic, smoothing,
pause switch costs, monolingual compatibility, mixed joining and CLI output.

The Rust core mirrors weighted statistics, scoring, Viterbi, smoothing,
confidence, duration shares and joint recognition. Small fixed lexicons in
`tests/rust-recognition.test.js` compare JavaScript and WebAssembly scores
and paths to absolute error below `1e-10`, including malformed packets.
Parsing, lexical tie checks and text formatting stay in JavaScript. The
existing CI runs the acceptance suite on Node.js, Bun and Deno and checks
Rust/WASM numerical parity.
