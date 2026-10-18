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
 * junction is j (A / rho c) tan(k L).
 */
function branchMatrix(frequency, { area, length }) {
  const admittance =
    (area / (AIR_DENSITY * SPEED_OF_SOUND)) *
    Math.tan((2 * Math.PI * frequency * length) / SPEED_OF_SOUND);
  return [complex(1), complex(0), complex(0, admittance), complex(1)];
}

/**
 * Volume velocity transfer function |U_lips / U_glottis| of a tube.
 * @param {ArrayLike<number>} areas Areas in cm², glottis first.
 * @param {number} length Total length in cm.
 * @param {number} frequency Hz.
 * @param {{loss?: number, branches?: {index: number, area: number, length: number}[]}} [options]
 *   `branches` are blind side tubes (the piriform fossae) joined in front
 *   of section `index`.
 */
export function tubeTransfer(areas, length, frequency, options = {}) {
  const loss = options.loss ?? 2e-5;
  const branches = options.branches ?? [];
  const sectionLength = length / areas.length;
  let chain = [complex(1), complex(0), complex(0), complex(1)];
  for (let index = 0; index < areas.length; index++) {
    const area = areas[index];
    for (const branch of branches) {
      if (branch.index === index) {
        chain = multiplyMatrix(chain, branchMatrix(frequency, branch));
      }
    }
    chain = multiplyMatrix(
      chain,
      sectionMatrix(frequency, Math.max(area, 1e-4), sectionLength, loss)
    );
  }
  const load = radiationImpedance(frequency, Math.max(areas.at(-1), 1e-3));
  const denominator = add(multiply(chain[2], load), chain[3]);
  const result = divide(complex(1), denominator);
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
