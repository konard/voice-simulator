// Issue 40: how far the source plane has to move for each vowel of a 3D
// render (VOWEL_CORRECTIONS_3D shortens the tract), against the travel of
// LARYNX_TRAVEL at dx 1 and 0.5 cm, for the default, male and child heads.
import { tractShape } from '../src/articulation/tract-shape.js';
import { STORY_FEATURES } from '../src/articulation/vowel-space.js';
import { VOWEL_CORRECTIONS_3D } from '../src/articulation/vowel-calibration.js';
import { LARYNX_TRAVEL } from '../src/acoustics/voxel-model.js';
import { normalizeHeadConfig, presetHeadConfig } from '../src/head-config.js';

for (const [name, head] of [
  ['default', normalizeHeadConfig({})],
  ['male', normalizeHeadConfig(presetHeadConfig('male'))],
  ['child', normalizeHeadConfig(presetHeadConfig('child'))],
]) {
  const rest = tractShape({ height: 0.5, backness: 0.5, rounding: 0 }, head);
  const L = head.vocalTractLength;
  const row = [];
  for (const [symbol, [height, backness, rounding]] of Object.entries(
    STORY_FEATURES
  )) {
    const shape = tractShape({ height, backness, rounding, rhotic: 0 }, head, {
      sections: 44,
      vowelCorrections: VOWEL_CORRECTIONS_3D,
    });
    row.push(
      `${symbol} ${shape.length.toFixed(2)} (${(L - shape.length).toFixed(2)})`
    );
  }
  console.log(
    `${name}: rest ${L} travel ${(LARYNX_TRAVEL * L).toFixed(2)} schwa ${rest.length.toFixed(2)}`
  );
  console.log(`  ${row.join(', ')}`);
}
