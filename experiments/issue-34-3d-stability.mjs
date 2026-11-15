/**
 * Probe: stability of the source-tract interaction on the 3D tiers. For
 * each tier and text, the RMS of the whole output and of 50 ms frames
 * with the fold source, without and with the interaction.
 *
 *   node experiments/issue-34-3d-stability.mjs [tier ...] [-- text]
 */
import { synthesize } from '../src/synthesize.js';

const separator = process.argv.indexOf('--');
const tiers =
  separator === -1 ? process.argv.slice(2) : process.argv.slice(2, separator);
const text = separator === -1 ? 'Hello.' : process.argv[separator + 1];

function level(samples, from = 0, end = samples.length) {
  const to = Math.min(end, samples.length);
  let sum = 0;
  for (let index = from; index < to; index++) {
    sum += samples[index] * samples[index];
  }
  return Math.sqrt(sum / Math.max(1, to - from));
}

for (const tier of tiers.length > 0 ? tiers : ['medium', 'high', 'studio']) {
  const plain = synthesize(text, { tier, source: 'folds', seed: 1 });
  const coupled = synthesize(text, {
    tier,
    source: 'folds',
    interaction: true,
    seed: 1,
  });
  const frame = Math.round(0.05 * coupled.sampleRate);
  const frames = (samples) => {
    const values = [];
    for (let from = 0; from < samples.length; from += frame) {
      values.push(level(samples, from, from + frame).toFixed(3));
    }
    return values.join(' ');
  };
  console.log(
    `${tier}: rms ${level(plain.samples).toFixed(4)} without, ` +
      `${level(coupled.samples).toFixed(4)} with interaction; ` +
      `finite ${coupled.samples.every(Number.isFinite)}`
  );
  console.log(`  50 ms frames without: ${frames(plain.samples)}`);
  console.log(`  50 ms frames with:    ${frames(coupled.samples)}`);
}
