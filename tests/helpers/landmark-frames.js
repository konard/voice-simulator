/** Two voiced peaks, with a shallow early valley and a deeper inter-peak
 * minimum. Tests supply features directly to isolate the landmark stage. */
import { analyzeFrames } from '../../src/recognition/frontend.js';

export function boundaryFrames(trailingSilence = false) {
  const frames = analyzeFrames(new Float32Array(4000), 8000);
  frames.noise.fill(-100);
  frames.periodicity.fill(0.9);
  frames.speech.fill(1);
  const points = [
    [0, -20],
    [20, 20],
    [26, -10],
    [32, 8],
    [44, -30],
    [66, 15],
    [90, -50],
    [99, -50],
  ];
  for (let t = 0, part = 0; t < frames.count; t++) {
    while (part + 2 < points.length && t > points[part + 1][0]) {
      part++;
    }
    const [left, low] = points[part];
    const [right, high] = points[part + 1];
    const db = low + ((high - low) * (t - left)) / (right - left);
    frames.mel.fill(
      (db * Math.LN10) / 10,
      t * frames.melBands,
      (t + 1) * frames.melBands
    );
    if (trailingSilence && t >= 85) {
      frames.speech[t] = 0;
    }
  }
  return frames;
}
