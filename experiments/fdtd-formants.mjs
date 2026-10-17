// Render sustained vowels with the 3D FDTD solver and compare LPC formants
// with the chain-matrix formants of the same tract shape.
// Usage: node experiments/fdtd-formants.mjs [dx] [flow|microphone]
import { performance } from 'node:perf_hooks';
import { planUtterance } from '../src/articulation/plan.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';
import {
  estimateFormants,
  estimatePitch,
  rms,
} from '../src/acoustics/analysis.js';
import { tubeFormants } from '../src/acoustics/transfer.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { getPhoneme } from '../src/ipa/inventory.js';

const dx = Number(process.argv[2] ?? 0.8);
const output = process.argv[3] ?? 'flow';
const rate = 24000;
const model = buildVoxelModel(DEFAULT_HEAD, { dx });
for (const symbol of ['i', 'e', 'a', 'ɑ', 'o', 'u', 'ə']) {
  const plan = planUtterance(`ˈ${symbol}ː`);
  const start = performance.now();
  const fdtd = renderPlan(plan, {
    sampleRate: rate,
    solver: 'fdtd3d',
    model,
    output,
  });
  const elapsed = (performance.now() - start) / 1000;
  const wave = renderPlan(plan, { sampleRate: rate });
  const vowel = plan.segments.find((s) => s.kind === 'vowel');
  const middle = (vowel.start + vowel.end) / 2;
  const window = { start: middle - 0.03, duration: 0.06, count: 3 };
  const lpc = estimateFormants(fdtd, rate, window);
  const waveLpc = estimateFormants(wave, rate, window);
  const pitch = estimatePitch(fdtd, rate, { start: middle - 0.03 });
  const shape = tractShape(
    { ...vowelTarget({ phoneme: getPhoneme(symbol) }), rhotic: 0 },
    DEFAULT_HEAD
  );
  const tube = tubeFormants(shape.areas, shape.length, { count: 3 });
  const range = [Math.floor(vowel.start * rate), Math.floor(vowel.end * rate)];
  console.log(
    symbol,
    'fdtd',
    lpc.map(Math.round).join(' ').padEnd(16),
    'wave',
    waveLpc.map(Math.round).join(' ').padEnd(16),
    'tube',
    tube.map(Math.round).join(' ').padEnd(16),
    'f0',
    pitch.toFixed(1),
    'rms fdtd/wave',
    (rms(fdtd, ...range) / rms(wave, ...range)).toFixed(2),
    'x realtime',
    (plan.duration / elapsed).toFixed(2)
  );
}
