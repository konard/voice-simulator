/** Seeded noise generators of the recognition noise baseline (issue 170). */
import assert from 'node:assert/strict';
import { describe, it } from 'test-anywhere';
import { addNoise, createNoise, NOISE_TYPES } from '../src/index.js';
import { fft } from '../src/metrics/spectrum.js';

const RATE = 16000;
const SIZE = 1024;

/** Mean power per octave band from 250 Hz to 4 kHz, in dB. */
function octaveLevels(samples) {
  const power = new Float64Array(SIZE / 2);
  for (let start = 0; start + SIZE <= samples.length; start += SIZE) {
    const re = Float64Array.from(samples.subarray(start, start + SIZE));
    const im = new Float64Array(SIZE);
    fft(re, im);
    for (let k = 0; k < SIZE / 2; k++) {
      power[k] += re[k] ** 2 + im[k] ** 2;
    }
  }
  const bin = (hz) => Math.round((hz * SIZE) / RATE);
  return [250, 500, 1000, 2000].map((low) => {
    let sum = 0;
    for (let k = bin(low); k < bin(2 * low); k++) {
      sum += power[k];
    }
    return 10 * Math.log10(sum / (bin(2 * low) - bin(low)));
  });
}

function rms(samples) {
  let energy = 0;
  for (const value of samples) {
    energy += value * value;
  }
  return Math.sqrt(energy / samples.length);
}

describe('noise generators (issue 170)', () => {
  it('has the spectral slope of each colour', () => {
    const slopes = {
      white: 0,
      pink: -3,
      brown: -6,
      blue: 3,
      violet: 6,
    };
    for (const [type, expected] of Object.entries(slopes)) {
      const levels = octaveLevels(createNoise(type, 4 * RATE, RATE));
      const slope = (levels.at(-1) - levels[0]) / (levels.length - 1);
      assert.ok(
        Math.abs(slope - expected) < 1.5,
        `${type}: ${slope.toFixed(2)} dB per octave`
      );
    }
  });

  it('makes every kind at the requested level and repeats a seed', () => {
    for (const type of NOISE_TYPES) {
      const noise = createNoise(type, RATE, RATE, { seed: 3, level: -30 });
      assert.equal(noise.length, RATE);
      assert.ok(noise.every(Number.isFinite), type);
      assert.ok(Math.abs(20 * Math.log10(rms(noise)) + 30) < 1e-3, type);
      assert.deepEqual(
        createNoise(type, RATE, RATE, { seed: 3, level: -30 }),
        noise
      );
      assert.notDeepEqual(
        createNoise(type, RATE, RATE, { seed: 4, level: -30 }),
        noise
      );
    }
  });

  it('puts the mains hum on 50 Hz or the given frequency', () => {
    for (const mains of [50, 60]) {
      const levels = new Map();
      const hum = createNoise('hum', RATE, RATE, { mains });
      for (const hz of [mains, 75, 1000]) {
        let re = 0;
        let im = 0;
        for (let i = 0; i < hum.length; i++) {
          re += hum[i] * Math.cos((2 * Math.PI * hz * i) / RATE);
          im += hum[i] * Math.sin((2 * Math.PI * hz * i) / RATE);
        }
        levels.set(hz, Math.hypot(re, im) / hum.length);
      }
      assert.ok(levels.get(mains) > 100 * levels.get(75));
      assert.ok(levels.get(mains) > 100 * levels.get(1000));
    }
  });

  it('adds noise at the signal-to-noise ratio without changing the input', () => {
    const speech = new Float32Array(RATE);
    for (let i = 0; i < speech.length; i++) {
      speech[i] = 0.2 * Math.sin((2 * Math.PI * 220 * i) / RATE);
    }
    const before = Float32Array.from(speech);
    for (const type of NOISE_TYPES) {
      for (const snr of [20, 0]) {
        const noisy = addNoise(speech, RATE, { type, snr, seed: 2 });
        const noise = noisy.map((value, i) => value - speech[i]);
        const measured = 20 * Math.log10(rms(speech) / rms(noise));
        assert.ok(Math.abs(measured - snr) < 0.01, `${type} at ${snr} dB`);
      }
    }
    assert.deepEqual(speech, before);
    assert.deepEqual(addNoise(speech, RATE, { snr: Infinity }), speech);
  });

  it('rejects unknown kinds and lengths', () => {
    assert.throws(() => createNoise('purple', 10, RATE), /Unknown noise type/);
    assert.throws(() => createNoise('white', -1, RATE), RangeError);
    assert.throws(() => addNoise([0.1], RATE, { snr: NaN }), RangeError);
  });
});
