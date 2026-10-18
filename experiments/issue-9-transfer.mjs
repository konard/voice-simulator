// Formants (peaks) and antiresonances (dips) of static vowels in the tube
// model, the waveguide and the 3D solver, up to 8 kHz (issue 9 baseline).
// Usage: node experiments/issue-9-transfer.mjs [dx ...] [--options JSON]
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { Waveguide } from '../src/acoustics/waveguide.js';
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';
import { SPEED_OF_SOUND, tubeFormants } from '../src/acoustics/transfer.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { getPhoneme } from '../src/ipa/inventory.js';
import { normalizeHeadConfig } from '../src/head-config.js';
import { spectrum, extrema, distance } from './issue-9-transfer-lib.mjs';

const args = process.argv.slice(2);
const optionIndex = args.indexOf('--options');
const extra = optionIndex >= 0 ? JSON.parse(args[optionIndex + 1]) : {};
const sizes = (optionIndex >= 0 ? args.slice(0, optionIndex) : args).map(
  Number
);
const head = normalizeHeadConfig(extra.head ?? {});
const VOWELS = (extra.vowels ?? 'i,ɑ,u,ə').split(',');

function resample(areas, n) {
  return Array.from({ length: n }, (_, i) => {
    const x = ((i + 0.5) / n) * areas.length - 0.5;
    const lo = Math.max(0, Math.floor(x));
    const hi = Math.min(areas.length - 1, lo + 1);
    const f = Math.min(1, Math.max(0, x - lo));
    return areas[lo] * (1 - f) + areas[hi] * f;
  });
}

function shape(symbol) {
  return tractShape(
    { ...vowelTarget({ phoneme: getPhoneme(symbol) }), rhotic: 0 },
    head
  );
}

function respond(solver, rate, seconds = 0.08) {
  const response = new Float64Array(Math.round(rate * seconds));
  for (let n = 0; n < response.length; n++) {
    response[n] = solver.step(n === 0 ? 1 : 0, 0, 0);
  }
  return response;
}

for (const symbol of VOWELS) {
  const s = shape(symbol);
  console.log(
    `/${symbol}/ tube formants: ${tubeFormants(s.areas, s.length, { count: 5, maxFrequency: 8000 }).map(Math.round).join(' ')}`
  );
  const sections = 88;
  const wg = new Waveguide({ sections, head, piriform: extra.piriform });
  wg.setShape(
    resample(s.areas, sections),
    0,
    Math.round((s.velumIndex * sections) / s.areas.length)
  );
  const wgRate = (sections * SPEED_OF_SOUND) / s.length;
  const wgSpec = spectrum(respond(wg, wgRate), wgRate);
  console.log(
    `  waveguide peaks<5k ${extrema(wgSpec, 1, 3)
      .filter((f) => f < 5000)
      .join(' ')}`
  );
  for (const dx of sizes.length ? sizes : [1]) {
    const model = buildVoxelModel(head, { dx, ...extra.model });
    const solver = new Fdtd3d({ head, model, ...extra.solver });
    solver.setShape(
      s.areas,
      0,
      s.velumIndex,
      process.env.NO_TEETH ? null : (s.teeth ?? null)
    );
    const rate = 1 / solver.stepDuration(extra.fixedLength ? undefined : s);
    const spec = spectrum(respond(solver, rate), rate);
    const low = extrema(spec, 1, 3).filter((f) => f < 5000);
    console.log(
      `  3D dx ${dx} (${model.cells.length} cells) peaks<5k ${low.join(' ')} | rms dB 0.2-3k ${distance(spec, wgSpec, 200, 3000).toFixed(1)} 0.2-5k ${distance(spec, wgSpec).toFixed(1)}`
    );
  }
}
