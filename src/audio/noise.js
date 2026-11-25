/**
 * Seeded noise to lay over speech at a known signal-to-noise ratio (issue
 * 170): the recognizer's quality baseline under the noise a microphone
 * hears. Every generator returns unit-RMS samples unless a level is given.
 * Unlicense.
 */
import { createRandom } from '../random.js';

/** Noise kinds, from spectral slopes to the noises of rooms and devices. */
export const NOISE_TYPES = [
  'white',
  'pink',
  'brown',
  'blue',
  'violet',
  'speech-shaped',
  'babble',
  'hum',
  'crackle',
  'drifting',
];

function gaussian(random) {
  // Box-Muller; 1 - random() keeps the logarithm finite.
  const u = 1 - random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

function whiteNoise(length, random) {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = gaussian(random);
  }
  return out;
}

/** -3 dB per octave: Paul Kellet's sum of first-order filters of white. */
function pinkNoise(length, random) {
  const out = new Float32Array(length);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let i = 0; i < length; i++) {
    const w = gaussian(random);
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
  return out;
}

/** -6 dB per octave: leaky integral of white, without its DC drift. */
function brownNoise(length, random) {
  const out = new Float32Array(length);
  let y = 0;
  for (let i = 0; i < length; i++) {
    y = 0.995 * y + gaussian(random);
    out[i] = y;
  }
  return out;
}

/** First difference: +6 dB per octave over the source's slope. */
function differenced(samples) {
  const out = new Float32Array(samples.length);
  let previous = 0;
  for (let i = 0; i < samples.length; i++) {
    out[i] = samples[i] - previous;
    previous = samples[i];
  }
  return out;
}

function onePole(samples, cutoff, sampleRate, highPass = false) {
  const a = Math.exp(
    (-2 * Math.PI * Math.min(cutoff, sampleRate / 2)) / sampleRate
  );
  const out = new Float32Array(samples.length);
  let y = 0;
  for (let i = 0; i < samples.length; i++) {
    y = (1 - a) * samples[i] + a * y;
    out[i] = highPass ? samples[i] - y : y;
  }
  return out;
}

/**
 * The long-term spectrum of speech: flat to about 500 Hz, falling about
 * 9 dB per octave above it (two first-order low passes over pink), with
 * the rumble under 100 Hz removed.
 */
function speechShapedNoise(length, sampleRate, random) {
  const pink = pinkNoise(length, random);
  const low = onePole(onePole(pink, 800, sampleRate), 2500, sampleRate);
  return onePole(low, 100, sampleRate, true);
}

/**
 * Several talkers at once: reversed copies of the speech, each shifted by a
 * different seeded delay, so the babble has the voice's spectrum but no
 * words of it. Without speech it is speech-shaped noise at a syllable rate.
 */
function babbleNoise(length, sampleRate, random, source) {
  const out = new Float32Array(length);
  if (!source?.length) {
    const shaped = speechShapedNoise(length, sampleRate, random);
    const phases = [0, 1, 2, 3].map(() => 2 * Math.PI * random());
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      let envelope = 0;
      for (const [k, phase] of phases.entries()) {
        envelope += 1 + Math.sin(2 * Math.PI * (3 + k * 0.7) * t + phase);
      }
      out[i] = shaped[i] * envelope;
    }
    return out;
  }
  const talkers = 6;
  for (let k = 0; k < talkers; k++) {
    const shift = Math.floor(random() * source.length);
    const gain = 0.6 + 0.8 * random();
    for (let i = 0; i < length; i++) {
      const j = (shift + i) % source.length;
      out[i] += gain * source[source.length - 1 - j];
    }
  }
  return out;
}

/** Mains hum: 50 Hz (or `mains`) and its harmonics over a quiet hiss. */
function humNoise(length, sampleRate, random, mains = 50) {
  const out = whiteNoise(length, random);
  const phases = Array.from({ length: 8 }, () => 2 * Math.PI * random());
  for (let i = 0; i < length; i++) {
    let hum = 0;
    for (let k = 1; k <= 8 && k * mains < sampleRate / 2; k++) {
      hum +=
        Math.sin((2 * Math.PI * k * mains * i) / sampleRate + phases[k - 1]) /
        k;
    }
    out[i] = hum + 0.02 * out[i];
  }
  return out;
}

/** Clicks and pops: sparse decaying impulses, about 20 a second. */
function crackleNoise(length, sampleRate, random) {
  const out = whiteNoise(length, random);
  for (let i = 0; i < length; i++) {
    out[i] *= 0.01;
  }
  const rate = 20 / sampleRate;
  const decay = Math.exp(-1 / (0.002 * sampleRate));
  let level = 0;
  for (let i = 0; i < length; i++) {
    if (random() < rate) {
      level = (random() < 0.5 ? -1 : 1) * (0.3 + random());
    }
    out[i] += level * gaussian(random);
    level *= decay;
  }
  return out;
}

/**
 * Pink noise whose level wanders by up to 20 dB in smooth seeded steps of
 * 0.2 to 0.5 s, like a room with traffic, fans and movement. A steady
 * noise fails the recognizer's energy contrast check; this one does not.
 */
function driftingNoise(length, sampleRate, random) {
  const out = pinkNoise(length, random);
  let i = 0;
  let from = 0;
  while (i < length) {
    const step = Math.max(1, Math.round((0.2 + 0.3 * random()) * sampleRate));
    const to = -20 * random();
    for (let j = 0; j < step && i < length; j++, i++) {
      const db = from + ((to - from) * j) / step;
      out[i] *= 10 ** (db / 20);
    }
    from = to;
  }
  return out;
}

function rms(samples) {
  let energy = 0;
  for (let i = 0; i < samples.length; i++) {
    energy += samples[i] * samples[i];
  }
  return Math.sqrt(energy / Math.max(1, samples.length));
}

function scaled(samples, target) {
  const level = rms(samples);
  const gain = level > 0 ? target / level : 0;
  for (let i = 0; i < samples.length; i++) {
    samples[i] *= gain;
  }
  return samples;
}

function checkType(type) {
  if (!NOISE_TYPES.includes(type)) {
    throw new RangeError(
      `Unknown noise type: ${type}; use ${NOISE_TYPES.join(', ')}`
    );
  }
}

/**
 * Seeded noise of a kind.
 * @param {string} type one of NOISE_TYPES
 * @param {number} length samples
 * @param {number} sampleRate Hz
 * @param {{seed?: string|number, level?: number, mains?: number,
 *   source?: ArrayLike<number>}} [options] `level` is the RMS in dBFS
 *   (default 0: unit RMS); `mains` the hum frequency (50 Hz); `source` the
 *   speech babble is made of.
 * @returns {Float32Array}
 */
export function createNoise(type, length, sampleRate, options = {}) {
  checkType(type);
  if (!Number.isInteger(length) || length < 0) {
    throw new RangeError('length must be a non-negative integer');
  }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('sampleRate must be positive');
  }
  const random = createRandom(options.seed ?? 1);
  const makers = {
    white: () => whiteNoise(length, random),
    pink: () => pinkNoise(length, random),
    brown: () => brownNoise(length, random),
    blue: () => differenced(pinkNoise(length, random)),
    violet: () => differenced(whiteNoise(length, random)),
    'speech-shaped': () => speechShapedNoise(length, sampleRate, random),
    babble: () => babbleNoise(length, sampleRate, random, options.source),
    hum: () => humNoise(length, sampleRate, random, options.mains),
    crackle: () => crackleNoise(length, sampleRate, random),
    drifting: () => driftingNoise(length, sampleRate, random),
  };
  return scaled(makers[type](), 10 ** ((options.level ?? 0) / 20));
}

/**
 * Speech with noise of a kind at a signal-to-noise ratio, measured over the
 * whole input (its RMS over the noise's). The input is not changed; the
 * output is not clipped. Babble is made of the input itself.
 * @param {ArrayLike<number>} samples
 * @param {number} sampleRate
 * @param {{type?: string, snr?: number, seed?: string|number,
 *   mains?: number}} [options] `type` defaults to white, `snr` to 20 dB;
 *   an infinite SNR returns a copy.
 * @returns {Float32Array}
 */
export function addNoise(samples, sampleRate, options = {}) {
  const { type = 'white', snr = 20, seed = 1, mains } = options;
  checkType(type);
  if (Number.isNaN(snr)) {
    throw new RangeError('snr must be a number of dB');
  }
  const out = Float32Array.from(samples);
  const signal = rms(out);
  if (snr === Infinity || signal === 0) {
    return out;
  }
  const noise = createNoise(type, out.length, sampleRate, {
    seed,
    mains,
    source: samples,
    level: 20 * Math.log10(signal) - snr,
  });
  for (let i = 0; i < out.length; i++) {
    out[i] += noise[i];
  }
  return out;
}
