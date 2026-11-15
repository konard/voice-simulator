// Level of ˈama with the 2D sheet against the waveguide (medium tier):
// node experiments/issue-37-loudness.mjs
import { synthesize } from '../src/index.js';
import { rms } from '../src/acoustics/analysis.js';
import { performance } from 'node:perf_hooks';

function levels(options) {
  const start = performance.now();
  const { samples, sampleRate, plan } = synthesize('ˈama', {
    ipa: true,
    seed: 1,
    ...options,
  });
  const ms = performance.now() - start;
  const level = (kind) => {
    const segment = plan.segments.find((item) => item.kind === kind);
    const centre = Math.round(((segment.start + segment.end) / 2) * sampleRate);
    const half = Math.round(0.015 * sampleRate);
    return rms(samples, centre - half, centre + half);
  };
  return {
    finite: samples.every(Number.isFinite),
    rms: rms(samples),
    vowel: level('vowel'),
    nasal: level('consonant'),
    ms: Math.round(ms),
  };
}
const medium = levels({ tier: 'medium' });
const sheet = levels({ solver: 'fdtd2d' });
console.log('medium', medium);
console.log('fdtd2d', sheet);
console.log(
  'rms ratio dB',
  (20 * Math.log10(sheet.rms / medium.rms)).toFixed(2)
);
console.log(
  'nasal/vowel',
  (sheet.nasal / sheet.vowel).toFixed(3),
  'medium',
  (medium.nasal / medium.vowel).toFixed(3)
);
