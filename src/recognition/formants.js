/**
 * Formant tracker of the recognizer (issue 60).
 *
 * For every analysis frame of the front end (src/recognition/frontend.js)
 * the tracker turns the reflection coefficients into all-pole models of the
 * orders p, p - 2 and p - 4, finds their roots by the Aberth-Ehrlich
 * iteration, and keeps the narrow resonances as candidates (McCandless
 * 1974). A dynamic programming search over all ways to number the
 * candidates F1 .. FK, with the local and transition costs of Praat's
 * formant tracker (Talkin 1987), chooses one numbering per frame, and a
 * Kalman filter with a Rauch-Tung-Striebel smoother per formant (Deng et
 * al. 2007) gives continuous tracks with a variance.
 *
 * Stage pattern of issue 58: `createFormantTracker(frames, options)` reads
 * `frames.reflection`, `frames.lpc`, `frames.gain`, `frames.speech`,
 * `frames.band` and `frames.rate`; `advance(final)` scores the frames that
 * have arrived and commits frame t when frame t + lag has been scored (all
 * frames with `final`). Rows of the track before `committed` never change.
 */

import { SPEED_OF_SOUND } from '../acoustics/constants.js';
import { lpcLevel, predictorFromReflection } from './lpc.js';

/**
 * Defaults. `vocalTractLength: null` estimates the length from the tracks;
 * `pitch` is a pitch track of issue 59 (src/recognition/pitch.js) whose f0
 * widens the observation variance above 200 Hz.
 */
export const FORMANT_DEFAULTS = Object.freeze({
  vocalTractLength: null,
  pitch: null,
  lag: 10,
  maxBandwidth: 700,
  keep: 12,
});

/** Columns of the output matrices (F1 .. F4). */
const COLUMNS = 4;
/** Length (cm) of the tract before it is estimated, and its limits. */
const DEFAULT_LENGTH = 16.5;
const MIN_LENGTH = 10;
const MAX_LENGTH = 20;
/** Batch: another pass when the estimate differs from the length of the
 * last pass by more, up to LENGTH_PASSES passes. The candidates kept by
 * the first search lean towards 16.5 cm: in the `estimates the tract
 * length` test of tests/recognition-formants.test.js a 13 cm tract ends
 * at 14.06 cm with LENGTH_PASSES 2 and at 13.82 cm with 3. */
const LENGTH_TOLERANCE = 0.05;
const LENGTH_PASSES = 3;
/** Stream: every LENGTH_EVERY committed frames, L moves LENGTH_STEP of the
 * way to the median of the estimates so far. */
const LENGTH_EVERY = 20;
const LENGTH_STEP = 0.1;
/** Frames of the length estimate: periodicity at least LENGTH_PERIODICITY
 * (the voiced threshold of the frontend), energy within LENGTH_RANGE dB of
 * the loudest speech frame so far and no nasal flag, i.e. vowels. In the
 * `estimates the tract length` test, every speech frame taken, the
 * consonants pull the estimates of the 13, 16.5 and 19 cm tracts to 14.01,
 * 17.61 and 19.95 cm, against 13.82, 17.24 and 19.43 cm on the vowel
 * frames; per vowel frame see experiments/issue-60-length.txt. */
const LENGTH_PERIODICITY = 0.6;
const LENGTH_RANGE = 10;
/** Model orders below p whose roots are candidates too. */
const ORDER_STEPS = [0, 2, 4];
/** Aberth-Ehrlich iteration: rounds, step limit and start values. */
const ABERTH_ROUNDS = 40;
const ABERTH_TOLERANCE = 1e-6;
const START_RADIUS = 0.9;
const START_PHASE = 0.1;
/** Candidates: lowest frequency, distance below the Nyquist frequency and
 * the top TOP_FREQUENCY * 16.5 / L (Hz). */
const MIN_FREQUENCY = 90;
const NYQUIST_MARGIN = 50;
const TOP_FREQUENCY = 5500;
/** A lower-order candidate this close (Hz) to a kept one is a duplicate. */
const MERGE_DISTANCE = 150;
/** Most candidates per frame. */
const MAX_CANDIDATES = 7;
/** Cost of an empty formant, and of a formant present on one side of a
 * transition only. */
const EMPTY_COST = 1.5;
const APPEAR_COST = 0.3;
/**
 * Local cost of a candidate f (bandwidth B) as formant k:
 * |f - ref[k]| / ref[k] + min(BANDWIDTH_WEIGHT B / f, BANDWIDTH_CAP).
 * The issue asks for |f - ref[k]| / 1000 + B / f; with that cost in
 * frameStates, the lone steady vowels of experiments/issue-60-vowels.mjs
 * (10 vowels x 3 presets x 2 rates, tract length estimated) have the F2
 * of /i/ of the female and child voices (about 2900 Hz, nearer ref[3] than
 * ref[2]) labelled F3 and 1756 frames invalid or more than 20 % off. The
 * relative distance with twice the bandwidth term, which keeps broad low
 * poles out of F1, and its cap leave 867 (experiments/issue-60-vowels.txt).
 */
const BANDWIDTH_WEIGHT = 2;
/**
 * Most the bandwidth term adds: without it the F1 of the child /i/ in the
 * vowel sequence of experiments/issue-60-sequence.mjs (529 Hz, B 369 Hz,
 * bandwidth term 1.40) costs more than an empty F1 and leaves 12 frames
 * invalid; 1.1 sends the tract length of a lone child /a/ to 20 cm, 1.3
 * does not (experiments/issue-60-vowels.txt).
 */
const BANDWIDTH_CAP = 1.3;
/** The path starts again after this many frames without speech. */
const RESET_RUN = 20;
/** Kalman filter: process noise (Hz per NOISE_HOP s) of F1 and of the
 * others, the floor of the observation deviation (Hz) and the f0 above
 * which harmonics pull the poles (Hz). */
const PROCESS_NOISE = [30, 60];
const NOISE_HOP = 0.005;
const OBSERVATION_FLOOR = 50;
const HIGH_PITCH = 200;
/** A formant empty for longer than this (s) is invalid. */
const MAX_GAP = 0.1;
/**
 * Nasal murmur: the lowest candidate below NASAL_RATIO ref[1] with a
 * bandwidth below NASAL_BANDWIDTH Hz, band 800-1500 Hz more than
 * -NASAL_BAND_DROP dB below band 0-400 Hz (band[1] - band[0] <
 * NASAL_BAND_DROP) and band 2000-3500 Hz more than -NASAL_HIGH_DROP dB
 * below band 800-1500 Hz (band[3] - band[1] < NASAL_HIGH_DROP). The last
 * test tells the murmur from a close front vowel such as i, whose F1 is as
 * low and narrow but whose F2 and F3 keep the high band up. The variance
 * of nasal frames is multiplied by NASAL_VARIANCE.
 *
 * The thresholds were chosen on simulator output by
 * `node experiments/issue-60-nasal.mjs` (experiments/issue-60-nasal.txt);
 * see that file for the frames, the share flagged and the search. The
 * issue gives NASAL_RATIO = 0.6, but the murmur of the simulator sits at
 * about 0.77 ref[1] (median), so with 0.6 hardly any nasal frame is
 * flagged.
 */
export const NASAL_BAND_DROP = -12;
export const NASAL_HIGH_DROP = -10;
export const NASAL_RATIO = 0.9;
const NASAL_BANDWIDTH = 200;
const NASAL_VARIANCE = 4;
/** sum_{k=1..3} ((2k - 1) / 2)^2 of the tract length fit. */
const LENGTH_WEIGHT = 0.25 + 2.25 + 6.25;

/** Throw a RangeError with `message` unless `ok`. */
function check(ok, message) {
  if (!ok) {
    throw new RangeError(message);
  }
}

/**
 * Length (cm) of the uniform tube, closed at the glottis and open at the
 * lips, whose resonances (2k - 1) c / (4 L) fit F1 .. F3 best in the least
 * squares sense: dF = sum_k F_k (2k - 1) / 2 / sum_k ((2k - 1) / 2)^2 and
 * L = c / (2 dF), with c = 35000 cm/s.
 * @param {number} f1 Hz.
 * @param {number} f2 Hz.
 * @param {number} f3 Hz.
 * @returns {number}
 */
export function tractLengthFromFormants(f1, f2, f3) {
  const spacing = (0.5 * f1 + 1.5 * f2 + 2.5 * f3) / LENGTH_WEIGHT;
  return SPEED_OF_SOUND / (2 * spacing);
}

/** Thresholds of the nasal flag: the options or the defaults, checked. */
function nasalSettings(options) {
  const nasalBandDrop = options.nasalBandDrop ?? NASAL_BAND_DROP;
  const nasalRatio = options.nasalRatio ?? NASAL_RATIO;
  const nasalHighDrop = options.nasalHighDrop ?? NASAL_HIGH_DROP;
  check(
    typeof nasalBandDrop === 'number' && !Number.isNaN(nasalBandDrop),
    `nasalBandDrop must be a number (dB), got ${nasalBandDrop}`
  );
  check(
    typeof nasalHighDrop === 'number' && !Number.isNaN(nasalHighDrop),
    `nasalHighDrop must be a number (dB), got ${nasalHighDrop}`
  );
  check(
    typeof nasalRatio === 'number' && nasalRatio >= 0,
    `nasalRatio must be a number >= 0, got ${nasalRatio}`
  );
  return { nasalBandDrop, nasalRatio, nasalHighDrop };
}

/** Merged and checked options with the derived numbers. */
function formantSettings(frames, options) {
  const merged = { ...FORMANT_DEFAULTS, ...options };
  const { rate, hop, order } = frames;
  const length = merged.vocalTractLength;
  check(
    length === null ||
      length === undefined ||
      (length >= MIN_LENGTH && length <= MAX_LENGTH),
    `vocalTractLength must be null or from ${MIN_LENGTH} to ${MAX_LENGTH} cm, got ${length}`
  );
  check(
    Number.isInteger(merged.lag) && merged.lag >= 0,
    `lag must be an integer >= 0, got ${merged.lag}`
  );
  check(
    merged.maxBandwidth > 0 && Number.isFinite(merged.maxBandwidth),
    `maxBandwidth must be finite and > 0, got ${merged.maxBandwidth}`
  );
  check(
    Number.isInteger(merged.keep) && merged.keep >= 1 && merged.keep <= 255,
    `keep must be an integer from 1 to 255, got ${merged.keep}`
  );
  check(
    merged.pitch === null ||
      merged.pitch === undefined ||
      merged.pitch.f0 instanceof Float32Array,
    'pitch must be null or a pitch track'
  );
  const { nasalBandDrop, nasalRatio, nasalHighDrop } = nasalSettings(merged);
  const orders = ORDER_STEPS.map((step) => order - step).filter((m) => m >= 2);
  const noiseScale = Math.sqrt(hop / NOISE_HOP);
  return {
    ...merged,
    rate,
    hop,
    order,
    orders,
    formants: rate <= 8000 ? 3 : 4,
    fixedLength: length ?? null,
    nasalBandDrop,
    nasalRatio,
    nasalHighDrop,
    pitch: merged.pitch ?? null,
    processNoise: [0, 1, 2, 3].map(
      (k) => (PROCESS_NOISE[Math.min(k, 1)] * noiseScale) ** 2
    ),
    maxGap: Math.round(MAX_GAP / hop + 1e-9),
  };
}

/**
 * Roots of z^m + a_1 z^(m-1) + ... + a_m by the Aberth-Ehrlich iteration,
 * in place on `re` and `im` (start values in, roots out). Each root moves
 * by w_i = n_i / (1 - n_i sum_{j != i} 1 / (z_i - z_j)) with
 * n_i = P(z_i) / P'(z_i), updated one after another. Returns 1 when every
 * step of a round is below the tolerance, 0 after the last round and -1
 * when a value is not finite.
 * @param {Float64Array} a
 * @param {number} m
 * @param {Float64Array} re
 * @param {Float64Array} im
 */
function aberthRoots(a, m, re, im) {
  for (let round = 0; round < ABERTH_ROUNDS; round++) {
    let largest = 0;
    for (let i = 0; i < m; i++) {
      const zr = re[i];
      const zi = im[i];
      // Horner: P(z) and P'(z).
      let pr = 1;
      let pi = 0;
      let dr = 0;
      let di = 0;
      for (let j = 0; j < m; j++) {
        const ndr = dr * zr - di * zi + pr;
        di = dr * zi + di * zr + pi;
        dr = ndr;
        const npr = pr * zr - pi * zi + a[j];
        pi = pr * zi + pi * zr;
        pr = npr;
      }
      const dd = dr * dr + di * di;
      const nr = (pr * dr + pi * di) / dd;
      const ni = (pi * dr - pr * di) / dd;
      let sr = 0;
      let si = 0;
      for (let j = 0; j < m; j++) {
        if (j !== i) {
          const xr = zr - re[j];
          const xi = zi - im[j];
          const xx = xr * xr + xi * xi;
          sr += xr / xx;
          si -= xi / xx;
        }
      }
      // w = n / (1 - n s)
      const qr = 1 - (nr * sr - ni * si);
      const qi = -(nr * si + ni * sr);
      const qq = qr * qr + qi * qi;
      const wr = (nr * qr + ni * qi) / qq;
      const wi = (ni * qr - nr * qi) / qq;
      re[i] = zr - wr;
      im[i] = zi - wi;
      const step = Math.hypot(wr, wi);
      if (!Number.isFinite(re[i]) || !Number.isFinite(im[i])) {
        return -1;
      }
      // A root that P(z) = 0 hits exactly gives 0 / 0 = NaN: no step.
      if (Number.isNaN(step)) {
        re[i] = zr;
        im[i] = zi;
      } else if (step > largest) {
        largest = step;
      }
    }
    if (largest < ABERTH_TOLERANCE) {
      return 1;
    }
  }
  return 0;
}

/** The start values 0.9 exp(j (2 pi (i + 0.5) / m + 0.1)). */
function startRoots(m, re, im) {
  for (let i = 0; i < m; i++) {
    const angle = (2 * Math.PI * (i + 0.5)) / m + START_PHASE;
    re[i] = START_RADIUS * Math.cos(angle);
    im[i] = START_RADIUS * Math.sin(angle);
  }
}

/**
 * Root finder per model order with the roots of the previous frame as the
 * start values. `find(t, store)` writes the raw candidates of frame t
 * (positive angle, f > 90 Hz, f < rate / 2 - 50 Hz, B < maxBandwidth) with
 * their order rank (0 for p, 1 for p - 2, 2 for p - 4) into `store`.
 */
function createRootFinder(frames, settings, store) {
  const { orders, rate, maxBandwidth } = settings;
  const p = frames.order;
  const reflection = new Float64Array(p);
  const predictor = new Float64Array(p);
  const models = orders.map((m) => ({
    m,
    re: new Float64Array(m),
    im: new Float64Array(m),
    started: false,
  }));
  const width = store.rawWidth;
  return {
    find(t) {
      const row = t * p;
      for (let i = 0; i < p; i++) {
        reflection[i] = frames.reflection[row + i];
      }
      let count = 0;
      for (let rank = 0; rank < models.length; rank++) {
        const model = models[rank];
        const { m, re, im } = model;
        predictor.fill(0);
        predictorFromReflection(reflection, m, predictor);
        if (!model.started) {
          startRoots(m, re, im);
          model.started = true;
        }
        // Not finite, or no convergence from the roots of the frame before:
        // start again from the first-frame values once.
        if (aberthRoots(predictor, m, re, im) !== 1) {
          startRoots(m, re, im);
          if (aberthRoots(predictor, m, re, im) === -1) {
            startRoots(m, re, im);
            continue;
          }
        }
        for (let i = 0; i < m; i++) {
          if (!(im[i] > 0)) {
            continue;
          }
          const frequency = (Math.atan2(im[i], re[i]) * rate) / (2 * Math.PI);
          const bandwidth =
            (-Math.log(Math.hypot(re[i], im[i])) * rate) / Math.PI;
          if (
            frequency > MIN_FREQUENCY &&
            frequency < rate / 2 - NYQUIST_MARGIN &&
            bandwidth < maxBandwidth &&
            count < width
          ) {
            store.rawFrequency[t * width + count] = frequency;
            store.rawBandwidth[t * width + count] = bandwidth;
            store.rawRank[t * width + count] = rank;
            count++;
          }
        }
      }
      store.rawCount[t] = count;
    },
  };
}

/**
 * Candidates of frame t for a tract of `length` cm into `store`: those of
 * order p below 5500 * 16.5 / L Hz, then those of lower orders that lie
 * more than 150 Hz from every kept one; at most 7, the narrowest first,
 * sorted by frequency.
 */
function selectCandidates(store, t, length, scratch) {
  const width = store.rawWidth;
  const top = (TOP_FREQUENCY * DEFAULT_LENGTH) / length;
  const raw = t * width;
  const count = store.rawCount[t];
  let kept = 0;
  for (let rank = 0; rank < ORDER_STEPS.length; rank++) {
    for (let i = 0; i < count; i++) {
      if (store.rawRank[raw + i] !== rank) {
        continue;
      }
      const frequency = store.rawFrequency[raw + i];
      if (!(frequency < top)) {
        continue;
      }
      let near = false;
      if (rank > 0) {
        for (let j = 0; j < kept; j++) {
          if (
            Math.abs(store.rawFrequency[raw + scratch[j]] - frequency) <=
            MERGE_DISTANCE
          ) {
            near = true;
            break;
          }
        }
      }
      if (!near) {
        scratch[kept++] = i;
      }
    }
  }
  // Narrowest first (stable: the lower index wins a tie), then the first
  // MAX_CANDIDATES by frequency.
  const chosen = Array.from(scratch.subarray(0, kept));
  chosen.sort(
    (x, y) => store.rawBandwidth[raw + x] - store.rawBandwidth[raw + y] || x - y
  );
  chosen.length = Math.min(chosen.length, MAX_CANDIDATES);
  chosen.sort(
    (x, y) => store.rawFrequency[raw + x] - store.rawFrequency[raw + y] || x - y
  );
  const row = t * MAX_CANDIDATES;
  chosen.forEach((index, slot) => {
    store.frequency[row + slot] = store.rawFrequency[raw + index];
    store.bandwidth[row + slot] = store.rawBandwidth[raw + index];
  });
  store.count[t] = chosen.length;
}

/** ref[k] = (2k - 1) c / (4 L), k = 1 .. K, into `out` (index k - 1). */
function referenceFormants(length, out) {
  for (let k = 0; k < out.length; k++) {
    out[k] = ((2 * k + 1) * SPEED_OF_SOUND) / (4 * length);
  }
  return out;
}

/**
 * States of frame t: every numbering of the candidates as F1 .. FK in
 * rising order where a formant may stay empty; the `keep` cheapest by the
 * local cost sum_k (|f - ref[k]| / ref[k] + min(2 B / f, 1.3)), or 1.5 for
 * an empty formant (see BANDWIDTH_WEIGHT and BANDWIDTH_CAP). States go to
 * `store.assign` (candidate index or -1 per formant) and `store.local`, cheapest first (the earlier numbering wins a tie).
 */
function frameStates(store, settings, t, references, scratch) {
  const { formants: K, keep } = settings;
  const n = store.count[t];
  const row = t * MAX_CANDIDATES;
  const { cost, assign } = scratch;
  for (let k = 0; k < K; k++) {
    for (let i = 0; i < n; i++) {
      const f = store.frequency[row + i];
      cost[k * MAX_CANDIDATES + i] =
        Math.abs(f - references[k]) / references[k] +
        Math.min(
          (BANDWIDTH_WEIGHT * store.bandwidth[row + i]) / f,
          BANDWIDTH_CAP
        );
    }
  }
  const base = t * keep;
  let states = 0;
  const local = store.local;
  const out = store.assign;
  function insert(total) {
    if (states === keep && !(total < local[base + states - 1])) {
      return;
    }
    let position = states === keep ? keep - 1 : states++;
    while (position > 0 && total < local[base + position - 1]) {
      local[base + position] = local[base + position - 1];
      out.copyWithin(
        (base + position) * COLUMNS,
        (base + position - 1) * COLUMNS,
        (base + position) * COLUMNS
      );
      position--;
    }
    local[base + position] = total;
    for (let k = 0; k < COLUMNS; k++) {
      out[(base + position) * COLUMNS + k] = k < K ? assign[k] : -1;
    }
  }
  function visit(k, from, total) {
    if (states === keep && !(total < local[base + states - 1])) {
      return;
    }
    if (k === K) {
      insert(total);
      return;
    }
    assign[k] = -1;
    visit(k + 1, from, total + EMPTY_COST);
    for (let i = from; i < n; i++) {
      assign[k] = i;
      visit(k + 1, i + 1, total + cost[k * MAX_CANDIDATES + i]);
    }
  }
  visit(0, 0, 0);
  store.states[t] = states;
}

/**
 * Nasal murmur flag of frame t (see NASAL_BAND_DROP): the lowest candidate
 * below NASAL_RATIO ref[1] with a bandwidth below 200 Hz and large drops
 * from band 0-400 Hz to band 800-1500 Hz and on to band 2000-3500 Hz.
 */
function nasalFlag(frames, store, settings, t, firstReference) {
  if (store.count[t] === 0) {
    return 0;
  }
  const row = t * MAX_CANDIDATES;
  const bands = frames.band.length / frames.capacity;
  const drop = frames.band[t * bands + 1] - frames.band[t * bands];
  const high = frames.band[t * bands + 3] - frames.band[t * bands + 1];
  return store.frequency[row] < settings.nasalRatio * firstReference &&
    store.bandwidth[row] < NASAL_BANDWIDTH &&
    drop < settings.nasalBandDrop &&
    high < settings.nasalHighDrop
    ? 1
    : 0;
}

/**
 * Viterbi search over the states of `store`. The transition from a state
 * of frame t - 1 to one of frame t costs sum_k |log2(f_t / f_(t-1))| over
 * the formants both have and 0.3 per formant only one has. `step(t, reset)`
 * adds frame t (`reset`: no transition cost, the path starts again);
 * `trace(path, first)` writes the cheapest path to the newest frame into
 * `path` from that frame back to `first`.
 */
function createViterbi(store, settings, rows) {
  const { keep, formants: K } = settings;
  const back = new Uint8Array(rows * keep);
  let previous = new Float64Array(keep);
  let current = new Float64Array(keep);
  let newest = -1;

  function transition(t, s, p) {
    const a = (t * keep + s) * COLUMNS;
    const b = ((t - 1) * keep + p) * COLUMNS;
    let total = 0;
    for (let k = 0; k < K; k++) {
      const i = store.assign[a + k];
      const j = store.assign[b + k];
      if (i >= 0 && j >= 0) {
        total += Math.abs(
          Math.log2(
            store.frequency[t * MAX_CANDIDATES + i] /
              store.frequency[(t - 1) * MAX_CANDIDATES + j]
          )
        );
      } else if (i >= 0 || j >= 0) {
        total += APPEAR_COST;
      }
    }
    return total;
  }

  return {
    step(t, reset) {
      const states = store.states[t];
      const before = t > 0 ? store.states[t - 1] : 0;
      let cheapest = 0;
      for (let p = 1; p < before; p++) {
        if (previous[p] < previous[cheapest]) {
          cheapest = p;
        }
      }
      let low = Infinity;
      for (let s = 0; s < states; s++) {
        let score = 0;
        let from = 0;
        if (t > 0 && reset) {
          score = previous[cheapest];
          from = cheapest;
        } else if (t > 0) {
          score = Infinity;
          for (let p = 0; p < before; p++) {
            const value = previous[p] + transition(t, s, p);
            if (value < score) {
              score = value;
              from = p;
            }
          }
        }
        back[t * keep + s] = from;
        current[s] = score + store.local[t * keep + s];
        low = Math.min(low, current[s]);
      }
      // Keep the numbers small: the best path costs 0.
      for (let s = 0; s < states; s++) {
        current[s] -= low;
      }
      [previous, current] = [current, previous];
      newest = t;
    },
    trace(path, first) {
      let state = 0;
      const states = store.states[newest];
      for (let s = 1; s < states; s++) {
        if (previous[s] < previous[state]) {
          state = s;
        }
      }
      for (let t = newest; t >= first; t--) {
        path[t] = state;
        state = back[t * keep + state];
      }
    },
  };
}

/** Candidate index of formant k in the path state of frame t, or -1. */
function chosenIndex(store, settings, path, t, k) {
  return store.assign[(t * settings.keep + path[t]) * COLUMNS + k];
}

/** Length estimate (cm) of frame t on the path, or NaN without F1 .. F3 or
 * outside the vowel-like frames (LENGTH_PERIODICITY, LENGTH_RANGE below the
 * energy `peak`). */
function frameLength(frames, store, settings, path, t, peak) {
  if (
    !frames.speech[t] ||
    frames.whisper?.[t] ||
    store.nasal[t] ||
    frames.periodicity[t] < LENGTH_PERIODICITY ||
    frames.energy[t] < peak - LENGTH_RANGE
  ) {
    return NaN;
  }
  const values = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const index = chosenIndex(store, settings, path, t, k);
    if (index < 0) {
      return NaN;
    }
    values[k] = store.frequency[t * MAX_CANDIDATES + index];
  }
  return tractLengthFromFormants(values[0], values[1], values[2]);
}

function clampLength(length) {
  return Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, length));
}

/** Median of the first `count` values of the sorted `values`. */
function sortedMedian(values, count) {
  const middle = Math.floor(count / 2);
  return count % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

/** Empty track of `frames.capacity` rows. */
function createTrack(frames, settings) {
  const rows = frames.capacity;
  const matrix = () => new Float32Array(rows * COLUMNS).fill(NaN);
  return {
    hop: settings.hop,
    startTime: frames.startTime,
    count: 0,
    committed: 0,
    formants: settings.formants,
    vocalTractLength: settings.fixedLength ?? DEFAULT_LENGTH,
    frequency: matrix(),
    bandwidth: matrix(),
    variance: matrix(),
    level: matrix(),
    valid: new Uint8Array(rows * COLUMNS),
    nasal: new Uint8Array(rows),
  };
}

/**
 * One Kalman filter per formant over the chosen candidates, x[t] =
 * x[t - 1] + w with Var(w) = q^2, and the Rauch-Tung-Striebel smoother.
 * `smooth(first, last, newest, path)` filters frames first .. newest from
 * the saved state at first - 1, smooths them back to `first` and writes
 * rows first .. last - 1 of the track; the filter state at last - 1 is
 * saved for the next call.
 */
function createSmoother(frames, store, settings, track, rows) {
  const { formants: K, processNoise, maxGap, pitch, keep } = settings;
  const size = rows * COLUMNS;
  const x = new Float64Array(size);
  const variance = new Float64Array(size);
  const smoothX = new Float64Array(size);
  const smoothVariance = new Float64Array(size);
  const width = new Float32Array(size);
  const gap = new Float64Array(size);
  const start = new Uint8Array(size);
  const saved = Array.from({ length: K }, () => ({
    x: 0,
    variance: 0,
    gap: Infinity,
    width: NaN,
  }));

  /** Observation variance of a candidate of bandwidth B in frame t. */
  function observation(t, bandwidth) {
    let harmonics = 0;
    if (
      !frames.whisper?.[t] &&
      pitch &&
      t < pitch.count &&
      pitch.f0[t] > HIGH_PITCH
    ) {
      harmonics = (pitch.f0[t] / 4) ** 2;
    }
    return (bandwidth / 2) ** 2 + OBSERVATION_FLOOR ** 2 + harmonics;
  }

  function filter(first, newest, path) {
    for (let k = 0; k < K; k++) {
      const q = processNoise[k];
      let { x: value, variance: p, gap: empty, width: held } = saved[k];
      for (let t = first; t <= newest; t++) {
        const cell = t * COLUMNS + k;
        const index = store.assign[(t * keep + path[t]) * COLUMNS + k];
        p += q;
        start[cell] = 0;
        if (index >= 0) {
          const f = store.frequency[t * MAX_CANDIDATES + index];
          const bandwidth = store.bandwidth[t * MAX_CANDIDATES + index];
          const r = observation(t, bandwidth);
          if (empty > maxGap) {
            // A new segment: the filter starts at the observation.
            value = f;
            p = r;
            start[cell] = 1;
          } else {
            const gain = p / (p + r);
            value += gain * (f - value);
            p *= 1 - gain;
          }
          empty = 0;
          held = bandwidth;
        } else {
          empty++;
        }
        x[cell] = value;
        variance[cell] = p;
        gap[cell] = empty;
        width[cell] = held;
      }
    }
  }

  function backward(first, newest) {
    for (let k = 0; k < K; k++) {
      const q = processNoise[k];
      const end = newest * COLUMNS + k;
      smoothX[end] = x[end];
      smoothVariance[end] = variance[end];
      for (let t = newest - 1; t >= first; t--) {
        const cell = t * COLUMNS + k;
        const next = cell + COLUMNS;
        if (start[next] || gap[cell] > maxGap) {
          smoothX[cell] = x[cell];
          smoothVariance[cell] = variance[cell];
          continue;
        }
        const predicted = variance[cell] + q;
        const c = variance[cell] / predicted;
        smoothX[cell] = x[cell] + c * (smoothX[next] - x[cell]);
        smoothVariance[cell] =
          variance[cell] + c * c * (smoothVariance[next] - predicted);
      }
    }
  }

  return {
    smooth(first, last, newest, path) {
      if (newest < first) {
        return;
      }
      filter(first, newest, path);
      backward(first, newest);
      const p = frames.order;
      for (let t = first; t < last; t++) {
        const nasal = store.nasal[t];
        track.nasal[t] = nasal;
        const power = 10 ** (frames.gain[t] / 10);
        const predictor = frames.lpc.subarray(t * p, (t + 1) * p);
        for (let k = 0; k < K; k++) {
          const cell = t * COLUMNS + k;
          const valid = gap[cell] <= maxGap ? 1 : 0;
          track.valid[cell] = valid;
          if (!valid) {
            continue;
          }
          const frequency = smoothX[cell];
          track.frequency[cell] = frequency;
          track.bandwidth[cell] = width[cell];
          track.variance[cell] =
            smoothVariance[cell] * (nasal ? NASAL_VARIANCE : 1);
          track.level[cell] = lpcLevel(
            predictor,
            p,
            power,
            frequency,
            frames.rate
          );
        }
      }
      if (last > first) {
        for (let k = 0; k < K; k++) {
          const cell = (last - 1) * COLUMNS + k;
          saved[k] = {
            x: x[cell],
            variance: variance[cell],
            gap: gap[cell],
            width: width[cell],
          };
        }
      }
    },
  };
}

/**
 * Raw candidates of the frames `0 .. frames.count - 1`, the first step of
 * the tracker: per frame the roots of the orders p, p - 2 and p - 4 that
 * pass the filters of `createRootFinder`, with their order rank. The Rust
 * core computes the same numbers (`RootFinder` of
 * crates/voice-simulator-core/src/formants.rs, export
 * `vs_formant_candidates`); tests/rust-parity.test.js compares them.
 * @param {import('./frontend.js').FrameSet} frames
 * @param {Partial<typeof FORMANT_DEFAULTS>} [options]
 */
export function formantCandidates(frames, options = {}) {
  const settings = formantSettings(frames, options);
  const rows = frames.count;
  const width = Math.ceil(settings.orders.reduce((sum, m) => sum + m / 2, 0));
  const store = {
    rawWidth: width,
    rawFrequency: new Float32Array(rows * width),
    rawBandwidth: new Float32Array(rows * width),
    rawRank: new Uint8Array(rows * width),
    rawCount: new Uint8Array(rows),
  };
  const finder = createRootFinder(frames, settings, store);
  for (let t = 0; t < rows; t++) {
    finder.find(t);
  }
  return {
    width,
    count: store.rawCount,
    frequency: store.rawFrequency,
    bandwidth: store.rawBandwidth,
    rank: store.rawRank,
  };
}

/**
 * Tracker over a frame set; `batch` (used by `trackFormants`) estimates the
 * tract length from the whole path before anything is committed.
 */
function createTracker(frames, options, batch, candidates) {
  const settings = formantSettings(frames, options);
  const { keep, lag, formants: K } = settings;
  const rows = frames.capacity;
  const rawWidth = settings.orders.reduce((sum, m) => sum + m / 2, 0);
  const store = {
    rawWidth: Math.ceil(rawWidth),
    rawFrequency:
      candidates?.frequency ?? new Float32Array(rows * Math.ceil(rawWidth)),
    rawBandwidth:
      candidates?.bandwidth ?? new Float32Array(rows * Math.ceil(rawWidth)),
    rawRank: candidates?.rank ?? new Uint8Array(rows * Math.ceil(rawWidth)),
    rawCount: candidates?.count ?? new Uint8Array(rows),
    frequency: new Float32Array(rows * MAX_CANDIDATES),
    bandwidth: new Float32Array(rows * MAX_CANDIDATES),
    count: new Uint8Array(rows),
    local: new Float64Array(rows * keep),
    assign: new Int8Array(rows * keep * COLUMNS),
    states: new Uint8Array(rows),
    nasal: new Uint8Array(rows),
    reset: new Uint8Array(rows),
  };
  const finder = candidates ? null : createRootFinder(frames, settings, store);
  const path = new Uint8Array(rows);
  const track = createTrack(frames, settings);
  const smoother = createSmoother(frames, store, settings, track, rows);
  const references = new Float64Array(K);
  const scratch = {
    index: new Int32Array(store.rawWidth),
    cost: new Float64Array(COLUMNS * MAX_CANDIDATES),
    assign: new Int8Array(COLUMNS),
  };
  const lengths = new Float64Array(rows);
  let lengthCount = 0;
  let length = track.vocalTractLength;
  let viterbi = createViterbi(store, settings, rows);
  let silent = 0;
  /** Highest energy (dB) of a speech frame so far. */
  let peak = -Infinity;

  /** Candidates, nasal flag and states of frame t for the current length,
   * and a Viterbi step. */
  function score(t) {
    referenceFormants(length, references);
    selectCandidates(store, t, length, scratch.index);
    store.nasal[t] = nasalFlag(frames, store, settings, t, references[0]);
    frameStates(store, settings, t, references, scratch);
    viterbi.step(t, store.reset[t] === 1);
  }

  /** Add a committed length estimate to the sorted list. */
  function addLength(value) {
    let position = lengthCount++;
    while (position > 0 && lengths[position - 1] > value) {
      lengths[position] = lengths[position - 1];
      position--;
    }
    lengths[position] = value;
  }

  /** Batch: the median length of the whole path; another search when it
   * differs from the length of the last search by more than 5 %, at most
   * LENGTH_PASSES searches. */
  function estimateLength() {
    for (let pass = 1; pass < LENGTH_PASSES; pass++) {
      viterbi.trace(path, 0);
      lengthCount = 0;
      for (let t = 0; t < track.count; t++) {
        const value = frameLength(frames, store, settings, path, t, peak);
        if (value > 0) {
          addLength(value);
        }
      }
      if (lengthCount === 0) {
        return;
      }
      const estimate = clampLength(sortedMedian(lengths, lengthCount));
      const searched = length;
      length = estimate;
      track.vocalTractLength = estimate;
      if (Math.abs(estimate / searched - 1) <= LENGTH_TOLERANCE) {
        return;
      }
      viterbi = createViterbi(store, settings, rows);
      for (let t = 0; t < track.count; t++) {
        score(t);
      }
    }
  }

  /** Commit frames track.committed .. last - 1 along the best path. */
  function commit(last) {
    if (last <= track.committed) {
      return;
    }
    const first = track.committed;
    viterbi.trace(path, first);
    smoother.smooth(first, last, track.count - 1, path);
    for (let t = first; t < last; t++) {
      track.committed = t + 1;
      if (settings.fixedLength !== null || batch) {
        continue;
      }
      const value = frameLength(frames, store, settings, path, t, peak);
      if (value > 0) {
        addLength(value);
      }
      if (track.committed % LENGTH_EVERY === 0 && lengthCount > 0) {
        const target = clampLength(sortedMedian(lengths, lengthCount));
        length += LENGTH_STEP * (target - length);
        track.vocalTractLength = length;
      }
    }
  }

  return {
    frames,
    output: track,
    track,
    /**
     * Score the frames that have arrived and commit what the lag allows;
     * with `final` score and commit every frame of `frames.count`.
     * @param {boolean} [final]
     */
    advance(final = false) {
      while (track.count < frames.count) {
        const t = track.count;
        store.reset[t] = silent >= RESET_RUN && frames.speech[t] ? 1 : 0;
        silent = frames.speech[t] ? 0 : silent + 1;
        if (frames.speech[t]) {
          peak = Math.max(peak, frames.energy[t]);
        }
        finder?.find(t);
        score(t);
        track.count++;
      }
      if (batch && final && track.committed === 0 && track.count > 0) {
        if (settings.fixedLength === null) {
          estimateLength();
        }
      }
      commit(final ? track.count : Math.max(0, track.count - lag));
    },
  };
}

/**
 * Streaming formant tracker over a frame set of the front end.
 *
 * `advance(final = false)` scores every frame added since the last call
 * and commits frame t when frame t + lag has been scored: the path is
 * traced back from the newest frame and the Kalman smoother runs over the
 * frames from the oldest uncommitted one to the newest. With
 * `vocalTractLength: null` the length starts at 16.5 cm and moves 10 % of
 * the way to the median estimate of the committed frames after every 20 of
 * them. The decision delay is `lag * hop` (50 ms with the defaults).
 * @param {import('./frontend.js').FrameSet} frames
 * @param {Partial<typeof FORMANT_DEFAULTS>} [options]
 */
export function createFormantTracker(frames, options = {}) {
  return createTracker(frames, options, false);
}

/**
 * Formant track of a whole frame set. With `vocalTractLength: null` the
 * search runs with 16.5 cm, the length becomes the median estimate of the
 * vowel-like frames with F1 .. F3 (limited to 10 .. 20 cm), and the search
 * runs again with it when it differs from the searched length by more than
 * 5 % (at most three searches). The
 * smoother runs over the whole recording.
 * @param {Parameters<typeof createFormantTracker>[0]} frames
 * @param {Partial<typeof FORMANT_DEFAULTS>} [options]
 */
export function trackFormants(frames, options = {}) {
  const tracker = createTracker(frames, options, true);
  tracker.advance(true);
  return tracker.track;
}

const batchCandidates = new WeakMap();

/** Share roots across consumers of the same completed batch frame set. */
export function trackBatchFormants(frames, options) {
  if (options.maxBandwidth !== undefined) {
    return trackFormants(frames, options);
  }
  if (!batchCandidates.has(frames)) {
    batchCandidates.set(frames, formantCandidates(frames));
  }
  const tracker = createTracker(
    frames,
    options,
    true,
    batchCandidates.get(frames)
  );
  tracker.advance(true);
  return tracker.track;
}
