// How the voice features respond to one head parameter at a time.
// Usage: node experiments/issue-5-voice-sensitivity.mjs [preset] [key...]
// With keys only those sweeps run. After each sweep the least-squares slope
// of every feature against the parameter is printed (issue 32 measured the
// slope of `breathiness` this way for CONTROLS in
// src/analysis/voice-match.js; output in
// experiments/issue-32-voice-sensitivity.txt).
import { synthesize } from '../src/synthesize.js';
import { analyzeVoice } from '../src/analysis/voice-features.js';
import { presetHeadConfig } from '../src/head-config.js';

const base = presetHeadConfig(process.argv[2] ?? 'female');
const only = process.argv.slice(3);
const sweeps = {
  tenseness: [0.3, 0.5, 0.7, 0.9],
  breathiness: [0, 0.05, 0.25, 0.5, 0.8, 1],
  aspirationLevel: [0.5, 1, 2],
  pitchRange: [1, 3, 6],
  speechRate: [0.8, 1, 1.25],
  vocalTractLength: [13, 15, 17],
};

function slope(points, feature) {
  const n = points.length;
  const mx = points.reduce((sum, p) => sum + p.x, 0) / n;
  const my = points.reduce((sum, p) => sum + p.f[feature], 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (const p of points) {
    numerator += (p.x - mx) * (p.f[feature] - my);
    denominator += (p.x - mx) ** 2;
  }
  return numerator / denominator;
}

for (const [key, values] of Object.entries(sweeps)) {
  if (only.length && !only.includes(key)) {
    continue;
  }
  const points = [];
  for (const value of values) {
    const { samples, sampleRate } = synthesize(
      'The north wind and the sun were disputing.',
      {
        head: { ...base, [key]: value },
        sampleRate: 16000,
        solver: 'waveguide',
      }
    );
    const f = analyzeVoice(samples, sampleRate);
    points.push({ x: value, f });
    console.log(
      `${key}=${value}`.padEnd(22),
      `f0 ${f.f0.toFixed(0)} range ${f.f0Range.toFixed(1)}`,
      `vtl ${f.vocalTractLength.toFixed(2)} h1h2 ${f.h1h2.toFixed(1)}`,
      `hnr ${f.hnr.toFixed(1)} rate ${f.syllableRate.toFixed(2)}`,
      `active ${f.activeDuration.toFixed(2)} voiced ${f.voicedDuration.toFixed(2)}`
    );
  }
  console.log(
    `${key} slope:`.padEnd(22),
    ['h1h2', 'hnr', 'f0Range', 'vocalTractLength']
      .map((feature) => `${feature} ${slope(points, feature).toFixed(2)}`)
      .join(' ')
  );
}
