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
