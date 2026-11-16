// Issue 56: `[click]` against the click letter `ǀ` (plans) and the length
// of the burst: the time its 1 ms level stays within 10 dB of its peak.
// node experiments/issue-56-click.mjs
import { levelDb, synthesize } from '../src/index.js';

const BASE = { tier: 'medium', seed: 1 };
const sound = synthesize('[click]', { ...BASE, markup: true });
const letter = synthesize('ǀ', { ...BASE, ipa: true });
const strip = (plan) =>
  JSON.stringify({ channels: plan.channels, duration: plan.duration });
console.log(
  'ipa',
  sound.ipa,
  '| plans equal',
  strip(sound.plan) === strip(letter.plan)
);
console.log(
  'samples equal',
  sound.samples.every((v, i) => v === letter.samples[i])
);
const { samples, sampleRate } = sound;
const hop = Math.round(0.001 * sampleRate);
const curve = [];
for (let i = 0; i + hop <= samples.length; i += hop) {
  curve.push(levelDb(samples, i, i + hop));
}
const peak = Math.max(...curve);
const loud = curve.flatMap((v, i) => (v > peak - 10 ? [i] : []));
console.log(
  'peak',
  peak.toFixed(1),
  'dBFS at',
  curve.indexOf(peak),
  'ms; burst',
  loud.at(-1) - loud[0] + 1,
  'ms'
);
console.log(curve.map((v) => v.toFixed(0)).join(' '));
