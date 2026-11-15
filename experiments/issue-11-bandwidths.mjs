/**
 * Issue 36 (plan P24, step 7): formants and -3 dB bandwidths of the eleven
 * vowels of Story (2008) in the 1D waveguide and in the tube transfer
 * function, against the formula of Hawks & Miller (1995).
 *
 * Every vowel is the measured area function (STORY_AREAS, STORY_LENGTHS,
 * no calibration) on the default head, with the piriform fossae and a
 * closed glottis (glottalReflection 1, as in tubeTransfer). The mean
 * absolute error is the mean of |B - B_HM| / B_HM over F1-F3 of the eleven
 * vowels.
 *
 * Run: node experiments/issue-11-bandwidths.mjs > experiments/issue-11-bandwidths.txt
 *      node experiments/issue-11-bandwidths.mjs --scan   (calibration grid)
 */

// The measurement is always this checkout's; the solver comes from
// SOURCE (a src directory) so that the same script measures older commits:
//   git worktree add /tmp/main main
//   SOURCE=/tmp/main/src node experiments/issue-11-bandwidths.mjs
import { URL } from 'node:url';
import { impulseSpectrum, resonances } from '../src/acoustics/analysis.js';

const source = process.env.SOURCE
  ? new URL(`file://${process.env.SOURCE.replace(/\/?$/, '/')}`)
  : new URL('../src/', import.meta.url);
const load = (path) => import(new URL(path, source).href);
const { Waveguide, piriformBranch } = await load('acoustics/waveguide.js');
const { tubeSpectrum, SPEED_OF_SOUND } = await load('acoustics/transfer.js');
const losses = await load('acoustics/losses.js').catch(() => ({}));
const radiation = await load('acoustics/radiation.js');
const { STORY_AREAS, STORY_LENGTHS } = await load(
  'articulation/vowel-space.js'
);
const { normalizeHeadConfig } = await load('head-config.js');

/**
 * Mean absolute error before issue 36, measured with this script on main
 * at commit e113bd5 (frequency-independent wall loss in the waveguide,
 * 2e-5 sqrt(f / A) in the tube, rigid walls, piston in an infinite baffle).
 */
const BEFORE = { waveguide: 0.347, tube: 0.734 };

/** Hawks & Miller (1995), f0 132 Hz (copied for runs on older commits). */
function hawksMiller(frequency) {
  if (losses.publishedBandwidth) {
    return losses.publishedBandwidth(frequency);
  }
  const k =
    frequency < 500
      ? [
          165.327516, -6.73636734e-1, 1.80874446e-3, -4.52201682e-6, 7.49514e-9,
          -4.70219241e-12,
        ]
      : [
          15.8146139, 8.10159009e-2, -9.79728215e-5, 5.28725064e-8,
          -1.07099364e-11, 7.91528509e-16,
        ];
  return k.reduce((sum, value, power) => sum + value * frequency ** power, 0);
}

const head = normalizeHeadConfig({});
const STEP = 2;
const RANGE = { from: 100, to: 4600, step: STEP };

function waveguideResonances(name, options = {}) {
  const areas = STORY_AREAS[name];
  const length = STORY_LENGTHS[name];
  const solver = new Waveguide({ sections: areas.length, head, ...options });
  solver.setShape(areas, 0, Math.round(areas.length * 0.45));
  solver.setLength(length);
  solver.glottalReflection = options.glottalReflection ?? 1;
  const rate = (areas.length * SPEED_OF_SOUND) / length;
  const response = new Float64Array(Math.round(0.25 * rate));
  for (let index = 0; index < response.length; index++) {
    response[index] = solver.step(index === 0 ? 1 : 0, 0, 0);
  }
  return resonances(impulseSpectrum(response, rate, RANGE), { count: 4 });
}

function tubeResonances(name, options = {}) {
  const areas = STORY_AREAS[name];
  const length = STORY_LENGTHS[name];
  const spectrum = tubeSpectrum(areas, length, {
    head,
    step: STEP,
    maxFrequency: RANGE.to,
    branches: [piriformBranch(areas.length, length, head)],
    ...options,
  });
  return resonances(spectrum, { count: 4 });
}

/** Mean |B - B_HM| / B_HM over F1-F3, and the rows of the table. */
function compare(measure, options) {
  let sum = 0;
  let count = 0;
  const rows = [];
  for (const name of Object.keys(STORY_AREAS)) {
    const peaks = measure(name, options);
    peaks.slice(0, 3).forEach(({ frequency, bandwidth }) => {
      sum +=
        Math.abs(bandwidth - hawksMiller(frequency)) / hawksMiller(frequency);
      count++;
    });
    rows.push([name, peaks]);
  }
  return { error: sum / count, rows };
}

const fmt = (value, width = 5) => value.toFixed(0).padStart(width);

if (process.argv.includes('--scan')) {
  const stages = [2, 3, 4, 6];
  for (const lossShape of [1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
    for (const baffle of [0.3, 0.5, 0.75, 1]) {
      const errors = stages.map(
        (lossStages) =>
          compare(waveguideResonances, { lossShape, baffle, lossStages }).error
      );
      const tube = compare(tubeResonances, { lossShape, baffle }).error;
      console.log(
        `shape ${lossShape} baffle ${baffle}: waveguide (stages ` +
          `${stages.join('/')}) ${errors.map((e) => (100 * e).toFixed(1)).join('/')} %,` +
          ` tube ${(100 * tube).toFixed(1)} %`
      );
    }
  }
} else {
  const waveguide = compare(waveguideResonances);
  const tube = compare(tubeResonances);
  console.log(
    `source ${process.env.SOURCE ?? 'this checkout'}: LOSS_SHAPE ` +
      `${losses.LOSS_SHAPE}, RADIATION_BAFFLE ${radiation.RADIATION_BAFFLE}, ` +
      `LOSS_STAGES ${losses.LOSS_STAGES}`
  );
  console.log(
    'vowel  waveguide F1-F4 / B1-B4 (Hz)     tube F1-F4 / B1-B4 (Hz)' +
      '          Hawks & Miller B1-B4 at the waveguide formants'
  );
  waveguide.rows.forEach(([name, peaks], index) => {
    const tubePeaks = tube.rows[index][1];
    const list = (items) =>
      `${items.map(({ frequency }) => fmt(frequency)).join('')} /${items
        .map(({ bandwidth }) => fmt(bandwidth, 4))
        .join('')}`;
    console.log(
      `[${name}]   ${list(peaks)}   ${list(tubePeaks)}   ${peaks
        .map(({ frequency }) => fmt(hawksMiller(frequency), 4))
        .join('')}`
    );
  });
  const percent = (value) => `${(100 * value).toFixed(1)} %`;
  console.log(
    `mean absolute error of B1-B3 against Hawks & Miller (11 vowels x 3):` +
      ` waveguide ${percent(waveguide.error)} (before: ${percent(BEFORE.waveguide)}),` +
      ` tube ${percent(tube.error)} (before: ${percent(BEFORE.tube)})`
  );
}
