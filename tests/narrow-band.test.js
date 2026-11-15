/**
 * Issue 26: the narrow-band tiers `telephone` (8 kHz), `narrowband`
 * (11.025 kHz) and `wideband` (16 kHz). Measurements:
 * experiments/issue-26-narrow-band.mjs.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'test-anywhere';
import {
  AUDIO_TIERS,
  BASE_AUDIO_LEVEL,
  analyzeVoice,
  audioTierIndex,
  prepareUtterance,
  synthesize,
} from '../src/index.js';
import { resample } from '../src/audio/resample.js';
import { itUnless } from './helpers/skip.js';

const REFERENCE = { solver: 'waveguide', sections: 44, sampleRate: 48000 };
const NARROW = ['telephone', 'narrowband', 'wideband'];

// The hash below was recorded with V8's Math functions (again for the
// frequency-dependent losses of issue 36, which change every tier). JavaScriptCore on
// macOS takes Math.sin, Math.exp and friends from the system libm, whose
// last bits differ, so Bun there renders a different (but unchanged) minimal
// tier; Bun on Linux and Windows, Node.js and Deno match it.
const appleLibm =
  typeof process !== 'undefined' &&
  process.versions?.bun &&
  process.platform === 'darwin'
    ? "JavaScriptCore uses the macOS libm, not V8's Math"
    : null;
const tier = (name) => AUDIO_TIERS[audioTierIndex(name)];

// Copied from section 7 of experiments/issue-11-audit-m1.mjs.
const bandLevel = (samples, sampleRate, low, high) => {
  const size = 2048;
  const start = Math.max(0, Math.floor((samples.length - size) / 2));
  let energy = 0;
  for (let bin = 1; bin < size / 2; bin++) {
    const frequency = (bin * sampleRate) / size;
    if (frequency < low || frequency > high) {
      continue;
    }
    let real = 0;
    let imaginary = 0;
    for (let n = 0; n < size; n++) {
      const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / size);
      const value = (samples[start + n] ?? 0) * window;
      real += value * Math.cos((2 * Math.PI * bin * n) / size);
      imaginary -= value * Math.sin((2 * Math.PI * bin * n) / size);
    }
    energy += real * real + imaginary * imaginary;
  }
  return 10 * Math.log10(energy + 1e-30);
};

const vowelFormants = (ipa, options) => {
  const { samples, sampleRate } = synthesize(ipa, {
    ipa: true,
    seed: 1,
    ...options,
  });
  return analyzeVoice(samples, sampleRate).formants.slice(0, 3);
};

describe('narrow-band tiers', () => {
  it('tiers exist below minimal', () => {
    expect(AUDIO_TIERS.slice(0, 4).map((entry) => entry.name)).toEqual([
      ...NARROW,
      'minimal',
    ]);
    expect(BASE_AUDIO_LEVEL).toBe(3);
    expect(audioTierIndex('telephone')).toBe(0);
    expect(() => audioTierIndex('nope')).toThrow('Unknown audio tier: nope');
    expect(synthesize('Hello world.', { tier: 'telephone' }).sampleRate).toBe(
      8000
    );
    const costs = AUDIO_TIERS.slice(0, 4).map((entry) => entry.cost);
    expect(costs[2] < 1).toBe(true);
    costs.slice(1).forEach((cost, index) => {
      expect(cost > costs[index]).toBe(true);
    });
    const { renderOptions } = prepareUtterance('a', { tier: 'narrowband' });
    expect(renderOptions.blockSize).toBe(16);
    expect(renderOptions.bandLimit).toBe(4800);
    const own = prepareUtterance('a', { tier: 'wideband', blockSize: 8 });
    expect(own.renderOptions.blockSize).toBe(8);
    const minimal = prepareUtterance('a', { tier: 'minimal' }).renderOptions;
    expect(minimal.blockSize).toBe(undefined);
    expect(minimal.bandLimit).toBe(undefined);
  });

  it('formants survive', () => {
    const limits = { telephone: 0.12, narrowband: 0.12, wideband: 0.08 };
    for (const ipa of ['aː', 'iː', 'uː']) {
      const reference = vowelFormants(ipa, REFERENCE);
      for (const name of NARROW) {
        vowelFormants(ipa, { tier: name }).forEach((value, order) => {
          const difference = Math.abs(value / reference[order] - 1);
          expect(difference <= limits[name]).toBe(true);
        });
      }
    }
  });

  it('no aliasing', () => {
    const { solver, sections, blockSize } = tier('telephone');
    for (const ipa of ['sː', 'ʃː']) {
      const common = { ipa: true, seed: 1, solver, sections, blockSize };
      const direct = synthesize(ipa, { ...common, tier: 'telephone' });
      expect(direct.sampleRate).toBe(8000);
      const wide = synthesize(ipa, { ...common, sampleRate: 24000 });
      const reference = resample(wide.samples, 24000, 8000);
      const excess =
        bandLevel(direct.samples, 8000, 300, 3400) -
        bandLevel(reference, 8000, 300, 3400);
      expect(excess <= 0.6).toBe(true);
    }
  });

  it('band limit holds', () => {
    for (const name of NARROW) {
      const { bandLimit } = tier(name);
      const { samples, sampleRate } = synthesize('sː', {
        ipa: true,
        seed: 1,
        tier: name,
      });
      const pass = bandLevel(samples, sampleRate, 300, bandLimit);
      const stop = bandLevel(samples, sampleRate, bandLimit * 1.1, Infinity);
      expect(pass - stop >= 30).toBe(true);
    }
  });

  it('analysis works at 8 kHz', () => {
    const sentence = 'The quick brown fox jumps over the lazy dog.';
    const narrow = synthesize(sentence, { seed: 1, tier: 'telephone' });
    const wide = synthesize(sentence, { seed: 1, ...REFERENCE });
    const features = analyzeVoice(narrow.samples, narrow.sampleRate);
    expect(features.formants.length).toBe(4);
    expect(features.formants[3]).toBe(0);
    expect(features.formants[2] > 0).toBe(true);
    const reference = analyzeVoice(wide.samples, wide.sampleRate);
    expect(Math.abs(features.f0 / reference.f0 - 1) <= 0.02).toBe(true);
    const three = analyzeVoice(wide.samples, wide.sampleRate, {
      formantCount: 3,
    });
    expect(three.formants[3]).toBe(0);
    const length = features.vocalTractLength / three.vocalTractLength;
    expect(Math.abs(length - 1) <= 0.06).toBe(true);
  });

  // The hash of the flow-driven noise of issue 35, the articulator
  // dynamics of issue 38, the segment durations of issue 39 and the jaw
  // of issue 40 (it lags the tongue); a change of the physics or of the
  // plan updates it, a narrow-band change must not.
  itUnless(appleLibm)('present tiers are unchanged', () => {
    const { samples } = synthesize('Hi.', { tier: 'minimal', seed: 1 });
    const bytes = new Uint8Array(
      samples.buffer,
      samples.byteOffset,
      samples.byteLength
    );
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '8d1024cadc7a2c12a6035386af7f61050ea48c6c79cc84d74d1df608dd8da898'
    );
  });
});
