/**
 * Programme loudness after ITU-R BS.1770 (mono): K-weighting, 400 ms
 * blocks with 75 % overlap, an absolute gate at -70 LUFS and a relative
 * gate 10 LU below the loudness of the blocks above it. A sine of 997 Hz
 * and amplitude 1 measures -3.01 LUFS. EBU R 128 asks for -23 LUFS.
 */

/** Filters of the K-weighting from their analogue prototypes. */
const SHELF = Object.freeze({
  frequency: 1681.974450955533,
  gain: 3.999843853973347,
  q: 0.7071752369554196,
});
const HIGHPASS = Object.freeze({
  frequency: 38.13547087602444,
  q: 0.5003270373238773,
});

/** Offset of the loudness formula, LUFS = -0.691 + 10 log10(mean square). */
const OFFSET = -0.691;
const BLOCK = 0.4;
const STEP = 0.1;
const ABSOLUTE_GATE = -70;
const RELATIVE_GATE = -10;

/**
 * The two biquads of the K-weighting at a sample rate: `[b0, b1, b2, a1,
 * a2]` each; at 48 kHz they are the coefficients of BS.1770.
 * @param {number} sampleRate
 */
export function kWeighting(sampleRate) {
  let k = Math.tan((Math.PI * SHELF.frequency) / sampleRate);
  const vh = 10 ** (SHELF.gain / 20);
  const vb = vh ** 0.4996667741545416;
  let a0 = 1 + k / SHELF.q + k * k;
  const shelf = [
    (vh + (vb * k) / SHELF.q + k * k) / a0,
    (2 * (k * k - vh)) / a0,
    (vh - (vb * k) / SHELF.q + k * k) / a0,
    (2 * (k * k - 1)) / a0,
    (1 - k / SHELF.q + k * k) / a0,
  ];
  k = Math.tan((Math.PI * HIGHPASS.frequency) / sampleRate);
  a0 = 1 + k / HIGHPASS.q + k * k;
  const highpass = [
    1,
    -2,
    1,
    (2 * (k * k - 1)) / a0,
    (1 - k / HIGHPASS.q + k * k) / a0,
  ];
  return [shelf, highpass];
}

function filter(input, [b0, b1, b2, a1, a2]) {
  const output = new Float64Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let index = 0; index < input.length; index++) {
    const x = input[index];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    output[index] = y;
  }
  return output;
}

/**
 * Integrated loudness of mono samples in LUFS (BS.1770); -Infinity for a
 * signal shorter than one block or below the absolute gate.
 * @param {ArrayLike<number>} samples
 * @param {number} sampleRate
 */
export function integratedLoudness(samples, sampleRate) {
  const [shelf, highpass] = kWeighting(sampleRate);
  const weighted = filter(filter(samples, shelf), highpass);
  const block = Math.round(BLOCK * sampleRate);
  const step = Math.round(STEP * sampleRate);
  const squares = new Float64Array(weighted.length + 1);
  for (let index = 0; index < weighted.length; index++) {
    squares[index + 1] = squares[index] + weighted[index] * weighted[index];
  }
  const powers = [];
  for (let start = 0; start + block <= weighted.length; start += step) {
    powers.push((squares[start + block] - squares[start]) / block);
  }
  const loudness = (power) => OFFSET + 10 * Math.log10(power);
  const mean = (values) =>
    values.reduce((sum, value) => sum + value, 0) / values.length;
  const audible = powers.filter((power) => loudness(power) > ABSOLUTE_GATE);
  if (audible.length === 0) {
    return -Infinity;
  }
  const gate = loudness(mean(audible)) + RELATIVE_GATE;
  const gated = audible.filter((power) => loudness(power) > gate);
  return loudness(mean(gated));
}

/**
 * Scale samples to a loudness target (LUFS), but never above a peak of
 * `peak` (default 0.98): a new Float32Array, the gain in dB and the
 * loudness reached.
 * @param {Float32Array} samples
 * @param {number} sampleRate
 * @param {number} target LUFS, for example -23 (EBU R 128)
 * @param {{peak?: number}} [options]
 * @returns {{samples: Float32Array, gainDb: number, loudness: number}}
 */
export function normalizeLoudness(samples, sampleRate, target, options = {}) {
  const measured = integratedLoudness(samples, sampleRate);
  if (!Number.isFinite(measured)) {
    return {
      samples: Float32Array.from(samples),
      gainDb: 0,
      loudness: measured,
    };
  }
  let peak = 0;
  for (const value of samples) {
    peak = Math.max(peak, Math.abs(value));
  }
  let gainDb = target - measured;
  const limit = options.peak ?? 0.98;
  if (peak > 0 && peak * 10 ** (gainDb / 20) > limit) {
    gainDb = 20 * Math.log10(limit / peak);
  }
  const gain = 10 ** (gainDb / 20);
  const scaled = samples.map((value) => value * gain);
  return { samples: scaled, gainDb, loudness: measured + gainDb };
}
