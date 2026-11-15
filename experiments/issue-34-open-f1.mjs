// F1 of a static vowel tract against the reflection at the glottal end
// (issue 34): 1 is a closed glottis, lower values an open one that
// absorbs and lets the end look partly open. Shows how far the first
// formant moves up while the glottis is open, where the interactive flow
// rings. Usage: node experiments/issue-34-open-f1.mjs [ipa]
import { impulseSpectrum, resonances } from '../src/acoustics/analysis.js';
import { SPEED_OF_SOUND } from '../src/acoustics/transfer.js';
import { noseSections } from '../src/acoustics/voice.js';
import { Waveguide } from '../src/acoustics/waveguide.js';
import { noseShape } from '../src/articulation/tract-shape.js';
import { DEFAULT_HEAD, normalizeHeadConfig } from '../src/head-config.js';
import { vowelShape } from '../tests/helpers/interaction.js';

const ipa = process.argv[2] ?? 'ˈɑː';
const head = normalizeHeadConfig(DEFAULT_HEAD);
const shape = vowelShape(ipa, head);
const dt = shape.length / (44 * SPEED_OF_SOUND);
console.log(`${ipa}: glottal end ${shape.areas[0].toFixed(2)} cm², length ${shape.length.toFixed(1)} cm`);
for (const reflection of [1, 0.8, 0.6, 0.4, 0.2, 0, -0.2]) {
  const guide = new Waveguide({ sections: 44, noseSections: noseSections(head, 44), head });
  guide.setNose(noseShape(head).areas);
  guide.setShape(shape.areas, shape.velumArea, shape.velumIndex, shape.teeth, shape);
  guide.setLength(shape.length);
  guide.setGlottalReflection(reflection);
  const response = new Float64Array(Math.round(0.1 / dt));
  for (let index = 0; index < response.length; index++) {
    response[index] = guide.step(index === 0 ? 1 : 0, 1, 0, 0);
  }
  const [f1] = resonances(impulseSpectrum(response, 1 / dt, { from: 150, to: 2500, step: 5 }), { count: 1, from: 150 });
  console.log(`  reflection ${reflection}: F1 ${f1.frequency.toFixed(0)} Hz, bandwidth ${f1.bandwidth.toFixed(0)} Hz`);
}
