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

These APIs are experimental. The prescribed voiced local maxima cover only
98 of 120 synthetic reference centres (81.67%, before any detection filters),
below issue 62's 90% requirement. Also, deciding whether a silence run is
shorter than 150 ms requires more future sound than the requested 60 ms
commitment deadline. Batch clean-up relabels such bounded runs as closure;
a stream preserves committed labels. Reproductions and remaining acceptance
criteria are in [the issue 62 investigation](case-studies/issue-62/README.md).
Run `node scripts/calibrate-landmarks.mjs` to regenerate thresholds and
`npm run test:heavy -- --suite recognition` for calibration stability and
syllable counts on the golden recordings. No accuracy target is claimed met.
