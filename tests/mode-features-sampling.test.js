/** Regression: 22050 Hz gives an odd (221 sample) analysis hop. Unlicense. */
import { synthesize, presetHeadConfig } from '../src/index.js';
import { expect, it } from 'test-anywhere';
import { pulseF0, jitterPercent, cpp } from '../src/analysis/mode-features.js';
it('measures glottal periods and CPP at odd sample hops', () => {
  const sampleRate = 22050;
  const { samples } = synthesize('The train leaves at seven.', {
    head: presetHeadConfig('male'),
    tier: 'minimal',
    seed: 1,
    engine: 'js',
  });
  expect(pulseF0(samples, sampleRate)).toBeGreaterThan(80);
  expect(jitterPercent(samples, sampleRate) < 1).toBe(true);
  expect(cpp(samples, sampleRate)).toBeGreaterThan(0);
});
