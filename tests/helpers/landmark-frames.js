/** Two voiced peaks, with a shallow early valley and a deeper inter-peak
 * minimum. Tests supply features directly to isolate the landmark stage. */
import { analyzeFrames } from '../../src/recognition/frontend.js';
import { createRandom } from '../../src/random.js';

/** Isolated features with a quiet mel floor, suitable for analytic rules. */
export function ruleFrames(hop = 0.005, seconds = 0.8) {
  const frames = analyzeFrames(new Float32Array(16000 * seconds), 16000, {
    hop,
  });
  frames.energy.fill(-20);
  frames.noise.fill(-80);
  frames.speech.fill(1);
  frames.periodicity.fill(0.9);
  frames.zcr.fill(0);
  frames.gravity.fill(0);
  frames.band.fill(-40);
  frames.mel.fill(-30);
  return frames;
}

/** Short seeded band walks expose suppression across streaming windows. */
export function candidateFrames(seed = 5) {
  const count = 160;
  const random = createRandom(seed);
  const frames = {
    rate: 16000,
    hop: 0.005,
    count,
    capacity: count,
    startTime: 0,
    melBands: 24,
    mel: new Float32Array(count * 24).fill(-20),
    band: new Float32Array(count * 6),
    energy: new Float32Array(count).fill(-10),
    noise: new Float32Array(count).fill(-80),
    speech: new Uint8Array(count).fill(1),
    periodicity: new Float32Array(count),
    zcr: new Float32Array(count),
    gravity: new Float32Array(count),
    tilt: new Float32Array(count),
  };
  for (let t = 0; t < count; t++) {
    frames.periodicity[t] = Math.floor(t / 13) % 2;
    for (let b = 0; b < 6; b++) {
      const prior = t ? frames.band[(t - 1) * 6 + b] : -30;
      frames.band[t * 6 + b] = prior + (random() - 0.5) * 20;
    }
  }
  return frames;
}

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
