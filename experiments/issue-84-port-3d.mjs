/**
 * Issue 84, step 4 (cause 3): the velar port and the nostrils of the 3D
 * solver against the area they should have, per grid step.
 *
 * - velum links: count, portArea = count * dx², the requested velumArea and
 *   the effective port area, the sum of conductance * dx² over the links;
 * - nostril links: the same sum against the last nose section;
 * - lowest resonance of the static [m] (impulse response 0.25 s) against
 *   the tube model with the nasal branch (step 3) and the waveguide;
 * - static [a] with velumArea 0: RMS nostril flow against lip flow.
 *
 *   node experiments/issue-84-port-3d.mjs 1 0.6 0.5
 */
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { tubeTransfer } from '../src/acoustics/transfer.js';
import {
  LINK_LIPS,
  LINK_NOSTRILS,
  LINK_VELUM,
} from '../src/acoustics/voxel-model.js';
import { noseShape } from '../src/articulation/tract-shape.js';
import { normalizeHeadConfig } from '../src/head-config.js';
import {
  impulseSpectrum,
  lowestPeak,
  staticShape,
  tubeOptions,
  waveguideResponse,
} from './issue-84-resonance.mjs';

const round = (value, digits = 3) => Number(value.toFixed(digits));

function linkArea(solver, kind) {
  let area = 0;
  let count = 0;
  for (let link = 0; link < solver.linkCount; link++) {
    if (solver.linkKind[link] === kind) {
      area += solver.conductance[link] * solver.dx ** 2;
      count++;
    }
  }
  return { count, area };
}

/** Port and nostril areas of a solver with a static [m] shape. */
export function portAreas(dx, velumAreas = [], head = normalizeHeadConfig({})) {
  const solver = new Fdtd3d({ head, dx });
  const nose = noseShape(head);
  solver.setNose(nose.areas);
  const shape = staticShape('consonant', head);
  const result = [];
  for (const velumArea of [shape.velumArea, ...velumAreas]) {
    solver.setShape(shape.areas, velumArea, shape.velumIndex, shape.teeth);
    const velum = linkArea(solver, LINK_VELUM);
    const nostrils = linkArea(solver, LINK_NOSTRILS);
    result.push({
      velumArea: round(velumArea),
      velumLinks: velum.count,
      portArea: round(velum.count * dx * dx),
      effectivePort: round(velum.area),
      firstNoseSection: round(nose.areas[0]),
      nostrilLinks: nostrils.count,
      effectiveNostrils: round(nostrils.area),
      lastNoseSection: round(nose.areas.at(-1)),
    });
  }
  return { solver, shape, result };
}

function flows(solver) {
  let lips = 0;
  let nostrils = 0;
  for (let index = 0; index < solver.outputLinks.length; index++) {
    const link = solver.outputLinks[index];
    const flow =
      solver.outputSigns[index] *
      solver.conductance[link] *
      solver.velocity[link] *
      solver.dx ** 2;
    if (solver.linkKind[link] === LINK_LIPS) {
      lips += flow;
    } else if (solver.linkKind[link] === LINK_NOSTRILS) {
      nostrils += flow;
    }
  }
  return [lips, nostrils];
}

function impulse(solver, seconds, each) {
  solver.reset();
  const count = Math.round(seconds / solver.dt);
  const response = new Float64Array(count);
  for (let index = 0; index < count; index++) {
    response[index] = solver.step(index === 0 ? 1 : 0, 0, 0);
    each?.(index);
  }
  return response;
}

const FREQUENCIES = [];
for (let f = 40; f <= 2000; f += 2) {
  FREQUENCIES.push(f);
}

/** Lowest [m] resonance: [frequency, gain dB, -3 dB bandwidth]. */
export function murmurResonance(solver, shape) {
  solver.setShape(shape.areas, shape.velumArea, shape.velumIndex, shape.teeth);
  const response = impulse(solver, 0.25);
  const spectrum = impulseSpectrum(response, 1 / solver.dt, FREQUENCIES);
  return lowestPeak(FREQUENCIES, spectrum).map((v) => round(v, 1));
}

export function referenceResonances(head) {
  const shape = staticShape('consonant', head);
  const options = tubeOptions(shape, head);
  const tube = FREQUENCIES.map(
    (f) => tubeTransfer(shape.areas, shape.length, f, options) ** 2
  );
  const { response, rate } = waveguideResponse(shape, head);
  return {
    tube: lowestPeak(FREQUENCIES, tube).map((v) => round(v, 1)),
    waveguide: lowestPeak(
      FREQUENCIES,
      impulseSpectrum(response, rate, FREQUENCIES)
    ).map((v) => round(v, 1)),
  };
}

/** RMS nostril and lip flow of the impulse response of [a], port closed. */
export function closedPortLeak(dx, head = normalizeHeadConfig({})) {
  const solver = new Fdtd3d({ head, dx });
  solver.setNose(noseShape(head).areas);
  const shape = staticShape('vowel', head);
  solver.setShape(shape.areas, 0, shape.velumIndex, shape.teeth);
  let lips = 0;
  let nostrils = 0;
  impulse(solver, 0.1, () => {
    const [lip, nose] = flows(solver);
    lips += lip * lip;
    nostrils += nose * nose;
  });
  return { lips: Math.sqrt(lips), nostrils: Math.sqrt(nostrils) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const head = normalizeHeadConfig({});
  console.log(
    'reference [m] resonance',
    JSON.stringify(referenceResonances(head))
  );
  for (const dx of process.argv.slice(2).map(Number)) {
    const { solver, shape, result } = portAreas(dx, [0.3, 0.8, 1.3], head);
    for (const row of result) {
      console.log(`dx ${dx} port`, JSON.stringify(row));
    }
    console.log(
      `dx ${dx} [m] resonance`,
      JSON.stringify(murmurResonance(solver, shape))
    );
    const leak = closedPortLeak(dx, head);
    console.log(
      `dx ${dx} [a] closed port`,
      JSON.stringify({
        lips: round(leak.lips, 5),
        nostrils: round(leak.nostrils, 5),
        ratio: round(leak.nostrils / leak.lips),
      })
    );
  }
}
