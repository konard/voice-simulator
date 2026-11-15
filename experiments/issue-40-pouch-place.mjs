// Issue 40: how much the formants of a vowel move when the side branches
// (piriform fossae, vallecula) open nearer the glottis, in the tube model.
// In the voxel tract the pouches stay in place while the source plane
// moves up, so a rise of r cm brings them r cm (times the time stretch)
// nearer the glottis end of the area function.
// Run: node experiments/issue-40-pouch-place.mjs
import { tubeFormants } from '../src/acoustics/transfer.js';
import { sideBranches } from '../src/acoustics/sinuses.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { STORY_FEATURES } from '../src/articulation/vowel-space.js';
import { VOWEL_CORRECTIONS_3D } from '../src/articulation/vowel-calibration.js';
import { presetHeadConfig } from '../src/head-config.js';

const head = presetHeadConfig('male');
for (const name of ['i', 'ɑ', 'u', 'æ']) {
  const [height, backness, rounding] = STORY_FEATURES[name];
  const shape = tractShape({ height, backness, rounding }, head, {
    vowelCorrections: VOWEL_CORRECTIONS_3D,
  });
  const n = shape.areas.length;
  const section = shape.length / n;
  const row = [];
  for (const shift of [0, 0.5, 1, 1.5, 2]) {
    const branches = sideBranches(head).map((branch) => ({
      index: Math.max(1, Math.round((branch.entry - shift) / section)),
      area: branch.area,
      length: branch.depth,
    }));
    const f = tubeFormants(shape.areas, shape.length, {
      walls: false,
      branches,
    }).slice(0, 3);
    row.push(`${shift}: ${f.map(Math.round).join('/')}`);
  }
  const bare = tubeFormants(shape.areas, shape.length, { walls: false })
    .slice(0, 3)
    .map(Math.round)
    .join('/');
  console.log(`${name} bare ${bare} | ${row.join(' | ')}`);
}
