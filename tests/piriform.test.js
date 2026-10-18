/**
 * Piriform fossae side branch of the waveguide: an antiresonance near
 * 4-5 kHz that leaves the low formant region alone.
 */

import { describe, it, expect } from 'test-anywhere';
import { renderPlan } from '../src/acoustics/voice.js';
import { Waveguide } from '../src/acoustics/waveguide.js';
import { planUtterance } from '../src/articulation/plan.js';

const RATE = 32000;
const SIZE = 512;

/** Mean power (dB) of `samples` between `low` and `high` Hz. */
function bandLevel(samples, start, end, low, high) {
  let sum = 0;
  for (let offset = start; offset + SIZE <= end; offset += SIZE) {
    for (let frequency = low; frequency < high; frequency += RATE / SIZE) {
      let re = 0;
      let im = 0;
      for (let i = 0; i < SIZE; i++) {
        const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / SIZE);
        const phase = (2 * Math.PI * frequency * i) / RATE;
        re += samples[offset + i] * window * Math.cos(phase);
        im += samples[offset + i] * window * Math.sin(phase);
      }
      sum += re * re + im * im;
    }
  }
  return 10 * Math.log10(sum);
}

describe('piriform fossae', () => {
  it('adds a closed side branch to the lower pharynx', () => {
    const solver = new Waveguide({ sections: 44 });
    expect(solver.piriform.right.length).toBeGreaterThan(3);
    expect(solver.piriform.index).toBeGreaterThan(3);
    expect(solver.piriform.index).toBeLessThan(10);
    const plain = new Waveguide({ sections: 44, piriform: false });
    expect(plain.piriform.right.length).toBe(0);
  });

  it('puts a dip near 4-5 kHz into vowels', () => {
    const plan = planUtterance('ˈɑː');
    const vowel = plan.segments.find((entry) => entry.kind === 'vowel');
    const start = Math.round((vowel.start + 0.05) * RATE);
    const end = Math.min(start + 4 * SIZE, Math.round(vowel.end * RATE));
    const [withBranch, without] = [true, false].map((piriform) => {
      const samples = renderPlan(plan, { sampleRate: RATE, piriform });
      return {
        low: bandLevel(samples, start, end, 300, 1500),
        dip: bandLevel(samples, start, end, 3500, 5300),
      };
    });
    expect(withBranch.dip).toBeLessThan(without.dip - 2);
    expect(Math.abs(withBranch.low - without.low)).toBeLessThan(1);
  });
});
