/**
 * Band-limited sample-rate conversion (Blackman-windowed sinc).
 *
 * Accurate enough to convert recordings for matching or to export at a
 * player's preferred rate; the error on a mid-band tone is below -60 dB.
 */

function blackman(x) {
  return 0.42 + 0.5 * Math.cos(Math.PI * x) + 0.08 * Math.cos(2 * Math.PI * x);
}

function sinc(x) {
  if (x === 0) {
    return 1;
  }
  const angle = Math.PI * x;
  return Math.sin(angle) / angle;
}

/**
 * Resample mono samples to another rate.
 * @param {ArrayLike<number>} samples
 * @param {number} fromRate
 * @param {number} toRate
 * @param {{zeroCrossings?: number}} [options] Filter half-length in zero
 *   crossings of the low-pass (default 16; more is sharper and slower).
 * @returns {Float32Array}
 */
export function resample(samples, fromRate, toRate, options = {}) {
  if (!(fromRate > 0) || !(toRate > 0)) {
    throw new Error('Sample rates must be positive');
  }
  if (fromRate === toRate) {
    return Float32Array.from(samples);
  }
  const ratio = toRate / fromRate;
  // Keep a small guard band below the lower Nyquist frequency.
  const cutoff = Math.min(1, ratio) * 0.97;
  const halfWidth = (options.zeroCrossings ?? 16) / cutoff;
  const length = Math.round(samples.length * ratio);
  const result = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    const center = index / ratio;
    const first = Math.max(0, Math.ceil(center - halfWidth));
    const last = Math.min(samples.length - 1, Math.floor(center + halfWidth));
    let sum = 0;
    for (let source = first; source <= last; source++) {
      const distance = center - source;
      sum +=
        samples[source] *
        cutoff *
        sinc(cutoff * distance) *
        blackman(distance / halfWidth);
    }
    result[index] = sum;
  }
  return result;
}
