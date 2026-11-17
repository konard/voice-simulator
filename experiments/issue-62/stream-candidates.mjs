/** Finite batch/stream comparison with generated frame features. No audio
 * rendering or builds; run with node --max-old-space-size=64. */
import { findLandmarks, createLandmarkDetector } from '../../src/index.js';
import { candidateFrames } from '../../tests/helpers/landmark-frames.js';

for (let seed = 0; seed < 128; seed++) {
  const frames = candidateFrames(seed);
  const count = frames.count;
  const batch = findLandmarks(frames).landmarks;
  for (const chunk of [1, 2, 4, 8]) {
    frames.count = 0;
    const detector = createLandmarkDetector(frames);
    while (frames.count < count) {
      frames.count = Math.min(count, frames.count + chunk);
      detector.advance();
    }
    detector.advance(true);
    const stream = detector.output.landmarks;
    if (JSON.stringify(stream) !== JSON.stringify(batch)) {
      console.log(JSON.stringify({ seed, chunk, batch, stream }, null, 2));
      process.exitCode = 1;
      break;
    }
  }
  if (process.exitCode) {
    break;
  }
}
