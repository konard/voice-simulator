// Formants of the phoneme-table vowels on the default and the male preset
// heads, with and without the piriform fossae, against the Hillenbrand men.
// Usage: node experiments/issue-9-default-formants.mjs
import { tubeFormants } from '../src/acoustics/transfer.js';
import { piriformBranch } from '../src/acoustics/waveguide.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { getPhoneme } from '../src/ipa/inventory.js';
import { HILLENBRAND } from '../src/articulation/vowel-norms.js';
import { DEFAULT_HEAD, presetHeadConfig } from '../src/head-config.js';

const heads = { default: DEFAULT_HEAD, male: presetHeadConfig('male') };
for (const [label, head] of Object.entries(heads)) {
  for (const symbol of [
    'i',
    'ɪ',
    'e',
    'ɛ',
    'æ',
    'ʌ',
    'ɑ',
    'ɔ',
    'o',
    'ʊ',
    'u',
    'ə',
    'ɝ',
  ]) {
    const phoneme = getPhoneme(symbol);
    if (!phoneme) {
      continue;
    }
    const target = vowelTarget({ phoneme });
    const shape = tractShape({ ...target, rhotic: target.rhotic ?? 0 }, head);
    const bare = tubeFormants(shape.areas, shape.length, { count: 3 });
    const fossae = tubeFormants(shape.areas, shape.length, {
      count: 3,
      branches: [piriformBranch(shape.areas.length, shape.length, head)],
    });
    console.log(
      `${label} /${symbol}/ bare ${bare.map(Math.round).join(' ')} | fossae ${fossae.map(Math.round).join(' ')} | men ${HILLENBRAND.male[symbol]?.join(' ') ?? '-'}`
    );
  }
}
