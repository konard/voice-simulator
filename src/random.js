/**
 * Deterministic pseudo-random numbers.
 *
 * Every random choice in the simulator (head proportions, jitter, aspiration
 * noise) goes through a seeded generator so that a seed reproduces exactly
 * the same voice in the browser, the CLI, the server and the tests.
 */

/**
 * Hash a string or number into a 32-bit unsigned seed (FNV-1a).
 * @param {string|number} value
 * @returns {number}
 */
export function hashSeed(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value >>> 0;
  }
  const text = String(value ?? '');
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * @typedef {(() => number) & {save: () => number, restore: (state: number) => void}} Random
 */

/**
 * Create a mulberry32 generator returning floats in [0, 1).
 *
 * `random.save()` returns the 32-bit state and `random.restore(state)` sets
 * it back (issue 29: a renderer started mid-utterance continues the
 * sequence of the one it replaces). Neither changes the numbers drawn.
 * @param {string|number} seed
 * @returns {Random}
 */
export function createRandom(seed = 1) {
  // The generator advances at the solver rate. Store its full unsigned
  // state without boxing a number in the closure at each step.
  const state = new Uint32Array([hashSeed(seed) || 0x9e3779b9]);
  const random = () => {
    let value = (state[0] + 0x6d2b79f5) >>> 0;
    state[0] = value;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  random.save = () => state[0];
  random.restore = (saved) => {
    state[0] = saved;
  };
  return random;
}

/**
 * Approximately normal random value (Irwin-Hall with 4 samples).
 * @param {() => number} random
 * @returns {number} value with mean 0 and standard deviation ~1
 */
export function randomNormal(random) {
  const sum = random() + random() + random() + random();
  return (sum - 2) * Math.sqrt(3);
}

/**
 * Create a random seed string suitable for URLs.
 * @returns {string}
 */
export function createSeed() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues) {
    const values = new Uint32Array(1);
    cryptoApi.getRandomValues(values);
    return values[0].toString(36);
  }
  return Math.floor(Math.random() * 2 ** 32).toString(36);
}
