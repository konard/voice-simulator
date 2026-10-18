// Issue 5: microphone position, room reverb and the FDTD enclosure.
// Prints level and onset of the output for several listening settings.
// Usage: node experiments/issue-5-mic-room.mjs
import { renderPlan, planUtterance } from '../src/index.js';

const plan = planUtterance('ɑ', { language: 'ipa' });
const sampleRate = 24000;

function stats(samples) {
  let energy = 0;
  let peak = 0;
  let onset = -1;
  for (let index = 0; index < samples.length; index++) {
    const value = samples[index];
    energy += value * value;
    peak = Math.max(peak, Math.abs(value));
    if (onset < 0 && Math.abs(value) > 1e-4) {
      onset = index;
    }
  }
  return {
    samples: samples.length,
    rms: Math.sqrt(energy / samples.length).toExponential(3),
    peak: peak.toFixed(4),
    onsetMs: ((onset / sampleRate) * 1000).toFixed(3),
    finite: samples.every(Number.isFinite),
  };
}

const cases = [
  ['waveguide default', {}],
  ['waveguide mic 3 cm', { microphone: { distance: 3 } }],
  ['waveguide mic 30 cm', { microphone: { distance: 30 } }],
  ['waveguide mic 100 cm side', { microphone: { distance: 100, azimuth: 90 } }],
  [
    'waveguide mic 100 cm compensate',
    { microphone: { distance: 100, compensate: true } },
  ],
  ['waveguide studio 3 cm', { room: 'studio' }],
  [
    'waveguide hall 100 cm comp',
    { room: 'hall', microphone: { distance: 100, compensate: true } },
  ],
  [
    'waveguide enclosure',
    { enclosure: { width: 40, height: 50, depth: 40, absorption: 0.2 } },
  ],
  ['fdtd3d flow default', { solver: 'fdtd3d', dx: 1 }],
  ['fdtd3d mic 3 cm', { solver: 'fdtd3d', dx: 1, microphone: { distance: 3 } }],
  [
    'fdtd3d mic 10 cm',
    { solver: 'fdtd3d', dx: 1, microphone: { distance: 10 } },
  ],
  [
    'fdtd3d mic 30 cm',
    { solver: 'fdtd3d', dx: 1, microphone: { distance: 30 } },
  ],
  [
    'fdtd3d enclosure',
    {
      solver: 'fdtd3d',
      dx: 1,
      enclosure: { width: 40, height: 50, depth: 40, absorption: 0.2 },
    },
  ],
];

for (const [label, options] of cases) {
  const started = globalThis.performance.now();
  const samples = renderPlan(plan, { sampleRate, ...options });
  const seconds = (globalThis.performance.now() - started) / 1000;
  console.log(
    label.padEnd(34),
    JSON.stringify(stats(samples)),
    seconds.toFixed(2),
    's'
  );
}
