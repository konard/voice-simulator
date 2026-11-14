/**
 * Frequency-domain analysis of a tube (area function) with the classic
 * chain-matrix (ABCD) method. This is used to validate the time-domain
 * solvers and to show formants in the UI: it is exact for a concatenation
 * of uniform cylinders, with simple viscous/thermal losses and a piston
 * radiation load at the lips.
 */

export const SPEED_OF_SOUND = 35000; // cm/s, warm humid air in the tract
export const AIR_DENSITY = 0.00114; // g/cm³

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

/** Piston-in-baffle radiation impedance at the lips. */
function radiationImpedance(frequency, area) {
  const radius = Math.sqrt(area / Math.PI);
  const ka = (2 * Math.PI * frequency * radius) / SPEED_OF_SOUND;
  const characteristic = (AIR_DENSITY * SPEED_OF_SOUND) / area;
  return complex(
    (characteristic * ka * ka) / 2,
    (characteristic * 8 * ka) / (3 * Math.PI)
  );
}

function sectionMatrix(frequency, area, length, loss) {
  const omega = 2 * Math.PI * frequency;
  const impedance = (AIR_DENSITY * SPEED_OF_SOUND) / area;
  // Boundary-layer losses grow with sqrt(f) and with perimeter / area.
  const alpha = (loss * Math.sqrt(frequency)) / Math.sqrt(area);
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
  if (!volume) {
    const admittance =
      (area / (AIR_DENSITY * SPEED_OF_SOUND)) *
      Math.tan((2 * Math.PI * frequency * length) / SPEED_OF_SOUND);
    return [complex(1), complex(0), complex(0, admittance), complex(1)];
  }
  const compliance = volume / (AIR_DENSITY * SPEED_OF_SOUND ** 2);
  const cavity = complex(0, -1 / (2 * Math.PI * frequency * compliance));
  const neck = sectionMatrix(frequency, area, length, loss);
  const impedance = divide(
    add(multiply(neck[0], cavity), neck[1]),
    add(multiply(neck[2], cavity), neck[3])
  );
  return [complex(1), complex(0), divide(complex(1), impedance), complex(1)];
}

/**
 * Chain matrix of sections `from` to `to` of a tube {areas, sectionLength,
 * loss, branches}, with each branch joined in front of its section.
 */
function chainOf(frequency, tube, from = 0, to = tube.areas.length) {
  const { areas, sectionLength, loss, branches } = tube;
  let chain = [complex(1), complex(0), complex(0), complex(1)];
  for (let index = from; index < to; index++) {
    for (const branch of branches) {
      if (branch.index === index) {
        chain = multiplyMatrix(chain, branchMatrix(frequency, branch));
      }
    }
    chain = multiplyMatrix(
      chain,
      sectionMatrix(
        frequency,
        Math.max(areas[index], 1e-4),
        sectionLength,
        loss
      )
    );
  }
  return chain;
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
 *   loss?: number,
 *   branches?: {index: number, area: number, length: number}[],
 *   nose?: {areas: ArrayLike<number>, length: number, velumArea: number,
 *     velumIndex: number, loss?: number, branches?: object[]},
 * }} [options]
 *   `branches` are blind side tubes (the piriform fossae) joined in front
 *   of section `index`; a branch with a `volume` is a Helmholtz resonator
 *   (see branchMatrix). `nose` is the nasal tract, joined in front of
 *   section `velumIndex` through a port of `velumArea` that replaces its
 *   first section (as in the waveguide) and radiating from the nostrils;
 *   the result is then |U_lips + U_nostrils| / |U_glottis|. Its own
 *   `branches` (the sinuses) join in front of nose sections.
 */
export function tubeTransfer(areas, length, frequency, options = {}) {
  const loss = options.loss ?? 2e-5;
  const branches = options.branches ?? [];
  const sectionLength = length / areas.length;
  const nose = options.nose;
  const lips = radiationImpedance(frequency, Math.max(areas.at(-1), 1e-3));
  const tract = { areas, sectionLength, loss, branches };
  if (!nose || !(nose.velumArea > 1e-4)) {
    const result = divide(
      complex(1),
      drive(chainOf(frequency, tract), lips).flow
    );
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
    loss: nose.loss ?? loss,
    branches: nose.branches ?? [],
  });
  const nostrils = radiationImpedance(
    frequency,
    Math.max(noseAreas.at(-1), 1e-3)
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
  const result = divide(add(complex(1), nostrilFlow), glottalFlow);
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
 * Peak frequencies (formants) of a magnitude spectrum.
 * @param {{frequencies: ArrayLike<number>, magnitudes: ArrayLike<number>}} spectrum
 * @param {number} [count]
 */
export function findPeaks({ frequencies, magnitudes }, count = 4) {
  const peaks = [];
  for (let index = 1; index < magnitudes.length - 1; index++) {
    if (
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
