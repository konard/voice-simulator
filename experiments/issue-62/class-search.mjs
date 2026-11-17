/** Diagnostic only: optimize sentence accuracy with the prescribed tree.
 * This is not calibration: held-out test labels must not set shipped values.
 * Finite search: 3 rounds x 7 coordinates x 21 choices, 16 short renders. */
import {
  synthesize,
  presetHeadConfig,
  analyzeFrames,
} from '../../src/index.js';
import {
  frameTruth,
  sonorityOf,
  peakCurve,
} from '../../scripts/landmark-material.mjs';
import {
  classifyFrame,
  cleanClasses,
  landmarkCandidates,
} from '../../src/recognition/landmark-signals.js';
import {
  INITIAL_THRESHOLDS,
  SEARCH_RANGES,
} from '../../scripts/calibrate-landmarks.mjs';

const material = [];
for (const [lang, text] of [
  ['en', 'The north wind and the sun were disputing which was the stronger.'],
  ['ru', 'Мама мыла раму.'],
  ['hi', 'नमस्ते दुनिया'],
  ['zh', '你好世界'],
]) {
  for (const preset of ['male', 'female']) {
    for (const rate of [16000, 8000]) {
      const out = synthesize(text, {
        lang,
        head: presetHeadConfig(preset),
        solver: 'waveguide',
        engine: 'js',
        sampleRate: rate,
        seed: 1,
      });
      const frames = analyzeFrames(out.samples, rate);
      const sonority = sonorityOf(frames);
      material.push({
        frames,
        sonority,
        peak: peakCurve(sonority, frames.hop),
        truth: frameTruth(out.plan, frames),
        bursts: landmarkCandidates(frames, 9).filter((l) => l.type === 'b+'),
      });
    }
  }
}
function score(T, verbose = false) {
  let found = 0,
    total = 0;
  for (const rate of [16000, 8000]) {
    let correct = 0,
      labelled = 0;
    for (const { frames: f, sonority: s, peak, truth, bursts } of material) {
      if (f.rate !== rate) {
        continue;
      }
      const raw = new Uint8Array(f.count);
      for (let t = 0; t < f.count; t++) {
        const earlier = Math.max(0, t - Math.round(0.02 / f.hop));
        const burst =
          (raw[earlier] === 0 || raw[earlier] === 6) &&
          bursts.some((l) => l.t <= t && (t - l.t) * f.hop <= 0.02 + 1e-9);
        raw[t] = classifyFrame(f, s, t, peak[t], burst, T);
      }
      const classes = cleanClasses(raw, f.count, f.hop);
      for (let t = 0; t < f.count; t++) {
        if (truth[t] < 0) {
          continue;
        }
        labelled++;
        if (truth[t] === classes[t]) {
          correct++;
        }
      }
    }
    if (verbose) {
      console.log(
        JSON.stringify({
          rate,
          correct,
          labelled,
          accuracy: correct / labelled,
        })
      );
    }
    found += correct;
    total += labelled;
  }
  return found / total;
}
const T = { ...INITIAL_THRESHOLDS };
let best = score(T);
console.log('initial', best);
for (let round = 0; round < 3; round++) {
  for (const [key, [low, high]] of Object.entries(SEARCH_RANGES).slice(0, 7)) {
    let chosen = T[key];
    for (let step = 0; step <= 20; step++) {
      T[key] = low + ((high - low) * step) / 20;
      const accuracy = score(T);
      if (accuracy > best) {
        best = accuracy;
        chosen = T[key];
      }
    }
    T[key] = chosen;
  }
  console.log(JSON.stringify({ round, best, thresholds: T }));
}
score(T, true);
