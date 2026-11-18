// Unlicense. Issue 63: no-transcript stage A speechRate from landmark nuclei
// (findLandmarks, default 16 / 3.27) versus the legacy envelope count
// (10 / 3.27) on the heavy suite's twenty seeded heads and the test heads.
import { synthesize, createRandom, DEFAULT_HEAD } from '../../src/index.js';
import { analyzeFrames } from '../../src/recognition/frontend.js';
import { findLandmarks } from '../../src/recognition/landmarks.js';
import { analyzeLegacyVoice } from '../../src/analysis/voice-features.js';
import { MATCH_TEXT } from '../../src/analysis/voice-fit-calibration.js';
const TEXT =
  'The north wind and the sun were disputing which was the stronger.';
const count = (samples, sampleRate) => {
  const legacy = analyzeLegacyVoice(samples, sampleRate, {
    sourceDiagnostics: false,
  });
  const speech = Math.min(
    samples.length / sampleRate,
    legacy.activeDuration + 0.03
  );
  return {
    speech,
    landmark: findLandmarks(analyzeFrames(samples, sampleRate)).nuclei.length,
    legacy: Math.round(legacy.syllableRate * legacy.activeDuration),
  };
};
const render = (text, head) =>
  synthesize(text, {
    head,
    seed: 1,
    sampleRate: 16000,
    solver: 'waveguide',
    engine: 'js',
  });
const base = (() => {
  const { samples, sampleRate } = render(MATCH_TEXT, DEFAULT_HEAD);
  return count(samples, sampleRate);
})();
console.log('default', JSON.stringify(base));
const cases = [];
for (let seed = 1; seed <= 20; seed++) {
  const random = createRandom(seed),
    range = (a, b) => a + (b - a) * random();
  cases.push([
    `seed${seed}`,
    TEXT,
    {
      ...DEFAULT_HEAD,
      vocalTractLength: range(12, 19),
      pitch: range(90, 260),
      tenseness: range(0.3, 0.9),
      speechRate: range(0.8, 1.25),
      breathiness: range(0.1, 0.9),
    },
  ]);
}
cases.push([
  'A',
  'The north wind and the sun.',
  { vocalTractLength: 14, pitch: 210, tenseness: 0.45, speechRate: 1.15 },
]);
cases.push([
  'B',
  'The north wind and the sun.',
  { vocalTractLength: 18.5, pitch: 100, tenseness: 0.75, speechRate: 0.9 },
]);
const err = { landmark: [], legacy: [] };
for (const [name, text, head] of cases) {
  const { samples, sampleRate } = render(text, head);
  const c = count(samples, sampleRate),
    row = { name, truth: +head.speechRate.toFixed(3) };
  for (const k of ['landmark', 'legacy']) {
    const rate = c[k] / c.speech / (base[k] / base.speech);
    row[k] = +rate.toFixed(3);
    if (name.startsWith('seed')) {
      err[k].push(Math.abs(rate / head.speechRate - 1));
    }
  }
  console.log(JSON.stringify({ ...row, ...c }));
}
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return (s[9] + s[10]) / 2;
};
console.log(
  'median relative error over seeds',
  JSON.stringify({ landmark: median(err.landmark), legacy: median(err.legacy) })
);
