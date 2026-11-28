/**
 * Tone stream of the Gaussian HMM recogniser (issue 75). The spectral
 * features see the pitch of ±4 frames through the LDA, too short for a
 * Mandarin tone: a level tone after a low one rises through its whole
 * vowel in the simulator's target approximation (tone-model.js), as steeply
 * as a rising tone. The tone stream looks at the shape of the pitch over
 * up to ±30 frames: height, slopes over ±5 and ±10 frames, curvature over
 * ±10, height against the ±30-frame mean, and voicing. Small diagonal
 * Gaussian mixtures per tone class and state (and one for every state
 * without a tone) score it; the decoder adds `toneWeight` times the log
 * posterior of the tone class among the classes of the same state (equal
 * priors) to the spectral score of a toned state, and nothing to the other
 * states, so the stream ranks the tones of a vowel without favouring toned
 * words, or Mandarin, over the rest.
 * Unlicense.
 */

export const HMM_TONE_DIMS = 6;

const NEAR_WIDTH = 5;
const MID_WIDTH = 10;
const WIDE_WIDTH = 30;

/** Sum of offset powers across a symmetric window. */
function offsetMoment(width, power) {
  let sum = 0;
  for (let k = 1; k <= width; k++) {
    sum += k ** power;
  }
  return 2 * sum;
}

const NEAR_SQUARES = offsetMoment(NEAR_WIDTH, 2);
const MID_SQUARES = offsetMoment(MID_WIDTH, 2);
const MID_CURVATURE =
  offsetMoment(MID_WIDTH, 4) -
  (MID_SQUARES * MID_SQUARES) / (2 * MID_WIDTH + 1);

function heldSample(values, index) {
  return values[Math.min(values.length - 1, Math.max(0, index))];
}

function windowMean(values, center, width) {
  let mean = 0;
  for (let k = -width; k <= width; k++) {
    mean += heldSample(values, center + k);
  }
  return mean / (2 * width + 1);
}

/**
 * Tone-stream features, `frames × HMM_TONE_DIMS`, from log2 f0 relative to
 * the utterance median (interpolated across unvoiced frames) and voicing.
 * @param {ArrayLike<number>} lf0
 * @param {ArrayLike<number>} voicing
 * @returns {Float32Array}
 */
export function hmmToneFeatures(lf0, voicing) {
  const frames = lf0.length;
  const out = new Float32Array(frames * HMM_TONE_DIMS);
  for (let t = 0; t < frames; t++) {
    const mean = windowMean(lf0, t, MID_WIDTH);
    let nearSlope = 0;
    let midSlope = 0;
    let midCurve = 0;
    for (let k = -MID_WIDTH; k <= MID_WIDTH; k++) {
      const value = heldSample(lf0, t + k);
      const slope = k * value;
      if (Math.abs(k) <= NEAR_WIDTH) {
        nearSlope += slope;
      }
      midSlope += slope;
      midCurve += k * k * (value - mean);
    }
    const at = t * HMM_TONE_DIMS;
    out[at] = 4 * lf0[t];
    out[at + 1] = 40 * (nearSlope / NEAR_SQUARES);
    out[at + 2] = 40 * (midSlope / MID_SQUARES);
    out[at + 3] = 400 * (midCurve / MID_CURVATURE);
    out[at + 4] = 4 * (lf0[t] - windowMean(lf0, t, WIDE_WIDTH));
    out[at + 5] = voicing[t];
  }
  return out;
}

/** Tone-stream key of a state: "c#s" for tone class c, state s, else "0". */
export function toneKey(unit, state) {
  const c = /@(\d)$/u.exec(unit)?.[1];
  return c ? `${c}#${state}` : '0';
}

/**
 * Unpack the shipped tone mixtures into the flat layout of `stateScore`
 * (hmm-model.js) and map every spectral state to its mixture.
 * @param {{dims: number, keys: string[], components: number[][]}} data
 *   components `[key index, ln weight, ...means, ...variances]`, grouped by key.
 * @param {string[]} units
 * @param {Map<string, number>} contextIndex "unit#s:context" → state
 */
export function unpackHmmTone(data, units, contextIndex) {
  const { dims, keys, components } = data;
  const first = new Int32Array(keys.length + 1);
  const mu = new Float32Array(components.length * dims);
  const inv = new Float32Array(components.length * dims);
  const norm = new Float64Array(components.length);
  for (const [key] of components) {
    first[key + 1]++;
  }
  for (let k = 0; k < keys.length; k++) {
    first[k + 1] += first[k];
  }
  components.forEach(([, logWeight, ...values], c) => {
    let sum = logWeight;
    for (let d = 0; d < dims; d++) {
      const variance = values[dims + d];
      mu[c * dims + d] = values[d];
      inv[c * dims + d] = 0.5 / variance;
      sum -= 0.5 * Math.log(2 * Math.PI * variance);
    }
    norm[c] = sum;
  });
  const index = new Map(keys.map((key, i) => [key, i]));
  const of = (unit, state) => index.get(toneKey(unit, state)) ?? index.get('0');
  const ofState = new Int32Array(3 * units.length + contextIndex.size);
  units.forEach((unit, u) => {
    for (let s = 0; s < 3; s++) {
      ofState[3 * u + s] = of(unit, s);
    }
  });
  for (const [key, m] of contextIndex) {
    const [unit, rest] = key.split('#');
    ofState[m] = of(unit, Number(rest[0]));
  }
  // Tone class keys share a normaliser per state: "c#s" → s, "0" → -1.
  const stateOfKey = Int8Array.from(keys, (key) =>
    key === '0' ? -1 : Number(key.split('#')[1])
  );
  return {
    dims,
    keys,
    states: keys.length,
    first,
    mu,
    inv,
    norm,
    ofState,
    stateOfKey,
  };
}
