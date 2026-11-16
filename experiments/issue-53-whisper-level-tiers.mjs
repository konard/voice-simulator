// Level of a whispered [a] at tiers medium (waveguide) and high (fdtd3d)
// for the current WHISPER_OPENING (issue 53): the open glottis must not
// absorb the whisper source at fdtd3d. Usage:
//   node experiments/issue-53-whisper-level-tiers.mjs [text]
import { synthesize } from '../src/index.js';
import { WHISPER_OPENING } from '../src/acoustics/whisper.js';

const text = process.argv[2] ?? '{W ˈa W}';
const level = (samples) => {
  let sum = 0;
  for (const value of samples) {
    sum += value * value;
  }
  return 10 * Math.log10(sum / samples.length + 1e-30);
};
const row = [`opening ${WHISPER_OPENING}`];
for (const tier of ['medium', 'high']) {
  const result = synthesize(text, { tier, seed: 1, ipa: true, headroom: 20 });
  row.push(`${tier} ${level(result.samples).toFixed(1)} dB`);
}
console.log(row.join('  '));
