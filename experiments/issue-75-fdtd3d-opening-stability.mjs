/**
 * Issue 75: random heads that blew up the high tier (NaN audio). The lip
 * corners of a narrow mouth stay nearly closed during /t/ while the lips
 * are open, and #scaleOpenings gave such a cell of fill 1e-4 an opening of
 * 0.45. Prints, per engine and head, whether the audio is finite and the
 * largest COURANT² Σk / (fill (1 + h)) of a tube cell (stable at most 2).
 * node experiments/issue-75-fdtd3d-opening-stability.mjs [text] [seeds]
 * Unlicense.
 */
import { createHash } from 'node:crypto';
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { CELL_AIR } from '../src/acoustics/voxel-model.js';
import { synthesize } from '../src/index.js';

const presets = ['any', 'male', 'female', 'child'];
const text = process.argv[2] ?? 'did countenance therm departed?';
const seeds = (process.argv[3] ?? '9400,9401,9402,9403,9406,9407,9410,9451')
  .split(',')
  .map(Number);
let worst = 0;
const setShape = Fdtd3d.prototype.setShape;
Fdtd3d.prototype.setShape = function (...args) {
  const result = setShape.apply(this, args);
  const sums = new Float64Array(this.cellCount);
  for (let link = 0; link < this.linkCount; link++) {
    sums[this.linkA[link]] += this.conductance[link];
    sums[this.linkB[link]] += this.conductance[link];
  }
  for (let cell = 0; cell < this.cellCount; cell++) {
    if (this.cellKind[cell] !== CELL_AIR && !this.solid[cell]) {
      const h = (0.5 * this.admittance[cell]) / 2;
      worst = Math.max(
        worst,
        (0.25 * sums[cell]) / (this.fill[cell] * (1 + h))
      );
    }
  }
  return result;
};
for (const engine of ['js', 'rust']) {
  for (const seed of seeds) {
    worst = 0;
    const { samples } = synthesize(text, {
      lang: 'en',
      tier: 'high',
      head: 'random',
      preset: presets[seed % 4],
      seed,
      engine,
    });
    const bad = samples.filter((v) => !Number.isFinite(v)).length;
    const hash = createHash('sha1')
      .update(Buffer.from(samples.buffer))
      .digest('hex')
      .slice(0, 12);
    console.log(
      engine,
      seed,
      presets[seed % 4],
      bad ? `NaN ${bad}/${samples.length}` : 'finite',
      engine === 'js' ? `load ${worst.toFixed(2)}` : '',
      hash
    );
  }
}
