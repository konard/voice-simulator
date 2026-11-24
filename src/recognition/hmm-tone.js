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

/** Mean, least-squares slope and curvature of v over t ± w (edges held). */
function window(v, t, w) {
  const n = v.length;
  const at = (k) => v[Math.min(n - 1, Math.max(0, t + k))];
  const count = 2 * w + 1;
  let mean = 0;
  let k2 = 0;
  let k4 = 0;
  for (let k = -w; k <= w; k++) {
    mean += at(k);
    k2 += k * k;
    k4 += k ** 4;
  }
  mean /= count;
  let slope = 0;
  let curve = 0;
  for (let k = -w; k <= w; k++) {
    const y = at(k);
    slope += k * y;
    curve += k * k * (y - mean);
  }
  return {
    mean,
    slope: slope / k2,
    curve: curve / (k4 - (k2 * k2) / count),
  };
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
    const near = window(lf0, t, 5);
    const mid = window(lf0, t, 10);
    const wide = window(lf0, t, 30);
    out.set(
      [
        4 * lf0[t],
        40 * near.slope,
        40 * mid.slope,
        400 * mid.curve,
        4 * (lf0[t] - wide.mean),
        voicing[t],
      ],
      t * HMM_TONE_DIMS
    );
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
