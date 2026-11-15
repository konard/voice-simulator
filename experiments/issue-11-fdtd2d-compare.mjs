// Is the 2D sheet (fdtd2d.js) closer to the 3D solver than the waveguide,
// and fast enough for a tier between `medium` and `high`? (issue 37, plan
// P25 of issue 11, step 5)
//
// 1. For the eleven measured vowels (STORY_LENGTHS) on the male reference
//    head of scripts/calibrate-vowels.mjs, each solver with its own vowel
//    table as in synthesis (voice.js), the log-spectral distance (dB, RMS
//    over 4 to 8 kHz at 50 Hz steps) between the transfer functions of
//    fdtd2d (dx 0.6, or argv[2]) and fdtd3d at dx 0.5, and of the waveguide
//    (44 sections) and the same 3D reference. The transfer function is the
//    DFT of the impulse response of the static tract (glottal flow in,
//    radiated output out, nose coupled, velum closed).
//    The solvers scale their output differently, so every transfer
//    function is first shifted to a mean of 0 dB over 100 Hz to 4 kHz: the
//    distance then measures the high band relative to the formant region,
//    which is what a listener compares. A second column removes the mean
//    level difference inside 4 to 8 kHz as well (shape only).
//    The last column (a diagnosis, not part of the decision) leaves the
//    vallecula out of the 2D sheet: its 1D side branch puts a zero near
//    5 kHz that the voxel pouch of the 3D reference hardly shows
//    (experiments/issue-37-vallecula-zero.mjs).
// 2. The render time (median of three, after a warm-up) of the audit
//    sentence of experiments/issue-11-audit.mjs for the tier `medium`, the
//    2D solver at 48 kHz (the proposed tier `enhanced`) and the tier
//    `high`, on one core.
//
// Usage: node experiments/issue-11-fdtd2d-compare.mjs [dx2d] \
//          > experiments/issue-11-fdtd2d-compare.txt
import { performance } from 'node:perf_hooks';
import { Fdtd2d } from '../src/acoustics/fdtd2d.js';
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { Waveguide } from '../src/acoustics/waveguide.js';
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';
import { SPEED_OF_SOUND } from '../src/acoustics/transfer.js';
import { noseShape, tractShape } from '../src/articulation/tract-shape.js';
import {
  VOWEL_CORRECTIONS,
  VOWEL_CORRECTIONS_2D,
  VOWEL_CORRECTIONS_3D,
} from '../src/articulation/vowel-calibration.js';
import {
  STORY_FEATURES,
  STORY_LENGTHS,
} from '../src/articulation/vowel-space.js';
import { presetHeadConfig } from '../src/head-config.js';
import { synthesize } from '../src/index.js';

const DX_2D = Number(process.argv[2] ?? 0.6);
const DX_3D = 0.5;
const SECONDS = 0.1;
const head = presetHeadConfig('male');
const nose = noseShape(head).areas;

function vowelTract(name, vowelCorrections) {
  const [height, backness, rounding] = STORY_FEATURES[name];
  return tractShape({ height, backness, rounding }, head, {
    vowelCorrections,
  });
}

function impulse(solver, rate) {
  const response = new Float64Array(Math.round(rate * SECONDS));
  for (let n = 0; n < response.length; n++) {
    response[n] = solver.step(n === 0 ? 1 : 0, 0, 0);
  }
  return { response, rate };
}

/** Magnitude (dB) of the DFT of a response at the given frequencies. */
function levels({ response, rate }, frequencies) {
  return frequencies.map((frequency) => {
    const omega = (2 * Math.PI * frequency) / rate;
    let re = 0;
    let im = 0;
    for (let n = 0; n < response.length; n++) {
      re += response[n] * Math.cos(omega * n);
      im -= response[n] * Math.sin(omega * n);
    }
    return 20 * Math.log10(Math.hypot(re, im) + 1e-30);
  });
}

const range = (from, to, step) =>
  Array.from({ length: Math.round((to - from) / step) + 1 }, (_, index) =>
    Math.round(from + index * step)
  );
const LOW = range(100, 4000, 50);
const HIGH = range(4000, 8000, 50);
const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;

/** Level of the high band relative to the mean level below 4 kHz. */
function highBand(result) {
  const offset = mean(levels(result, LOW));
  return levels(result, HIGH).map((value) => value - offset);
}

/** RMS distance (dB); `shape` also removes the mean difference. */
function distance(a, b, shape = false) {
  const difference = a.map((value, index) => value - b[index]);
  const bias = shape ? mean(difference) : 0;
  return Math.sqrt(mean(difference.map((value) => (value - bias) ** 2)));
}

let model = null;
function response3d(name) {
  model ??= buildVoxelModel(head, { dx: DX_3D });
  const shape = vowelTract(name, VOWEL_CORRECTIONS_3D);
  const solver = new Fdtd3d({ model });
  solver.setNose(nose);
  solver.setShape(shape.areas, shape.velumArea, shape.velumIndex, shape.teeth);
  return impulse(solver, 1 / solver.stepDuration(shape));
}

function response2d(name, vallecula = true) {
  const shape = vowelTract(name, VOWEL_CORRECTIONS_2D);
  const solver = new Fdtd2d({ head, dx: DX_2D, vallecula });
  solver.setNose(nose);
  solver.setShape(
    shape.areas,
    shape.velumArea,
    shape.velumIndex,
    shape.teeth,
    shape
  );
  solver.setLength(shape.length);
  return impulse(solver, 1 / solver.stepDuration(shape));
}

function responseWaveguide(name) {
  const shape = vowelTract(name, VOWEL_CORRECTIONS);
  const solver = new Waveguide({ sections: shape.areas.length, head });
  solver.setNose(nose);
  solver.setShape(shape.areas, shape.velumArea, shape.velumIndex);
  solver.setLength(shape.length);
  return impulse(solver, (shape.areas.length * SPEED_OF_SOUND) / shape.length);
}

console.log(
  `Log-spectral distance to fdtd3d (dx ${DX_3D}), 4-8 kHz at 50 Hz steps, male reference head, each solver with its own vowel table`
);
console.log(
  `vowel  fdtd2d (dx ${DX_2D})  waveguide   | shape only: fdtd2d  waveguide | fdtd2d, no vallecula`
);
const totals = {
  sheet: [],
  wave: [],
  sheetShape: [],
  waveShape: [],
  bare: [],
};
for (const name of Object.keys(STORY_LENGTHS)) {
  const reference = highBand(response3d(name));
  const sheet = highBand(response2d(name));
  const wave = highBand(responseWaveguide(name));
  const row = {
    sheet: distance(sheet, reference),
    wave: distance(wave, reference),
    sheetShape: distance(sheet, reference, true),
    waveShape: distance(wave, reference, true),
    bare: distance(highBand(response2d(name, false)), reference),
  };
  for (const key of Object.keys(totals)) {
    totals[key].push(row[key]);
  }
  console.log(
    `/${name}/`.padEnd(7),
    row.sheet.toFixed(2).padStart(13),
    row.wave.toFixed(2).padStart(10),
    '  |',
    row.sheetShape.toFixed(2).padStart(17),
    row.waveShape.toFixed(2).padStart(10),
    ' |',
    row.bare.toFixed(2).padStart(19)
  );
}
const means = Object.fromEntries(
  Object.entries(totals).map(([key, values]) => [key, mean(values)])
);
console.log(
  'mean   ',
  means.sheet.toFixed(2).padStart(13),
  means.wave.toFixed(2).padStart(10),
  '  |',
  means.sheetShape.toFixed(2).padStart(17),
  means.waveShape.toFixed(2).padStart(10),
  ' |',
  means.bare.toFixed(2).padStart(19)
);
console.log(
  `mean distance to 3D: fdtd2d ${means.sheet.toFixed(2)} dB, waveguide ${means.wave.toFixed(2)} dB`
);

// Render time of the audit sentence (experiments/issue-11-audit.mjs).
const SENTENCE = 'The quick brown fox jumps over the lazy dog.';
const RENDERS = [
  ['medium', { tier: 'medium' }],
  ['fdtd2d', { solver: 'fdtd2d', dx: DX_2D, sampleRate: 48000 }],
  ['high', { tier: 'high' }],
];
const median = (values) => [...values].sort((a, b) => a - b)[1];
const renders = process.env.RENDER !== '0';
const times = {};
for (const [label, options] of renders ? RENDERS : []) {
  synthesize('Hello.', { ...options, seed: 1 });
  const runs = [];
  let duration = 0;
  for (let run = 0; run < 3; run++) {
    const started = performance.now();
    const out = synthesize(SENTENCE, { ...options, seed: 1 });
    runs.push((performance.now() - started) / 1000);
    duration = out.duration;
  }
  times[label] = median(runs);
  console.log(
    `render "${SENTENCE}" (${duration.toFixed(2)} s) ${label}: ${times[label].toFixed(2)} s (runs ${runs.map((value) => value.toFixed(2)).join(' ')}), real-time factor ${(times[label] / duration).toFixed(2)}`
  );
}
if (renders) {
  console.log(
    `fdtd2d / high render time ${(times.fdtd2d / times.high).toFixed(2)}, fdtd2d / medium ${(times.fdtd2d / times.medium).toFixed(2)}`
  );
}
