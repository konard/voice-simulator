/**
 * Frequency-domain analysis of a tube (area function) with the classic
 * chain-matrix (ABCD) method. This is used to validate the time-domain
 * solvers and to show formants in the UI: it is exact for a concatenation
 * of uniform cylinders, with viscous/thermal boundary-layer losses, yielding
 * walls (losses.js) and a piston radiation load at the lips.
 */

import { AIR_DENSITY, SPEED_OF_SOUND } from './constants.js';
import {
  LOSS_SHAPE,
  WALL_MASS,
  WALL_RESISTANCE,
  WALL_STIFFNESS,
  viscothermalLoss,
  wallAdmittance,
  wallSurface,
} from './losses.js';
import { RADIATION_BAFFLE, radiationLoad } from './radiation.js';

export { AIR_DENSITY, SPEED_OF_SOUND };

function complex(re, im = 0) {
  return { re, im };
}

function multiply(a, b) {
  return complex(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
}

function add(a, b) {
  return complex(a.re + b.re, a.im + b.im);
}

function divide(a, b) {
  const scale = b.re * b.re + b.im * b.im;
  return complex(
    (a.re * b.re + a.im * b.im) / scale,
    (a.im * b.re - a.re * b.im) / scale
  );
}

function cosSin(re, im) {
  // cos(x) and sin(x) for complex x = re + j·im.
  return {
    cos: complex(Math.cos(re) * Math.cosh(im), -Math.sin(re) * Math.sinh(im)),
    sin: complex(Math.sin(re) * Math.cosh(im), Math.cos(re) * Math.sinh(im)),
  };
}

function multiplyMatrix(a, b) {
  return [
    add(multiply(a[0], b[0]), multiply(a[1], b[2])),
    add(multiply(a[0], b[1]), multiply(a[1], b[3])),
    add(multiply(a[2], b[0]), multiply(a[3], b[2])),
    add(multiply(a[2], b[1]), multiply(a[3], b[3])),
  ];
}

/**
 * Radiation impedance of a piston in a baffle (`baffle` 1) or of a free
 * pipe end (0, half the resistance and an end correction of 0.61 a).
 */
function radiationImpedance(frequency, area, baffle) {
  const radius = Math.sqrt(area / Math.PI);
  const ka = (2 * Math.PI * frequency * radius) / SPEED_OF_SOUND;
  const characteristic = (AIR_DENSITY * SPEED_OF_SOUND) / area;
  const { endCorrection } = radiationLoad(baffle);
  return complex(
    ((characteristic * ka * ka) / 2) * (0.5 + 0.5 * baffle),
    characteristic * ka * endCorrection
  );
}

/**
 * Chain matrix of a uniform section; `loss` is the boundary-layer
 * attenuation of a 1 cm² section at this frequency (nepers per cm), which
 * grows with perimeter / area.
 */
function sectionMatrix(frequency, area, length, loss) {
  const omega = 2 * Math.PI * frequency;
  const impedance = (AIR_DENSITY * SPEED_OF_SOUND) / area;
  const alpha = loss / Math.sqrt(area);
  const { cos, sin } = cosSin(
    (omega / SPEED_OF_SOUND) * length,
    -alpha * length
  );
  return [
    cos,
    multiply(complex(0, impedance), sin),
    multiply(complex(0, 1 / impedance), sin),
    cos,
  ];
}

/**
 * Shunt of a blind side tube (closed far end): its admittance at the
 * junction is j (A / rho c) tan(k L). With `volume` (cm³) the tube is the
 * neck of a Helmholtz resonator (a paranasal sinus): the neck, with its
 * wall losses, ends in the compliance V / (rho c²) of the cavity.
 */
function branchMatrix(frequency, { area, length, volume, loss = 0 }) {
  // A branch `loss` is the legacy constant of tubeTransfer's `loss`.
  if (!volume) {
    const admittance =
      (area / (AIR_DENSITY * SPEED_OF_SOUND)) *
      Math.tan((2 * Math.PI * frequency * length) / SPEED_OF_SOUND);
    return [complex(1), complex(0), complex(0, admittance), complex(1)];
  }
  const compliance = volume / (AIR_DENSITY * SPEED_OF_SOUND ** 2);
  const cavity = complex(0, -1 / (2 * Math.PI * frequency * compliance));
  const neck = sectionMatrix(
    frequency,
    area,
    length,
    loss * Math.sqrt(frequency)
  );
  const impedance = divide(
    add(multiply(neck[0], cavity), neck[1]),
    add(multiply(neck[2], cavity), neck[3])
  );
  return [complex(1), complex(0), divide(complex(1), impedance), complex(1)];
}

/**
 * Chain matrix of sections `from` to `to` of a tube {areas, sectionLength,
 * loss, branches, wall}, with each branch joined in front of its section
 * and, with a `wall`, the yielding wall of each section as a shunt after
 * it.
 */
function chainOf(frequency, tube, from = 0, to = tube.areas.length) {
  const { areas, sectionLength, loss, branches, wall } = tube;
  let chain = [complex(1), complex(0), complex(0), complex(1)];
  for (let index = from; index < to; index++) {
    for (const branch of branches) {
      if (branch.index === index) {
        chain = multiplyMatrix(chain, branchMatrix(frequency, branch));
      }
    }
    const area = Math.max(areas[index], 1e-4);
    chain = multiplyMatrix(
      chain,
      sectionMatrix(frequency, area, sectionLength, loss)
    );
    if (wall) {
      // Times the shunt [1 0; Y 1].
      const admittance = wallAdmittance(
        frequency,
        wallSurface(area, sectionLength),
        wall
      );
      chain[0] = add(chain[0], multiply(chain[1], admittance));
      chain[2] = add(chain[2], multiply(chain[3], admittance));
    }
  }
  return chain;
}

/**
 * Boundary-layer loss of a 1 cm² section (nepers per cm) and the yielding
 * wall of the tract for tubeTransfer's options.
 */
function tractLosses(frequency, options) {
  const head = options.head ?? {};
  const wallLoss = head.wallLoss ?? 1;
  const loss =
    options.loss === undefined
      ? viscothermalLoss(
          frequency,
          1,
          (options.lossShape ?? LOSS_SHAPE) * wallLoss
        )
      : options.loss * Math.sqrt(frequency);
  const wall =
    options.walls === false
      ? null
      : {
          mass: head.wallMass ?? WALL_MASS,
          resistance: (head.wallResistance ?? WALL_RESISTANCE) * wallLoss,
          stiffness: head.wallStiffness ?? WALL_STIFFNESS,
        };
  return { loss, wall };
}

/** Chain from the glottis to section `index` and the pressure there. */
function probePressure(frequency, tract, index, load) {
  return drive(chainOf(frequency, tract, index), load).pressure;
}

/** Flow entering a chain and pressure at its input for unit output flow. */
function drive(chain, load) {
  return {
    pressure: add(multiply(chain[0], load), chain[1]),
    flow: add(multiply(chain[2], load), chain[3]),
  };
}

/**
 * Volume velocity transfer function |U_lips / U_glottis| of a tube.
 * @param {ArrayLike<number>} areas Areas in cm², glottis first.
 * @param {number} length Total length in cm.
 * @param {number} frequency Hz.
 * @param {{
 *   head?: {wallLoss?: number, wallMass?: number, wallResistance?: number,
 *     wallStiffness?: number},
 *   lossShape?: number,
 *   walls?: boolean,
 *   baffle?: number,
 *   loss?: number,
 *   branches?: {index: number, area: number, length: number}[],
 *   nose?: {areas: ArrayLike<number>, length: number, velumArea: number,
 *     velumIndex: number, loss?: number, branches?: object[]},
 *   output?: 'both' | 'lips' | 'nostrils' | 'pressure',
 *   probe?: number,
 * }} [options]
 *   The walls lose viscothermalLoss of `lossShape` (LOSS_SHAPE) times a
 *   round tube, and yield with the wall parameters of `head` unless
 *   `walls` is false (both scaled by `head.wallLoss`, see losses.js); a
 *   number `loss` replaces the boundary-layer loss by the constant
 *   loss sqrt(f / area) of earlier versions. `baffle` sets the radiation
 *   load (RADIATION_BAFFLE; 0 is a free pipe end).
 *   `branches` are blind side tubes (the piriform fossae) joined in front
 *   of section `index`; a branch with a `volume` is a Helmholtz resonator
 *   (see branchMatrix). `nose` is the nasal tract, joined in front of
 *   section `velumIndex` through a port of `velumArea` that replaces its
 *   first section (as in the waveguide) and radiating from the nostrils;
 *   the result is then |U_lips + U_nostrils| / |U_glottis|, or the flow
 *   of the lips or of the nostrils alone with `output`. Its own `branches`
 *   (the sinuses) join in front of nose sections.
 */
export function tubeTransfer(areas, length, frequency, options = {}) {
  const { loss, wall } = tractLosses(frequency, options);
  const baffle = options.baffle ?? RADIATION_BAFFLE;
  const branches = options.branches ?? [];
  const sectionLength = length / areas.length;
  const nose = options.nose;
  const lips = radiationImpedance(
    frequency,
    Math.max(areas.at(-1), 1e-3),
    baffle
  );
  const tract = { areas, sectionLength, loss, branches, wall };
  if (!nose || !(nose.velumArea > 1e-4)) {
    const glottal = drive(chainOf(frequency, tract), lips).flow;
    const radiated =
      options.output === 'pressure'
        ? probePressure(frequency, tract, options.probe ?? 0, lips)
        : complex(1);
    const result = divide(radiated, glottal);
    return Math.hypot(result.re, result.im);
  }
  const split = Math.max(0, Math.min(areas.length, nose.velumIndex));
  const front = chainOf(frequency, tract, 0, split);
  const back = chainOf(frequency, tract, split);
  const noseAreas = Array.from(nose.areas);
  noseAreas[0] = nose.velumArea;
  const noseChain = chainOf(frequency, {
    areas: noseAreas,
    sectionLength: nose.length / noseAreas.length,
    loss: nose.loss === undefined ? loss : nose.loss * Math.sqrt(frequency),
    branches: nose.branches ?? [],
    wall: null,
  });
  const nostrils = radiationImpedance(
    frequency,
    Math.max(noseAreas.at(-1), 1e-3),
    baffle
  );
  // Unit flow at the lips fixes the pressure at the velar junction; the
  // nose carries the flow that this pressure drives out of the nostrils.
  const oral = drive(back, lips);
  const nasal = drive(noseChain, nostrils);
  const nostrilFlow = divide(oral.pressure, nasal.pressure);
  const junctionFlow = add(oral.flow, multiply(nasal.flow, nostrilFlow));
  const glottalFlow = add(
    multiply(front[2], oral.pressure),
    multiply(front[3], junctionFlow)
  );
  const radiated = {
    both: add(complex(1), nostrilFlow),
    lips: complex(1),
    nostrils: nostrilFlow,
  }[options.output ?? 'both'];
  const result = divide(radiated, glottalFlow);
  return Math.hypot(result.re, result.im);
}

/**
 * Spectrum of the transfer function on a linear frequency grid.
 * @returns {{frequencies: Float64Array, magnitudes: Float64Array}}
 */
export function tubeSpectrum(areas, length, options = {}) {
  const step = options.step ?? 5;
  const maxFrequency = options.maxFrequency ?? 5000;
  const count = Math.floor(maxFrequency / step);
  const frequencies = new Float64Array(count);
  const magnitudes = new Float64Array(count);
  for (let index = 0; index < count; index++) {
    frequencies[index] = (index + 1) * step;
    magnitudes[index] = tubeTransfer(
      areas,
      length,
      frequencies[index],
      options
    );
  }
  return { frequencies, magnitudes };
}

/**
 * Peak frequencies (formants) of a magnitude spectrum above `from` Hz:
 * below 100 Hz the yielding walls only add a bump of a few per cent (the
 * air in the tract moving on the wall stiffness), which is not a formant.
 * @param {{frequencies: ArrayLike<number>, magnitudes: ArrayLike<number>}} spectrum
 * @param {number} [count]
 * @param {number} [from]
 */
export function findPeaks({ frequencies, magnitudes }, count = 4, from = 100) {
  const peaks = [];
  for (let index = 1; index < magnitudes.length - 1; index++) {
    if (
      frequencies[index] >= from &&
      magnitudes[index] > magnitudes[index - 1] &&
      magnitudes[index] >= magnitudes[index + 1]
    ) {
      // Parabolic interpolation of the peak position.
      const left = magnitudes[index - 1];
      const middle = magnitudes[index];
      const right = magnitudes[index + 1];
      const offset = (0.5 * (left - right)) / (left - 2 * middle + right || 1);
      const step = frequencies[1] - frequencies[0];
      peaks.push(frequencies[index] + offset * step);
    }
  }
  return peaks.slice(0, count);
}

/** Formant frequencies of an area function. */
export function tubeFormants(areas, length, options = {}) {
  return findPeaks(tubeSpectrum(areas, length, options), options.count ?? 4);
}
