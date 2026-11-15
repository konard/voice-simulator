/** Issue 36: energy of the waveguide impulse response over time per vowel,
 * with and without walls and loss filters, to find unstable settings. */
import { Waveguide } from '../src/acoustics/waveguide.js';
import { SPEED_OF_SOUND } from '../src/acoustics/constants.js';
import { STORY_AREAS, STORY_LENGTHS } from '../src/articulation/vowel-space.js';
import { normalizeHeadConfig } from '../src/head-config.js';

const head = normalizeHeadConfig({});
const vowels = process.argv.slice(2).length ? process.argv.slice(2) : ['o', 'ʊ', 'u', 'ɑ'];
for (const name of vowels) {
  for (const options of [{}, { walls: false }, { lossShape: 0 }, { walls: false, lossShape: 0 }]) {
    const areas = STORY_AREAS[name];
    const solver = new Waveguide({ sections: areas.length, head, ...options });
    solver.setShape(areas, 0, Math.round(areas.length * 0.45));
    solver.setLength(STORY_LENGTHS[name]);
    solver.glottalReflection = 1;
    const rate = (areas.length * SPEED_OF_SOUND) / STORY_LENGTHS[name];
    const block = Math.round(0.025 * rate);
    const energies = [];
    let energy = 0;
    for (let index = 0; index < 10 * block; index++) {
      const y = solver.step(index === 0 ? 1 : 0, 0, 0);
      energy += y * y;
      if ((index + 1) % block === 0) {
        energies.push(energy.toExponential(1));
        energy = 0;
      }
    }
    console.log(name, JSON.stringify(options), energies.join(' '));
  }
}
