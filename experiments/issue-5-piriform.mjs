// Piriform fossae side branch: spectrum of sustained vowels with and without.
// Usage: [RATE=32000] node experiments/issue-5-piriform.mjs
import { renderPlan } from '../src/acoustics/voice.js';
import { planUtterance } from '../src/articulation/plan.js';

const RATE = Number(process.env.RATE ?? 32000);
const SIZE = 1024;
const BANDS = [
  [0, 2000],
  [2000, 3500],
  [3500, 4300],
  [4300, 5300],
  [5300, 7000],
];

/** Welch power spectrum (Hann, half overlap) of samples[start, end). */
function spectrum(samples, start, end) {
  const power = new Float64Array(SIZE / 2);
  let frames = 0;
  for (let offset = start; offset + SIZE <= end; offset += SIZE / 2) {
    for (let bin = 0; bin < SIZE / 2; bin++) {
      let re = 0;
      let im = 0;
      for (let i = 0; i < SIZE; i++) {
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / SIZE);
        const value = samples[offset + i] * w;
        const phase = (2 * Math.PI * bin * i) / SIZE;
        re += value * Math.cos(phase);
        im -= value * Math.sin(phase);
      }
      power[bin] += re * re + im * im;
    }
    frames++;
  }
  return power.map((value) => value / Math.max(1, frames));
}

function band(power, low, high) {
  let sum = 0;
  for (let bin = 0; bin < power.length; bin++) {
    const frequency = (bin * RATE) / SIZE;
    if (frequency >= low && frequency < high) {
      sum += power[bin];
    }
  }
  return 10 * Math.log10(sum + 1e-30);
}

for (const text of ['ˈɑː', 'ˈiː', 'ˈəː']) {
  const plan = planUtterance(text);
  const vowel = plan.segments.find((entry) => entry.kind === 'vowel');
  const start = Math.round((vowel.start + 0.05) * RATE);
  const end = Math.round((vowel.end - 0.05) * RATE);
  const levels = [true, false].map((piriform) => {
    const samples = renderPlan(plan, { sampleRate: RATE, piriform });
    const power = spectrum(samples, start, end);
    return BANDS.map(([low, high]) => band(power, low, high));
  });
  console.log(
    text,
    'dB change',
    BANDS.map(
      ([low, high], i) =>
        `${low}-${high}: ${(levels[0][i] - levels[1][i]).toFixed(1)}`
    ).join(', ')
  );
}
