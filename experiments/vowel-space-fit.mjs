// Compare Story (2008) measured formants with formants of (a) the raw area
// functions and (b) the fitted vowel space, using the chain-matrix model.
import {
  STORY_AREAS,
  STORY_FORMANTS,
  STORY_LENGTHS,
  vowelShape,
} from '../src/articulation/vowel-space.js';
import { tubeFormants } from '../src/acoustics/transfer.js';
import { VOWELS } from '../src/ipa/inventory.js';

const round = (values) => values.slice(0, 3).map((v) => Math.round(v));
for (const name of Object.keys(STORY_AREAS)) {
  const raw = tubeFormants(STORY_AREAS[name], STORY_LENGTHS[name]);
  const fit = vowelShape(VOWELS[name]);
  const fitted = tubeFormants(fit.areas, fit.length);
  console.log(
    name,
    'measured',
    STORY_FORMANTS[name].join('/'),
    'raw',
    round(raw).join('/'),
    'fit',
    round(fitted).join('/'),
    'L',
    fit.length.toFixed(2)
  );
}
for (const name of ['y', 'ɨ', 'ɯ', 'ə', 'a', 'ø', 'ɐ', 'ɤ']) {
  const fit = vowelShape(VOWELS[name]);
  console.log(name, round(tubeFormants(fit.areas, fit.length)).join('/'));
}
