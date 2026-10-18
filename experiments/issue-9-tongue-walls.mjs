// Tongue surface (midline top) and tract walls along the oral cavity for
// /i/ and /ɑ/: where the tongue rises for front vowels and drops for back.
// Usage: node experiments/issue-9-tongue-walls.mjs
import { vowelTarget } from '../src/articulation/phones.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { tongueMesh, ANATOMY_LODS } from '../src/geometry/anatomy.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { getPhoneme } from '../src/ipa/inventory.js';

const lod = 2;
const across = ANATOMY_LODS[lod].across;
const ring = 2 * (across + 1);
for (const symbol of ['i', 'ɑ', 'u', 'ə']) {
  const state = vowelTarget({ phoneme: getPhoneme(symbol) });
  const shape = tractShape(state, DEFAULT_HEAD);
  const mesh = tongueMesh(DEFAULT_HEAD, { lod, state });
  const rows = [];
  for (let section = 0; section < ANATOMY_LODS[lod].tongue; section++) {
    const index = (section * ring + across / 2) * 3;
    const [, y, z] = mesh.positions.subarray(index, index + 3);
    rows.push(`${y.toFixed(2)}@${z.toFixed(2)}`);
  }
  console.log(
    symbol,
    'areas',
    Array.from(shape.areas, (a) => a.toFixed(1)).join(' ')
  );
  console.log('  top', rows.join(' '));
}
