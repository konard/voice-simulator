/**
 * Issue 40: the source plane of the 3D solver follows the tract length.
 *  - step duration of [u] and [æ] (the stretch left after the move),
 *  - F1-F3 of [u] and [æ] against the rigid-walled tube,
 *  - largest sample step / RMS on a 0.3 s [æ]->[u] glide, 3D vs waveguide.
 *   node experiments/issue-40-fdtd3d.mjs [dx]
 */
import { buildVoxelModel, CELL_TRACT } from '../src/acoustics/voxel-model.js';
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { spectralPeaks } from '../src/acoustics/analysis.js';
import { tubeFormants } from '../src/acoustics/transfer.js';
import { ARTICULATORS, planUtterance } from '../src/articulation/plan.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { noseShape, tractShape } from '../src/articulation/tract-shape.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { getPhoneme } from '../src/ipa/inventory.js';

const dx = Number(process.argv[2] ?? 1);
const model = buildVoxelModel(DEFAULT_HEAD, {
  dx,
  piriform: false,
  vallecula: false,
});
const rest = model.lengths[CELL_TRACT];

function vowelShape(symbol) {
  return tractShape(
    { ...vowelTarget({ phoneme: getPhoneme(symbol) }), rhotic: 0 },
    DEFAULT_HEAD
  );
}

function peaks(shape, withShape) {
  const solver = new Fdtd3d({ model });
  solver.setNose(noseShape(DEFAULT_HEAD).areas);
  solver.setShape(
    shape.areas,
    0,
    shape.velumIndex,
    null,
    withShape ? shape : undefined
  );
  const step = solver.stepDuration(shape);
  const response = new Float64Array(Math.round(0.1 / step));
  for (let n = 0; n < response.length; n++) {
    response[n] = solver.step(n === 0 ? 1 : 0, 0, 0);
  }
  const found = spectralPeaks(response, 1 / step, { prominence: 0.5 });
  return { step, rise: solver.rise, found: found.filter((f) => f > 150) };
}

const nearest = (list, target) =>
  list.reduce((best, value) =>
    Math.abs(value - target) < Math.abs(best - target) ? value : best
  );

console.log(`dx ${dx} cm, rest length ${rest} cm`);
const steps = {};
for (const symbol of ['u', 'æ']) {
  const shape = vowelShape(symbol);
  const reference = tubeFormants(shape.areas, shape.length, {
    count: 3,
    walls: false,
  });
  for (const withShape of [false, true]) {
    const { step, rise, found } = peaks(shape, withShape);
    steps[`${symbol}${withShape}`] = step;
    const errors = reference.map(
      (target) => (100 * (nearest(found, target) - target)) / target
    );
    console.log(
      `[${symbol}] length ${shape.length.toFixed(2)} ${withShape ? 'moving glottis' : 'stretch only '}: rise ${rise}, step ${(step * 1e6).toFixed(3)} us, tube ${reference.map((f) => f.toFixed(0)).join('/')} Hz, 3D error ${errors.map((e) => e.toFixed(1)).join('/')} %`
    );
  }
}
for (const withShape of [false, true]) {
  const ratio = steps[`u${withShape}`] / steps[`æ${withShape}`];
  console.log(
    `step [u]/[æ] ${withShape ? 'moving glottis' : 'stretch only'}: ${(100 * (ratio - 1)).toFixed(1)} %`
  );
}

/** Plan of a long [æ] whose articulators glide to [u] in 0.3 s. */
function glidePlan() {
  const plan = planUtterance('ˈæː', { durations: [0.9] });
  const target = planUtterance('ˈuː', { durations: [0.9] });
  const vowel = plan.segments.find((segment) => segment.kind === 'vowel');
  const middle = (vowel.start + vowel.end) / 2;
  const first = Math.round((middle - 0.15) * plan.frameRate);
  const last = Math.round((middle + 0.15) * plan.frameRate);
  for (const name of Object.keys(ARTICULATORS)) {
    const from = plan.channels[name];
    const to = target.channels[name];
    if (!from || !to) {
      continue;
    }
    const a = from[first];
    const b = to[Math.min(to.length - 1, first)];
    for (let frame = first; frame < from.length; frame++) {
      const t = Math.min(1, (frame - first) / (last - first));
      from[frame] = a + (b - a) * t;
    }
  }
  return { plan, start: middle - 0.15, end: middle + 0.15 };
}

const RATE = 16000;
function clickRatio(options) {
  const { plan, start, end } = glidePlan();
  const samples = renderPlan(plan, { sampleRate: RATE, seed: 1, ...options });
  const from = Math.round(start * RATE);
  const to = Math.round(end * RATE);
  let jump = 0;
  let sum = 0;
  for (let n = from; n < to; n++) {
    jump = Math.max(jump, Math.abs(samples[n] - samples[n - 1]));
    sum += samples[n] ** 2;
  }
  return jump / Math.sqrt(sum / (to - from));
}
const fullModel = buildVoxelModel(DEFAULT_HEAD, { dx });
const waveguide = clickRatio({});
const fdtd = clickRatio({ solver: 'fdtd3d', model: fullModel });
console.log(
  `[æ]->[u] glide 0.3 s, largest step / RMS: waveguide ${waveguide.toFixed(3)}, fdtd3d ${fdtd.toFixed(3)} (${(fdtd / waveguide).toFixed(2)} x)`
);
