/** Shared, bounded probes for feature parity, vectors and performance. */
import { prepareUtterance } from '../../src/synthesize.js';

export function prepareProbe(feature, options = {}) {
  const { probe } = feature;
  return prepareUtterance(probe.text ?? probe.ipa, {
    tier: 'minimal',
    seed: 82,
    engine: 'js',
    ipa: probe.ipa !== undefined,
    ...probe.options,
    ...options,
  });
}

export function maxError(actual, expected) {
  if (actual.length !== expected.length) {
    return Infinity;
  }
  let error = 0;
  for (let i = 0; i < actual.length; i++) {
    if (!Number.isFinite(actual[i]) || !Number.isFinite(expected[i])) {
      return Infinity;
    }
    error = Math.max(error, Math.abs(actual[i] - expected[i]));
  }
  return error;
}
