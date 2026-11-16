// Issue 56: does the level of the laugh calls follow the harmonics of f0
// through the tract transfer? Compares the measured peak of each call with
// sum_k |T(k f0)|^2 (k f0)^-slope at the middle of the call vowel.
// node experiments/issue-56-harmonics.mjs [shifts]
import { synthesize } from '../src/index.js';
import { sampleState, tractShape } from '../src/articulation/tract-shape.js';
import { tubeTransfer } from '../src/acoustics/transfer.js';
import { callPeaks } from './issue-56-laugh-peaks.mjs';

const slope = Number(process.env.SLOPE ?? 2);
const shifts = process.argv[2]
  ? process.argv[2].split(',').map(Number)
  : [-2, -1, 0, 1, 2];
for (const shift of shifts) {
  const text = `<speak>Yes <prosody pitch="${shift >= 0 ? '+' : ''}${shift}st"><vs:sound name="laugh"/></prosody></speak>`;
  const result = synthesize(text, { tier: 'medium', seed: 1, markup: true });
  const { plan, head } = result;
  const sound = plan.sounds[0];
  const peaks = callPeaks(result);
  const predicted = peaks.map((_, k) => {
    const time = sound.start + 0.2 * k + 0.15;
    const state = sampleState(plan, time);
    const { areas, length } = tractShape(state, head);
    const f0 = state.f0;
    let power = 0;
    for (let h = 1; h * f0 < 5000; h++) {
      const t = tubeTransfer(areas, length, h * f0, { head });
      power += (t * t) / h ** slope;
    }
    return {
      f0,
      level: 10 * Math.log10(power) + 20 * Math.log10(state.loudness),
    };
  });
  console.log(
    shift,
    'measured',
    peaks.map((p) => p.level.toFixed(1)).join(' '),
    '| predicted',
    predicted.map((p) => p.level.toFixed(1)).join(' '),
    '| f0',
    predicted.map((p) => p.f0.toFixed(0)).join(' ')
  );
}
