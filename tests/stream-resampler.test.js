/**
 * Issue 27: the stream resampler gives, chunk by chunk, exactly what
 * `resample` gives for the whole signal.
 */

import { describe, it, expect } from 'test-anywhere';
import { createStreamResampler, resample } from '../src/audio/resample.js';
import { createRandom } from '../src/random.js';

/** 1 s of a 440 Hz sine with seeded noise at `rate`. */
function signal(rate) {
  const random = createRandom('issue-27');
  return Float32Array.from(
    { length: rate },
    (_, index) =>
      0.5 * Math.sin((2 * Math.PI * 440 * index) / rate) +
      0.1 * (random() - 0.5)
  );
}

function streamed(samples, from, to, size) {
  const resampler = createStreamResampler(from, to);
  const parts = [];
  for (let start = 0; start < samples.length; start += size) {
    parts.push(resampler.push(samples.subarray(start, start + size)));
  }
  parts.push(resampler.flush());
  const result = new Float32Array(
    parts.reduce((sum, part) => sum + part.length, 0)
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function maxDifference(a, b) {
  let max = 0;
  for (let index = 0; index < a.length; index++) {
    max = Math.max(max, Math.abs(a[index] - b[index]));
  }
  return max;
}

describe('stream resampler', () => {
  const cases = [
    [8000, 48000],
    [8000, 44100],
    [48000, 44100],
  ];
  for (const [from, to] of cases) {
    for (const size of [1, 127, 1024]) {
      it(`chunks equal the whole: ${from} -> ${to} Hz in chunks of ${size}`, () => {
        const input = signal(from);
        const whole = resample(input, from, to, { zeroCrossings: 8 });
        const output = streamed(input, from, to, size);
        expect(output.length).toBe(Math.round((input.length * to) / from));
        expect(output.length).toBe(whole.length);
        expect(maxDifference(output, whole) <= 1e-6).toBe(true);
      });
    }
  }

  it('returns copies at equal rates', () => {
    const resampler = createStreamResampler(16000, 16000);
    const chunk = Float32Array.of(1, 2, 3);
    const copy = resampler.push(chunk);
    expect(copy).toEqual(chunk);
    expect(copy).not.toBe(chunk);
    expect(resampler.flush().length).toBe(0);
  });

  it('preserves every sample when downsampling to an integer divisor', () => {
    for (const from of [16000, 48000]) {
      const input = signal(from).subarray(0, 1701);
      const batch = resample(input, from, 8000, { zeroCrossings: 8 });
      expect(batch).toEqual(streamed(input, from, 8000, 127));
    }
  });

  it('keeps only the input it still needs', () => {
    const resampler = createStreamResampler(8000, 48000);
    const input = signal(8000);
    for (let start = 0; start < input.length; start += 64) {
      resampler.push(input.subarray(start, start + 64));
    }
    expect(resampler.held() < 200).toBe(true);
  });

  it('rejects rates that are not positive', () => {
    expect(() => createStreamResampler(0, 48000)).toThrow();
  });
});
