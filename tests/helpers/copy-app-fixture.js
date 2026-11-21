/** Synthetic speech for the worker and browser checks. Unlicense. */
import { presetHeadConfig, synthesize } from '../../src/index.js';

export const COPY_RATE = 16000;
export const female = presetHeadConfig('female');

const TEXT =
  'A little bird sings in the morning. We heard it again across the green field. ' +
  'The road climbed slowly through the forest toward a house beside the river. ' +
  'She turned around and saw the lights come on in every room. ' +
  'They brought some tea and set the table before walking home together. ' +
  'The wind blew through the trees while we looked for a place to rest.';

export function copyFixture(seconds, sampleRate = COPY_RATE) {
  const { samples } = synthesize(TEXT, {
    head: female,
    lang: 'en',
    seed: 1,
    sampleRate,
    tier: 'minimal',
  });
  if (samples.length < seconds * sampleRate) {
    throw new RangeError(
      'Voice-copy fixture is shorter than the requested duration'
    );
  }
  return samples.subarray(0, seconds * sampleRate);
}
