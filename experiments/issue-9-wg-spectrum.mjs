// Waveguide transfer spectrum (dB) of one vowel at low frequencies, to see
// whether F1 and F2 are present but damped or missing.
// Usage: node experiments/issue-9-wg-spectrum.mjs [vowel=u] [preset=male] [sections=88]
import { Waveguide } from '../src/acoustics/waveguide.js';
import { SPEED_OF_SOUND, tubeFormants } from '../src/acoustics/transfer.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { getPhoneme } from '../src/ipa/inventory.js';
import { presetHeadConfig } from '../src/head-config.js';
import { spectrum } from './issue-9-transfer-lib.mjs';

const [symbol = 'u', preset = 'male', count = '88'] = process.argv.slice(2);
const head = presetHeadConfig(preset);
const sections = Number(count);
const s = tractShape(
  { ...vowelTarget({ phoneme: getPhoneme(symbol) }), rhotic: 0 },
  head
);
console.log('areas', s.areas.map((a) => a.toFixed(2)).join(' '));
console.log(
  'tube',
  tubeFormants(s.areas, s.length, { count: 4 }).map(Math.round).join(' ')
);
const resampled = Array.from({ length: sections }, (_, i) => {
  const x = ((i + 0.5) / sections) * s.areas.length - 0.5;
  const lo = Math.max(0, Math.floor(x));
  const hi = Math.min(s.areas.length - 1, lo + 1);
  const f = Math.min(1, Math.max(0, x - lo));
  return s.areas[lo] * (1 - f) + s.areas[hi] * f;
});
for (const options of [{}, { piriform: false }]) {
  const wg = new Waveguide({ sections, head, ...options });
  wg.setShape(
    resampled,
    0,
    Math.round((s.velumIndex * sections) / s.areas.length)
  );
  if (process.env.NO_CONSTRICTION) {
    // Boundary losses only (no kinetic loss in narrow sections).
    for (let i = 0; i < sections; i++) {
      wg.damping[i] =
        1 - 0.0007 - 0.0004 / Math.sqrt(Math.max(resampled[i], 0.05));
    }
  }
  const rate = (sections * SPEED_OF_SOUND) / s.length;
  const response = new Float64Array(Math.round(rate * 0.1));
  for (let n = 0; n < response.length; n++) {
    response[n] = wg.step(n === 0 ? 1 : 0, 0, 0);
  }
  const spec = spectrum(response, rate, 100, 3000, 50);
  console.log(
    JSON.stringify(options),
    spec.map(([f, v]) => `${f}:${v.toFixed(0)}`).join(' ')
  );
}
