/**
 * Issue 84: spectrum of the nostril flow of a static [a] with the velar
 * port closed, against the lip flow (dB, nostrils minus lips) per band.
 * Shows where the closed nose picks up the field outside the lips.
 *
 *   node experiments/issue-84-leak-spectrum.mjs 1 0.6
 */
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { LINK_LIPS } from '../src/acoustics/voxel-model.js';
import { noseShape } from '../src/articulation/tract-shape.js';
import { normalizeHeadConfig } from '../src/head-config.js';
import { impulseSpectrum, staticShape } from './issue-84-resonance.mjs';

const BANDS = [
  [100, 400],
  [400, 900],
  [900, 1500],
  [1500, 3000],
  [3000, 6000],
];

export function leakSpectrum(dx, head = normalizeHeadConfig({})) {
  const solver = new Fdtd3d({ head, dx });
  solver.setNose(noseShape(head).areas);
  const shape = staticShape('vowel', head);
  solver.setShape(shape.areas, 0, shape.velumIndex, shape.teeth);
  solver.reset();
  const count = Math.round(0.1 / solver.dt);
  const lips = new Float64Array(count);
  const nostrils = new Float64Array(count);
  for (let step = 0; step < count; step++) {
    solver.step(step === 0 ? 1 : 0, 0, 0);
    solver.outputLinks.forEach((link, index) => {
      const flow =
        solver.outputSigns[index] *
        solver.conductance[link] *
        solver.velocity[link];
      if (solver.linkKind[link] === LINK_LIPS) {
        lips[step] += flow;
      } else {
        nostrils[step] += flow;
      }
    });
  }
  const rate = 1 / solver.dt;
  return BANDS.map(([low, high]) => {
    const frequencies = [];
    for (let f = low; f < high; f += 10) {
      frequencies.push(f);
    }
    const sum = (spectrum) => spectrum.reduce((a, b) => a + b, 0);
    const lip = sum(impulseSpectrum(lips, rate, frequencies));
    const nose = sum(impulseSpectrum(nostrils, rate, frequencies));
    return {
      band: `${low}-${high}`,
      dB: Number((10 * Math.log10(nose / lip)).toFixed(1)),
    };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const dx of process.argv.slice(2).map(Number)) {
    console.log(`dx ${dx}`, JSON.stringify(leakSpectrum(dx)));
  }
}
