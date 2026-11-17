# Experimental syllable nuclei and acoustic landmarks

`findLandmarks(frames, options)` reads the analysis front end's mel energies,
periodicity and six frequency bands. It returns `hop`, `startTime`, `count`,
`committed`, `classes` (`Uint8Array`), `sonority` (`Float32Array`), `nuclei`
(`time`, `start`, `end`, `strength`) and `landmarks` (`time`, `type`, `strength`).
The arrays have `frames.capacity` entries, with `count` valid rows.
`BROAD_CLASSES` lists class names in numerical order: silence, vowel, glide,
nasal, voiced fricative, voiceless fricative, closure and burst. Landmark
signs `g`, `s` and `b` mark voicing, sonorant and burst/frication changes.
Times and the hop are seconds; strengths are dB.

```js
import {
  createFrameAnalyzer,
  createLandmarkDetector,
  findLandmarks,
} from 'voice-simulator';

const analyzer = createFrameAnalyzer(16000);
const detector = createLandmarkDetector(analyzer.frames);
analyzer.push(chunk);
const newlyConfirmedNuclei = detector.advance();
analyzer.flush();
detector.advance(true); // drain at the end of the recording
const batch = findLandmarks(analyzer.frames);
```

`options.thresholds` overrides the documented tree's numeric thresholds.
Streaming arrays before `committed` remain fixed. Detections are appended;
nucleus boundaries are completed as following minima arrive. Recreate a
stage after trimming or resetting the analyzer. The command
`voice-simulator landmarks recording.wav` writes the same result as JSON;
`-o landmarks.json` saves it to a file.

When a following peak reveals a deeper boundary minimum, both `end` and
`strength` are updated. Strength remains the peak sonority minus the lower
sonority at the two reported boundaries.

These APIs provide acoustic guesses, not reliable phonetic labels. Following
[the owner's acceptance revision](https://github.com/konard/voice-simulator/pull/142#issuecomment-6947242499),
the fixed-rule stage has an explicit causal contract:

- `committed = max(0, count - ceil(0.06 / hop))` during streaming, and
  `count` after `advance(true)`. Class labels before it never change.
  Batch cleanup has the whole recording and can relabel a bounded silence
  run as closure. Streaming preserves a silence label already committed
  before the run closes. Finalization drains pending frames; it does not
  revise earlier commitments. Exact batch/stream class equality is not
  promised.
- Confirmed nucleus times never change. A later higher peak inside the
  80 ms exclusion interval cannot replace a confirmed peak. Replacement
  applies only to pending peaks. `start`, `end` and `strength` can be
  refined by later minima. On the specified four-language synthetic set,
  20 ms chunks report nuclei within 150 ms and their times match batch
  within 10 ms. The latency check includes front-end buffering and chunk
  delivery; call `advance(true)` after flushing to drain the recording end.

Run the regression and measurement suite:

```sh
node --test tests/recognition-landmarks.test.js tests/recognition-landmark-rules.test.js tests/recognition-landmark-streaming.test.js
```

| Measurement                 | Observed |              Regression limit | Original quality goal |
| --------------------------- | -------: | ----------------------------: | --------------------: |
| Nucleus recall within 50 ms | 63.3333% |                          ≥60% |                  ≥90% |
| Extra nuclei / true nuclei  | 33.3333% |                          ≤35% |                  ≤10% |
| Class accuracy, 16 kHz      | 48.2459% |                          ≥46% |                  ≥85% |
| Class accuracy, 8 kHz       | 47.1143% |                          ≥45% |                  ≥80% |
| Planned edges within 20 ms  |     6/10 | 2 apa + 2 asa + 0 ama + 2 aba |                 10/10 |
| Golden syllable-count MARE  |   24.41% |                 Measured only |                  ≤15% |

The sentence set uses English, Russian, Hindi and Mandarin, male and female
presets, 16 and 8 kHz, seed 1 and the JavaScript waveguide solver. Truth is
unchanged: planned vowel-group centres and segment classes, excluding
10 ms at class boundaries. The tests print every sentence's counts,
per-rate class confusion and every missing edge. The
[versioned limits](../tests/fixtures/landmark-quality.json) protect against
regression; they do not imply that the original quality goals were met.
Controlled feature tests independently require all six landmark signs and
the entire class tree, including rejection and cleanup cases.

The original rules admit at most 98 of 120 synthetic reference centres
(81.67%) before any candidate filtering. The two former timing conflicts
and edge-placement counterexamples are retained in the
[historical investigation](case-studies/issue-62/README.md). The current
contract resolves the timing choices explicitly and keeps the accuracy
shortfall visible. These guesses should not exclude phoneme candidates
unconditionally in downstream decoding.

Run `node scripts/calibrate-landmarks.mjs` to regenerate thresholds. The
mean-class-recall objective does not depend on nucleus thresholds, so tied
coordinates retain their initial 10 dB above noise and 2 dB dip. Run
`npm run test:heavy -- --suite recognition` for calibration stability and
syllable counts on the golden recordings. The
[golden report](case-studies/issue-62/golden-report.md) includes every count
and flags transcripts still awaiting human review.
