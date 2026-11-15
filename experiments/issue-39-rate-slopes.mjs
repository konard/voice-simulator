/**
 * Issue 39: re-measure SYLLABLE_RATE.slope and SPEAKING_TIME.slope of
 * src/analysis/voice-match.js after the duration model, in the way of
 * experiments/issue-5-syllable-rate.mjs and issue-5-voice-sensitivity.mjs:
 * render two sentences with both presets at several speech rates and fit
 * the least-squares slope of log(syllableRate) and of -log(activeDuration)
 * against log(speechRate). Output: experiments/issue-39-rate-slopes.txt.
 * Usage: node experiments/issue-39-rate-slopes.mjs [path to src]
 */
const root = process.argv[2] ?? '../src';
const { synthesize } = await import(`${root}/synthesize.js`);
const { analyzeVoice } = await import(`${root}/analysis/voice-features.js`);
const { presetHeadConfig } = await import(`${root}/head-config.js`);

const TEXTS = [
  'The north wind and the sun were disputing which was the stronger.',
  'Please call Stella and ask her to bring these things with her.',
];
// The range voice matching moves in: maxStep 0.15 to 0.4 in log space
// around 1, and the 0.7 to 1.8 of issue-5-syllable-rate.mjs.
const RATES = [0.7, 0.85, 1, 1.25, 1.5, 1.8];

function slope(points) {
  const n = points.length;
  const mx = points.reduce((sum, p) => sum + p.x, 0) / n;
  const my = points.reduce((sum, p) => sum + p.y, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (const p of points) {
    numerator += (p.x - mx) * (p.y - my);
    denominator += (p.x - mx) ** 2;
  }
  return numerator / denominator;
}

const syllable = [];
const speaking = [];
for (const preset of ['male', 'female']) {
  for (const text of TEXTS) {
    const row = [preset.padEnd(6), text.slice(0, 12)];
    for (const speechRate of RATES) {
      const head = { ...presetHeadConfig(preset), speechRate };
      const { samples, sampleRate } = synthesize(text, {
        head,
        sampleRate: 16000,
        solver: 'waveguide',
      });
      const f = analyzeVoice(samples, sampleRate);
      const x = Math.log(speechRate);
      syllable.push({ x, y: Math.log(f.syllableRate) });
      speaking.push({ x, y: -Math.log(f.activeDuration) });
      row.push(
        `${speechRate}: rate ${f.syllableRate.toFixed(2)} active ${f.activeDuration.toFixed(2)}`
      );
    }
    console.log(row.join(' | '));
  }
}
const central = (points) =>
  points.filter((p) => p.x >= Math.log(0.85) - 1e-9 && p.x <= Math.log(1.25));
console.log(
  `SYLLABLE_RATE.slope (d log syllableRate / d log speechRate): ${slope(syllable).toFixed(2)}, 0.85 to 1.25: ${slope(central(syllable)).toFixed(2)}`
);
console.log(
  `SPEAKING_TIME.slope (d -log activeDuration / d log speechRate): ${slope(speaking).toFixed(2)}, 0.85 to 1.25: ${slope(central(speaking)).toFixed(2)}`
);
