// Smoke render with folds and with folds + interaction.
// Usage: node experiments/issue-34-smoke.mjs [ipa] [tier]
import { synthesize } from '../src/index.js';
import { estimatePitch, rms } from '../src/acoustics/analysis.js';

const ipa = process.argv[2] ?? 'ˈɑː';
const tier = process.argv[3] ?? 'medium';
for (const interaction of [false, true]) {
  const started = performance.now();
  const { samples, sampleRate } = synthesize(ipa, { ipa: true, source: 'folds', interaction, tier });
  const ms = performance.now() - started;
  const from = Math.floor(samples.length * 0.3);
  const to = Math.floor(samples.length * 0.7);
  const finite = samples.every(Number.isFinite);
  const pitch = estimatePitch(samples, sampleRate, { start: from / sampleRate });
  console.log(
    `interaction=${interaction} finite=${finite} rms=${rms(samples, from, to).toFixed(4)} pitch=${pitch.toFixed(1)} ms=${ms.toFixed(0)}`
  );
}
