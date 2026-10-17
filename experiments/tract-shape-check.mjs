// Formants of articulated tract shapes for a few phones and heads.
import { tractShape } from '../src/articulation/tract-shape.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { tubeFormants } from '../src/acoustics/transfer.js';
import { DEFAULT_HEAD, normalizeHeadConfig } from '../src/head-config.js';
import { getPhoneme } from '../src/ipa/inventory.js';

const heads = {
  default: DEFAULT_HEAD,
  long: normalizeHeadConfig({ vocalTractLength: 19 }),
  short: normalizeHeadConfig({ vocalTractLength: 12.5, pharynxRatio: 0.38 }),
};
for (const [name, head] of Object.entries(heads)) {
  for (const symbol of ['i', 'e', 'a', 'ɑ', 'o', 'u', 'y', 'ə']) {
    const v = vowelTarget({ phoneme: getPhoneme(symbol) });
    const shape = tractShape({ ...v, rhotic: 0 }, head);
    const f = tubeFormants(shape.areas, shape.length, { count: 3 });
    console.log(
      name,
      symbol,
      shape.length.toFixed(2),
      f.map(Math.round).join(' ')
    );
  }
}
const r = tractShape(
  { height: 0.5, backness: 0.5, rounding: 0, rhotic: 1 },
  DEFAULT_HEAD
);
console.log(
  'ɚ',
  tubeFormants(r.areas, r.length, { count: 3 }).map(Math.round).join(' ')
);
const s = tractShape(
  {
    tongueAmount: 1,
    tongueArea: 0.09,
    tongueLocation: 0.905,
    tongueWidth: 0.03,
    frication: 1,
    sibilance: 1,
  },
  DEFAULT_HEAD
);
console.log(
  's',
  s.frication,
  Array.from(s.areas.slice(34), (a) => a.toFixed(2)).join(' ')
);
