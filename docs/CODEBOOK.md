# Simulator-generated articulatory codebook

`buildCodebook(head, options)` generates an inverse lookup of the forward
simulator, without recordings or training data. It returns several plausible
tract positions for an observed envelope; temporal selection belongs to #65.

```js
import {
  buildCodebook,
  analyzeFrames,
  frameEnvelope,
  serializeCodebook,
  parseCodebook,
  CODEBOOK_CHANNELS,
} from 'voice-simulator';

// Synchronous: run the initial build in a worker in an interactive app.
const table = buildCodebook({}, { size: 20000, seed: 1 });
const frames = analyzeFrames(samples, 16000);
const observation = {
  envelope: new Float64Array(24),
  key: new Float64Array(6),
};
const matches = { index: new Int32Array(16), cost: new Float64Array(16) };
frameEnvelope(frames, 10, table, observation);
table.query(observation.envelope, 16, matches);
const row = matches.index[0];
const position = Object.fromEntries(
  CODEBOOK_CHANNELS.map(({ name, min, max }, j) => [
    name,
    min + (table.articulation[row * 12 + j] * (max - min)) / 255,
  ])
);
const restored = parseCodebook(serializeCodebook(table));
```

`size` defaults to 20000 and accepts integers from 1 to 100000. Small tables
may omit seeds. `seed` is a finite integer, default 1. `cache` is synchronous:
`get(id)` returns a `Uint8Array` or `undefined`, and `set(id, bytes)` stores
bytes. The default is an in-memory `Map`. Cache hits return independent arrays
and query scratch. No generated table is included in the npm package.

The channels, in order, are height, backness, rounding, rhotic,
palatalization, lipAmount, lipArea, tongueAmount, tongueArea, tongueLocation,
tongueWidth and velum; `CODEBOOK_CHANNELS` gives their ranges. Source controls
use their defaults, with f0 fixed at 100 Hz for nasal renders. Seeds cover
neutral, all 31 vowels, their nasalized variants, and 66 consonants on a, i, u
and neutral. Further proposals mix seeds (25%), perturb them (50%) or draw
random vowels (25%), using a separate seeded generator for each proposal.
Rejection of duplicates and the 10% nasal cap can change the accepted shares.

Oral features use the default wall losses and radiation of `tubeTransfer`,
computed by the scalar `tractResponse`. Open velums use an 80 ms JavaScript
waveguide render at 16 kHz, Burg LPC of the last 40 ms and a neutral-source
correction. The envelope has 24 mel-spaced bands: 16 from 150 to 2700 Hz and
eight more to 5200 Hz. Formants and bandwidths come from a 25 Hz response grid
with interpolated peaks and half-power crossings. Six detrended DCT
coefficients of the first 16 stored bands form the search key.

On the first whispered speech frame, the recognizer renders the same tract
rows with the `whisper` channel set to 1. The second table uses LPC from
five pooled autocorrelation windows and shares the original tract indices
for motion costs across a mode boundary. The inversion compares whispered
frames with those references and uses the whisper source for refinement and
render-back.

`lengthScale` is the requested tract length divided by 16.5 cm. A pure scaling
of the default head gave a maximum 3.69% vowel-formant error at 14 cm, exceeding
the issue's 2% tolerance. Tables therefore use `referenceLength`, the requested
length rounded to 0.5 cm, in their identity and build geometry. Frequencies are
represented on the 16.5 cm axis; stored formants are in physical Hz for the
reference length. Every normalized head field participates in the cache ID:
the current forward geometry and nasal renderer depend on more fields than
pharynxRatio, oralWidth, nasalSize and nasalCoupling alone.

`frameEnvelope` evaluates the frame's LPC at `GRID / lengthScale`, subtracts
the first 16 bands' mean and computes the key. Frequencies above 95% of
Nyquist remain `NaN`. Missing low bands use the highest present low band when
forming the key. It does not remove the full glottal-source spectrum from
observed frames. This can reduce articulatory accuracy even for rendered
vowels; the heavy report prints the measured share against the 90% target.
`experiments/issue-64-rendered.mjs` compares raw observations with an explicit
neutral-source calibration for diagnosis.

`query(envelope, k, out)` visits at most 192 rows of a median k-d tree (within
the issue's 512-row limit), keeps
64 candidates by key and orders them by mean squared envelope error over
present bands. `k` defaults to 16 when passed `undefined`, and must be 1..64.
It reuses scratch and caller-owned arrays. Missing results have index -1 and
cost Infinity; all-NaN input produces only missing results. Identical
quantized envelopes use row order to break ties: distinct positions can make
the same sound. Calls on one table are synchronous and share its scratch.

The binary format is versioned, explicitly little endian and includes the
identity, length, row counts, nasal count and measured non-uniqueness. Build
time is deliberately excluded so repeated builds have identical bytes.
Parsing checks dimensions, finite keys and tree structure before lookup.
The arrays use 94 bytes per row including the four-integer tree node:
1,880,080 bytes for 20000 rows, including the 80-byte header.

`stats.rows` counts accepted rows by kind; `nasalRows` counts open velums.
`nonUniqueShare` is the fraction with another row's four formants within 3%
and at least one channel more than 25% of its range away.
`buildMilliseconds` is wall time, or zero for parsed/cached tables.

## Verification

```sh
node --test tests/recognition-codebook.test.js
bun test tests/recognition-codebook.test.js
deno test -A tests/recognition-codebook.test.js
npm run test:heavy -- --suite recognition
node experiments/issue-64-query.mjs 20000
node experiments/issue-64-rendered.mjs 2000
# Reuse the 20000-row binary saved by issue-64-query.mjs:
node experiments/issue-64-analysis.mjs
```

The fast tests build 2000-row tables, print their SHA-256, check every array's
round trip, compare 1000 transfer responses and compare 200 queries against
exhaustive search. Full 20000-row coverage, speed budgets, length fallback
and 300 ms rendered vowels at 8 and 16 kHz run only in the manual heavy
workflow. Reports are saved under `reports/heavy/recognition-codebook.*`.
Rust has matching transfer and key primitives with WebAssembly parity tests;
Rust table building remains the separate scope of #77.

Measured CI results, including the rendered-vowel target misses, are preserved
in [the issue 64 report](reports/recognition-codebook.md).

## Acoustic-to-articulatory inversion

```js
import {
  analyzeFrames,
  articulationPlan,
  invertArticulation,
  renderPlan,
} from 'voice-simulator';

const track = invertArticulation(analyzeFrames(samples, sampleRate), {
  voice: fittedHead,
});
const rendered = renderPlan(articulationPlan(track), {
  sampleRate,
  solver: 'waveguide',
  seed: 1,
});
```

`invertArticulation` estimates 12 tract controls and nine source controls. It
returns per-frame means, variances, confidence, and ranked codebook candidate
rows. `createArticulationInverter(frames, options)` accepts the live frame set
and exposes the stable prefix as `track.committed`. The default lookahead is
30 scored frames, or 150 ms at a 5 ms hop, plus the upstream analysis delay.
Pass `refine: true` to enable the batch oral refinement. See the
[golden-set render-back measurements](reports/recognition-inversion.md)
for the current accuracy.

## Audio to IPA

`audioToIpa(samples, sampleRate, { voice, language: 'en', nbest: 5 })` scores inverted articulation and broad sound classes against the synthesizer's phone templates. Provide a head as `voice` or leave it out to fit the head from the recording. A single `language` or several `languages` selects text-derived phone transitions for `en`, `ru`, `hi` and `zh`. With neither option the decoder uses the full IPA inventory and zero transition costs.

For an isolated sustained vowel recorded at 16 kHz with a supplied head, batch decoding also compares the recording with duration-matched waveguide renders of the vowel inventory. It uses the ranked vowel readings when the whole recording closely matches a render. Learn more in the [round-trip report](reports/roundtrip.md#isolated-sustained-vowels-at-16-khz).

The result contains the best IPA string, timed `segments` and `syllables`, ranked `nbest` readings, a `lattice`, and the analysis tracks. Times are in seconds. A segment's confidence ranks alternatives on the same span. To reproduce the pronunciation counts, run `node scripts/build-phonotactics.mjs`. They use English lexicon pronunciations, Russian stress entries, one Mandarin character per pronunciation group and a project-authored Hindi word list. `node scripts/tune-decoder.mjs` selects the weights on 40 separate simulator-rendered tuning sentences.

`createIpaDecoder(sampleRate, options)` returns fixed segments and newly confirmed syllable nuclei from both `push(chunk)` and `flush()`. Read the full result with `result()` and call `reset()` to begin a new recording. The streaming frame buffer defaults to 30 seconds and can be set with `maxSeconds`.

See the [decoder benchmark](../reports/heavy/recognition-decode.md) for measured accuracy.

The synthetic recognition gates in `tests/recognition-decode.test.js` remain
open. With the language supplied, mean phone error on the 32 held-out
utterances was 79.79% at 16 kHz and 82.44% at 8 kHz. The universal decoder
measured 92.12% at 16 kHz. The targets are 25%, 35% and 40%, respectively.

Run `node experiments/issue-66-oracles.mjs` to inspect the upstream evidence.
The boundary generator placed a candidate within 20 ms of 725 of 838
planned boundaries. When given the exact planned spans, the scorer ranked
90 of 650 in-inventory phones first from the inverted channels and observed
landmark classes. Supplying the planner's channels instead raised this to
401 of 650 with the same classes. With class cost disabled in both runs,
the corresponding counts were 97 and 490. Improving acoustic inversion
and broad-class estimates is needed before the same decoder can be
verified against the original gates.

## Analysis-by-synthesis rescoring

Pass a decoder result with several readings to `rescoreHypotheses(decoded)` to compare uncertain stretches against waveguide renders in the fitted voice. The decoder must retain its working-rate samples and articulation track.

```js
const decoded = audioToIpa(samples, sampleRate, { language: 'en', nbest: 10 });
const { ipa, segments, rescoring } = rescoreHypotheses(decoded);
```

`warpPlan(plan, anchors)` returns a retimed plan whose `offset` is the recording time at sample zero. `planReading(decoded, segments)` matches phone onset times and copies the recovered pitch and loudness. `planRescoring(decoded)` prepares a reference render and cloneable jobs. Call `scoreJob(job)` for a job's mel-cepstral distance.

Each region retains the decoder's first choice. The scorer combines the render distance with the cost of the cheapest complete decoder reading containing each candidate, including transitions at the region boundary. If the costs tie, the decoder's original choice wins. `node scripts/tune-rescoring.mjs` generates the acoustic weight from synthetic tuning utterances and favors smaller weights within one paired standard error of the minimum phone error rate.

For a finished streaming phrase, pass `{ preserveTiming: true }` to keep published phone and syllable times. Changed IPA is marked `revised`. The streaming recognizer in [#73](https://github.com/konard/voice-simulator/issues/73) owns phrase boundaries and keeps rescoring off by default.

The full held-out evaluation checks that mean phone error does not rise at either 16 or 8 kHz for the synthetic and golden sets. See the [held-out rescoring report](../reports/heavy/recognition-rescoring.md) for phone error, oracle rates, and revision counts at each rate.
