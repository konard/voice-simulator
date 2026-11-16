/**
 * The source state a renderer started in the middle of an utterance takes
 * over (issue 29): a Glottis that restores what another one saved goes on
 * sample for sample like the one that saved it, also in creaky voice
 * (double pulsing, issue 54), in falsetto (its low-pass) and with a raised
 * or lowered effort (the tilt filter, issue 35).
 */

import { describe, expect, it } from 'test-anywhere';

import { Glottis } from '../src/acoustics/glottis.js';
import { SOURCE_STATE } from '../src/engine/layout.js';

const RATE = 48000;
const DT = 1 / RATE;
const OPTIONS = { seed: 7, chink: 2 };

/**
 * Control at sample `n`: creak, then creak and falsetto, then falsetto;
 * 6 dB of effort, then -4 dB.
 */
function control(n) {
  return {
    f0: 110 + 20 * Math.sin(n / 4000),
    voicing: 1,
    aspiration: 0,
    closure: 0,
    loudness: 1,
    creak: n < 6000 ? 0.8 : n < 9000 ? 0.5 : 0,
    falsetto: n < 6000 ? 0 : 0.6,
    effort: n < 4500 ? 6 : -4,
  };
}

const noise = (n) => Math.sin(n * 12.9898) - Math.sin(n * 78.233);

/** Samples `from` to `to` of `glottis`, which has rendered up to `from`. */
function run(glottis, from, to) {
  const out = new Float64Array(to - from);
  for (let n = from; n < to; n++) {
    out[n - from] = glottis.step(DT, control(n), noise(n));
  }
  return out;
}

describe('Glottis saveState and restoreState (issue 29)', () => {
  it('saves SOURCE_STATE.LENGTH values', () => {
    expect(new Glottis(OPTIONS).saveState().length).toBe(SOURCE_STATE.LENGTH);
  });

  for (const at of [3001, 7003, 9500]) {
    it(`continues the same samples after a hand-over at sample ${at}`, () => {
      const whole = new Glottis(OPTIONS);
      const first = new Glottis(OPTIONS);
      run(whole, 0, at);
      run(first, 0, at);
      const state = first.saveState();
      const second = new Glottis({ ...OPTIONS, seed: 99 });
      second.restoreState(state);
      expect(Array.from(second.saveState())).toEqual(Array.from(state));
      const expected = run(whole, at, 12000);
      const actual = run(second, at, 12000);
      let different = 0;
      for (let index = 0; index < expected.length; index++) {
        if (expected[index] !== actual[index]) {
          different++;
        }
      }
      expect(different).toBe(0);
    });
  }
});
