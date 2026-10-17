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
 * Create a mulberry32 generator returning floats in [0, 1).
 * @param {string|number} seed
 * @returns {() => number}
 */
export function createRandom(seed = 1) {
  let state = hashSeed(seed) || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
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
