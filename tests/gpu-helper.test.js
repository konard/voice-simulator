/**
 * tests/helpers/gpu.js and describeGpuDevice (issue 30): a runtime without
 * a WebGPU adapter skips the GPU tests, unless REQUIRE_GPU=1 says it must
 * have one.
 */

import { describe, it, expect } from 'test-anywhere';
import { describeGpuDevice } from '../src/index.js';
import {
  firstDivergentBlock,
  gpuForTests,
  relativeError,
} from './helpers/gpu.js';

const noAdapter = { requestAdapter: async () => null };

describe('gpuForTests', () => {
  it('no adapter is a skip reason', async () => {
    const result = await gpuForTests({ gpu: noAdapter, env: {} });
    expect(result.device).toBe(null);
    expect(result.info).toBe(null);
    expect(result.noGpu).toBe('no WebGPU adapter in this runtime');
  });

  it('REQUIRE_GPU turns it into a failure', async () => {
    let message = null;
    try {
      await gpuForTests({ gpu: noAdapter, env: { REQUIRE_GPU: '1' } });
    } catch (error) {
      message = error.message;
    }
    expect(message).toContain('REQUIRE_GPU=1');
  });

  it('describes a device', () => {
    expect(
      describeGpuDevice({
        adapterInfo: { description: 'x', vendor: 'v', isFallbackAdapter: true },
      })
    ).toEqual({
      description: 'x',
      vendor: 'v',
      architecture: '',
      fallback: true,
    });
    expect(describeGpuDevice(null)).toBe(null);
    expect(describeGpuDevice({})).toBe(null);
  });
});

describe('GPU comparison helpers', () => {
  it('finds the first block that drifts', () => {
    const expected = Float64Array.from({ length: 2000 }, (_, i) =>
      Math.sin(i * 0.1)
    );
    const actual = Float64Array.from(expected);
    expect(relativeError(actual, expected)).toBe(0);
    expect(firstDivergentBlock(actual, expected)).toBe(-1);
    actual[1234] += 0.5;
    expect(firstDivergentBlock(actual, expected)).toBe(2);
    expect(relativeError(actual, expected, 0, 1000)).toBe(0);
  });
});
