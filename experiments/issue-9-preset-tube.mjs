// Tube-model formants and waveguide impulse-response peaks of the measured
// vowels for the male, female and child presets, next to Hillenbrand et al.
// (1995). No pitch is involved, so the numbers show what the tract shape
// itself gives each preset.
// Usage: node experiments/issue-9-preset-tube.mjs [--waveguide] [--head JSON]
//   --head merges extra head values into every preset (to try ranges).
import { Waveguide, piriformBranch } from '../src/acoustics/waveguide.js';
import { SPEED_OF_SOUND, tubeFormants } from '../src/acoustics/transfer.js';
import { spectralPeaks } from '../src/acoustics/analysis.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { HILLENBRAND } from '../src/articulation/vowel-norms.js';
import { STORY_FEATURES } from '../src/articulation/vowel-space.js';
import { presetHeadConfig } from '../src/head-config.js';

const SECTIONS = 44;
const args = process.argv.slice(2);
const headIndex = args.indexOf('--head');
const extra = headIndex >= 0 ? JSON.parse(args[headIndex + 1]) : {};

function respond(solver, rate, seconds = 0.1) {
  const response = new Float64Array(Math.round(rate * seconds));
  for (let n = 0; n < response.length; n++) {
    response[n] = solver.step(n === 0 ? 1 : 0, 0, 0);
  }
  return response;
}

const total = [];
for (const preset of ['male', 'female', 'child']) {
  const head = { ...presetHeadConfig(preset), ...(extra[preset] ?? {}) };
  console.log(
    `${preset}: VTL ${head.vocalTractLength} pharynx ${head.pharynxRatio}`
  );
  const errors = [[], [], []];
  for (const [vowel, [height, backness, rounding]] of Object.entries(
    STORY_FEATURES
  )) {
    const target = HILLENBRAND[preset][vowel];
    const shape = tractShape({ height, backness, rounding }, head, {
      sections: SECTIONS,
    });
    const tube = tubeFormants(shape.areas, shape.length, {
      count: 3,
      branches: [piriformBranch(SECTIONS, shape.length, head)],
    });
    tube.forEach((value, index) =>
      errors[index].push(Math.log(value / target[index]))
    );
    let line = `  /${vowel}/ tube ${tube.map(Math.round).join(' ')}`;
    if (args.includes('--waveguide')) {
      const wg = new Waveguide({ sections: SECTIONS, head });
      wg.setShape(shape.areas, 0, shape.velumIndex);
      wg.setLength(shape.length);
      const rate = (SECTIONS * SPEED_OF_SOUND) / shape.length;
      const peaks = spectralPeaks(respond(wg, rate), rate, { prominence: 0.5 });
      line += ` | wg ${peaks.slice(0, 3).join(' ')}`;
    }
    console.log(`${line} | Hillenbrand ${target.join(' ')}`);
  }
  const summary = errors.map((list, index) => {
    const mean = list.reduce((sum, value) => sum + value, 0) / list.length;
    const rms = Math.sqrt(
      list.reduce((sum, value) => sum + value * value, 0) / list.length
    );
    return `F${index + 1} mean ${(100 * mean).toFixed(1)}% rms ${(100 * rms).toFixed(1)}%`;
  });
  console.log(`  error: ${summary.join(', ')}`);
  total.push(...errors.flat());
}
const rms = Math.sqrt(
  total.reduce((sum, value) => sum + value * value, 0) / total.length
);
console.log(`all presets rms ${(100 * rms).toFixed(1)}%`);
