/**
 * Pitch and voicing tracker of the recognizer (issue 59).
 *
 * For every analysis frame of the front end (src/recognition/frontend.js)
 * the tracker finds a few pitch candidates by the normalised
 * autocorrelation of Boersma (1993) on a coarse copy of the signal, refines
 * them at the full rate, adds one unvoiced candidate and chooses one
 * candidate per frame by a Viterbi (1967) search over the whole track, so
 * single wrong frames and octave jumps lose against a smooth path. Runs of
 * voiced frames get one mark per glottal period (by waveform
 * cross-correlation), and the marks give jitter and shimmer.
 *
 * Stage pattern of issue 58: `createPitchTracker(frames, options)` reads
 * `frames.samples`, `frames.rate`, `frames.hop`, `frames.energy` and
 * `frames.noise`; `advance(final)` scores the frames whose window has
 * arrived and commits frame t once frame t + lag is scored (all frames with
 * `final`). Rows of the track before `committed` never change.
 */

import { createFft } from './fft.js';

/**
 * Defaults. The two transition costs are per step of the default hop of
 * 5 ms: Boersma's 0.35 and 0.14 for 10 ms times 0.01 / 0.005. With another
 * hop they are multiplied by 0.005 / hop, so the cost per second stays the
 * same.
 */
export const PITCH_DEFAULTS = Object.freeze({
  minF0: 60,
  maxF0: 600,
  candidates: 4,
  voicingThreshold: 0.45,
  silenceThreshold: 0.03,
  octaveCost: 0.01,
  octaveJumpCost: 0.7,
  voicedUnvoicedCost: 0.28,
  lag: 20,
});

/** Hop (s) for which the transition costs are given. */
const COST_HOP = 0.005;
/** Window: `WINDOW_PERIODS / minF0` seconds. */
const WINDOW_PERIODS = 3;
/** The coarse signal has about this rate (Hz): D = floor(rate / 4000). */
const COARSE_RATE = 4000;
/** Low-pass of the coarse signal: cutoff 0.45 rc, 8 zero crossings. */
const COARSE_CUTOFF = 0.45;
const COARSE_ZERO_CROSSINGS = 8;
/**
 * Quiet frames: a frame more than ENERGY_FREE dB below the loudest frame
 * from ENERGY_SPAN seconds before to ENERGY_AHEAD after it gets
 * ENERGY_COST per dB more unvoiced strength.
 */
const ENERGY_SPAN = 0.2;
const ENERGY_AHEAD = 0.01;
const ENERGY_FREE = 15;
const ENERGY_COST = 0.1;
/** A frame less than NOISE_FREE dB above the noise floor gets NOISE_COST
 * per dB more unvoiced strength. */
const NOISE_FREE = 3;
const NOISE_COST = 0.1;
/** Width (voicing units) of the soft voicing score. */
const VOICING_SPREAD = 0.4;
/** Period marks: shortest run (s), search span of the first mark (s) and
 * the allowed change of a period (fraction). */
const MARK_RUN = 0.04;
const MARK_MIDDLE = 0.02;
const MARK_RANGE = 0.2;
/** Fewest periods for jitter and shimmer. */
const MIN_PERIODS = 20;
/** Mean |x_i - x_{i+1}| of independent normal draws is 2 / sqrt(pi) times
 * their standard deviation. */
const JITTER_FACTOR = 2 / Math.sqrt(Math.PI);
/** Percentiles of `low`, `median` and `high`. */
const PERCENTILES = [0.05, 0.5, 0.95];

/** Throw a RangeError with `message` unless `ok`. */
function check(ok, message) {
  if (!ok) {
    throw new RangeError(message);
  }
}

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

/** Hann window of `length` points, as in the front end. */
function hannWindow(length) {
  const window = new Float64Array(length);
  for (let n = 0; n < length; n++) {
    window[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (length - 1));
  }
  return window;
}

/**
 * Head setting (standard deviation in percent of `head.jitter` or
 * `head.shimmer`) that gives a measured jitter or shimmer of `value`
 * percent: for independent normal draws the mean absolute difference of
 * neighbours is 1.128 times the standard deviation.
 * @param {number|null} value
 * @returns {number|null}
 */
export function jitterToHead(value) {
  return value === null || value === undefined ? null : value / JITTER_FACTOR;
}

/** Merged and checked options with the derived lengths. */
function pitchSettings(frames, options) {
  const merged = { ...PITCH_DEFAULTS, ...options };
  const { minF0, maxF0, voicingThreshold, silenceThreshold } = merged;
  const { rate, hop } = frames;
  check(
    minF0 > 0 && maxF0 > minF0 && maxF0 < rate / 4,
    `need 0 < minF0 < maxF0 < rate / 4, got ${minF0} and ${maxF0}`
  );
  check(
    Number.isInteger(merged.candidates) &&
      merged.candidates >= 1 &&
      merged.candidates <= 32,
    `candidates must be an integer from 1 to 32, got ${merged.candidates}`
  );
  check(
    Number.isInteger(merged.lag) && merged.lag >= 0,
    `lag must be an integer >= 0, got ${merged.lag}`
  );
  for (const name of [
    'voicingThreshold',
    'silenceThreshold',
    'octaveCost',
    'octaveJumpCost',
    'voicedUnvoicedCost',
  ]) {
    check(
      merged[name] >= 0 && Number.isFinite(merged[name]),
      `${name} must be finite and >= 0, got ${merged[name]}`
    );
  }
  const factor = Math.max(1, Math.floor(rate / COARSE_RATE));
  const coarseRate = rate / factor;
  const window = WINDOW_PERIODS / minF0;
  const coarseLength = Math.round(window * coarseRate);
  const fullLength = Math.round(window * rate);
  let size = 2;
  while (size < 1.5 * coarseLength) {
    size *= 2;
  }
  const costScale = COST_HOP / hop;
  // Energy frames ahead whose window ends inside this frame's window, so
  // that a stream has them when the frame is scored.
  const frameSamples = Math.round(frames.window * rate);
  const inside = Math.floor(
    (Math.floor(fullLength / 2) - Math.ceil(frameSamples / 2)) / (hop * rate)
  );
  return {
    ...merged,
    rate,
    hop,
    hopSamples: hop * rate,
    factor,
    coarseRate,
    coarseLength,
    fullLength,
    size,
    octaveJumpCost: merged.octaveJumpCost * costScale,
    voicedUnvoicedCost: merged.voicedUnvoicedCost * costScale,
    silence: silenceThreshold / (1 + voicingThreshold),
    energySpan: Math.round(ENERGY_SPAN / hop),
    energyAhead: Math.max(0, Math.min(Math.round(ENERGY_AHEAD / hop), inside)),
    // Coarse lags of the search; the full-rate refinement needs D more.
    lagMin: Math.max(2, Math.floor(coarseRate / maxF0)),
    lagMax: Math.min(
      Math.floor(coarseLength / 2),
      Math.ceil(coarseRate / minF0) + 1
    ),
  };
}

/** Low-pass kernel of the coarse signal (sum 1), `taps = 2 half + 1`. */
function coarseKernel(factor) {
  const cutoff = (2 * COARSE_CUTOFF) / factor; // of the input Nyquist
  const halfWidth = COARSE_ZERO_CROSSINGS / cutoff;
  const half = Math.ceil(halfWidth) - 1;
  const kernel = new Float64Array(2 * half + 1);
  let sum = 0;
  for (let k = -half; k <= half; k++) {
    const value = cutoff * sinc(cutoff * k) * blackman(k / halfWidth);
    kernel[k + half] = value;
    sum += value;
  }
  for (let index = 0; index < kernel.length; index++) {
    kernel[index] /= sum;
  }
  return { kernel, half };
}

/** Autocorrelation of `window` at lags 0 .. maxLag, divided by lag 0. */
function windowCorrelation(window, maxLag) {
  const result = new Float64Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag; lag++) {
    let sum = 0;
    for (let n = 0; n + lag < window.length; n++) {
      sum += window[n] * window[n + lag];
    }
    result[lag] = sum;
  }
  const first = result[0];
  for (let lag = 0; lag <= maxLag; lag++) {
    result[lag] /= first;
  }
  return result;
}

/** Vertex of the parabola through (−1, a), (0, b), (1, c): [offset, top]. */
function parabola(a, b, c) {
  const curvature = a - 2 * b + c;
  if (!(curvature < 0)) {
    return [0, b];
  }
  const offset = (0.5 * (a - c)) / curvature;
  return [offset, b - 0.25 * (a - c) * offset];
}

/** Empty track of `capacity` rows. */
function createTrack(frames, settings) {
  const rows = frames.capacity;
  return {
    hop: settings.hop,
    startTime: frames.startTime,
    count: 0,
    committed: 0,
    f0: new Float32Array(rows),
    voicing: new Float32Array(rows),
    strength: new Float32Array(rows),
    marks: new Float64Array(0),
    jitter: null,
    shimmer: null,
    median: null,
    low: null,
    high: null,
  };
}

/**
 * Candidate finder: the coarse signal, the windowed autocorrelation and the
 * refinement at the full rate. `score(t, centre, peak)` writes the voiced
 * candidates of frame t (frequency, height, strength), their number and the
 * strength of the unvoiced candidate.
 */
function createCandidateFinder(frames, settings, store) {
  const {
    factor,
    coarseLength,
    fullLength,
    size,
    lagMin,
    lagMax,
    rate,
    minF0,
    maxF0,
    octaveCost,
    voicingThreshold,
    silence,
  } = settings;
  const capacity = settings.candidates;
  const samples = frames.samples;
  const { kernel, half: kernelHalf } = coarseKernel(factor);
  const coarseWindow = hannWindow(coarseLength);
  const fullWindow = hannWindow(fullLength);
  const fft = createFft(size);
  const fullMaxLag = factor * (lagMax + 1) + factor + 1;
  const coarseCorrelation = windowCorrelation(coarseWindow, lagMax + 1);
  const fullCorrelation = windowCorrelation(
    fullWindow,
    Math.min(fullLength - 1, fullMaxLag)
  );
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const full = new Float64Array(fullLength);
  const q = new Float64Array(lagMax + 2);
  // Local maxima of the coarse search: lag, height, coarse strength.
  const maxima = 2 * capacity + 2;
  const peakLag = new Float64Array(lagMax);
  const peakHeight = new Float64Array(lagMax);
  const order = new Int32Array(lagMax);
  const trial = new Float64Array(maxima);
  const coarseHalf = Math.floor(coarseLength / 2);
  const fullHalf = Math.floor(fullLength / 2);
  const coarseMargin = coarseHalf + 2;
  const coarse = new Float64Array(
    coarseMargin + Math.ceil((samples.length + fullLength) / factor) + 4
  );
  let coarseDone = -coarseMargin;

  /** Working sample `index`, 0 outside the received samples. */
  function sample(index) {
    return index >= 0 && index < frames.sampleCount ? samples[index] : 0;
  }

  /** Fill the coarse signal up to index `last` (inclusive). */
  function fillCoarse(last) {
    for (let m = coarseDone; m <= last; m++) {
      const centre = m * factor;
      let sum = 0;
      if (centre - kernelHalf >= 0 && centre + kernelHalf < frames.sampleCount) {
        for (let k = -kernelHalf; k <= kernelHalf; k++) {
          sum += kernel[k + kernelHalf] * samples[centre + k];
        }
      } else {
        for (let k = -kernelHalf; k <= kernelHalf; k++) {
          sum += kernel[k + kernelHalf] * sample(centre + k);
        }
      }
      coarse[m + coarseMargin] = sum;
    }
    coarseDone = Math.max(coarseDone, last + 1);
  }

  /**
   * Extra unvoiced strength of frame `t` from the front end's energies: a
   * frame far below the loudest frame of the last 200 ms (and the next
   * 10 ms) is the decaying tail of a vowel or a quiet consonant whose 50 ms
   * window still holds the periodic neighbour; a frame near the noise
   * floor is noise.
   */
  function quietness(t) {
    const { energy, noise } = frames;
    let top = -Infinity;
    const last = Math.min(frames.count - 1, t + settings.energyAhead);
    for (let k = Math.max(0, t - settings.energySpan); k <= last; k++) {
      top = Math.max(top, energy[k]);
    }
    const below = top - energy[t] - ENERGY_FREE;
    const above = energy[t] - noise[t];
    return (
      ENERGY_COST * Math.max(0, below) +
      NOISE_COST * Math.max(0, NOISE_FREE - above)
    );
  }

  /** Last working sample that frame centre `centre` reads. */
  function lastSample(centre) {
    const coarseEnd =
      (Math.round(centre / factor) - coarseHalf + coarseLength - 1) * factor +
      kernelHalf;
    return Math.max(centre - fullHalf + fullLength - 1, coarseEnd);
  }

  /** Normalised autocorrelation of the full-rate frame at `lag`. */
  function fullAt(lag, energy) {
    if (lag < 1 || lag >= fullCorrelation.length) {
      return -1;
    }
    let sum = 0;
    for (let n = 0; n + lag < fullLength; n++) {
      sum += full[n] * full[n + lag];
    }
    return sum / (energy * fullCorrelation[lag]);
  }

  /** Refine a coarse lag at the full rate: [lag, height] or null. */
  function refine(coarseLag, energy) {
    const centre = Math.round(coarseLag * factor);
    let best = -Infinity;
    let bestLag = -1;
    for (let lag = centre - factor; lag <= centre + factor; lag++) {
      const value = fullAt(lag, energy);
      if (value > best) {
        best = value;
        bestLag = lag;
      }
    }
    if (bestLag < 2) {
      return null;
    }
    const [offset, top] = parabola(
      fullAt(bestLag - 1, energy),
      best,
      fullAt(bestLag + 1, energy)
    );
    return [bestLag + offset, Math.min(1, top)];
  }

  return {
    lastSample,
    /**
     * Candidates of frame `t` centred on working sample `centre`; `peak` is
     * the largest absolute sample so far.
     */
    score(t, centre, peak) {
      // Full-rate frame without its mean, windowed; its largest |sample|.
      const fullStart = centre - fullHalf;
      let mean = 0;
      let largest = 0;
      for (let n = 0; n < fullLength; n++) {
        const value = sample(fullStart + n);
        full[n] = value;
        mean += value;
        largest = Math.max(largest, Math.abs(value));
      }
      mean /= fullLength;
      let energy = 0;
      for (let n = 0; n < fullLength; n++) {
        full[n] = (full[n] - mean) * fullWindow[n];
        energy += full[n] * full[n];
      }
      const ratio = peak > 0 ? largest / peak : 0;
      store.unvoiced[t] = voicingThreshold + Math.max(0, 2 - ratio / silence);
      store.unvoiced[t] += quietness(t);
      store.count[t] = 0;
      // Coarse frame: autocorrelation by the transform.
      const coarseStart = Math.round(centre / factor) - coarseHalf;
      fillCoarse(coarseStart + coarseLength - 1);
      let coarseMean = 0;
      for (let n = 0; n < coarseLength; n++) {
        coarseMean += coarse[coarseStart + n + coarseMargin];
      }
      coarseMean /= coarseLength;
      for (let n = 0; n < coarseLength; n++) {
        re[n] =
          (coarse[coarseStart + n + coarseMargin] - coarseMean) *
          coarseWindow[n];
        im[n] = 0;
      }
      re.fill(0, coarseLength);
      im.fill(0, coarseLength);
      fft.forward(re, im);
      for (let k = 0; k < size; k++) {
        re[k] = re[k] * re[k] + im[k] * im[k];
        im[k] = 0;
      }
      fft.inverse(re, im);
      if (!(re[0] > 0) || !(energy > 0)) {
        return;
      }
      for (let lag = lagMin - 1; lag <= lagMax + 1; lag++) {
        q[lag] = re[lag] / (re[0] * coarseCorrelation[lag]);
      }
      // Local maxima, refined by a parabola, strongest first.
      let found = 0;
      for (let lag = lagMin; lag <= lagMax; lag++) {
        if (q[lag] > q[lag - 1] && q[lag] >= q[lag + 1] && q[lag] > 0) {
          const [offset, top] = parabola(q[lag - 1], q[lag], q[lag + 1]);
          const exact = lag + offset;
          const frequency = settings.coarseRate / exact;
          peakLag[found] = exact;
          peakHeight[found] =
            Math.min(1, top) - octaveCost * Math.log2(maxF0 / frequency);
          order[found] = found;
          found++;
        }
      }
      const sorted = Array.prototype.slice
        .call(order, 0, found)
        .sort((a, b) => peakHeight[b] - peakHeight[a] || a - b);
      // Refine the strongest maxima at the full rate and keep the best.
      let kept = 0;
      const tried = Math.min(found, maxima);
      for (let index = 0; index < tried; index++) {
        const refined = refine(peakLag[sorted[index]], energy);
        if (refined === null) {
          continue;
        }
        const frequency = rate / refined[0];
        if (frequency < minF0 || frequency > maxF0) {
          continue;
        }
        trial[kept] = index;
        const row = t * capacity;
        const strength =
          refined[1] - octaveCost * Math.log2(maxF0 / frequency);
        // Insert by strength into the rows of frame t.
        let slot = Math.min(kept, capacity);
        while (slot > 0 && store.strength[row + slot - 1] < strength) {
          if (slot < capacity) {
            store.frequency[row + slot] = store.frequency[row + slot - 1];
            store.height[row + slot] = store.height[row + slot - 1];
            store.strength[row + slot] = store.strength[row + slot - 1];
          }
          slot--;
        }
        if (slot < capacity) {
          store.frequency[row + slot] = frequency;
          store.height[row + slot] = refined[1];
          store.strength[row + slot] = strength;
        }
        kept = Math.min(capacity, kept + 1);
      }
      store.count[t] = kept;
    },
  };
}

/**
 * Period marks, jitter and shimmer of committed runs of voiced frames.
 */
function createMarker(frames, track, settings) {
  const { rate, hopSamples } = settings;
  const samples = frames.samples;
  const runFrames = Math.ceil(MARK_RUN / settings.hop - 1e-9);
  let storage = new Float64Array(256);
  let length = 0;
  const sums = { periods: 0, period: 0, periodDiff: 0, pairs: 0 };
  sums.amplitude = 0;
  sums.amplitudeDiff = 0;

  function sample(index) {
    return index >= 0 && index < frames.sampleCount ? samples[index] : 0;
  }

  function push(time) {
    if (length === storage.length) {
      const grown = new Float64Array(storage.length * 2);
      grown.set(storage);
      storage = grown;
    }
    storage[length++] = time;
  }

  /** Normalised cross-correlation of x[a ..] and x[b ..], `n` samples. */
  function correlation(a, b, n) {
    let ab = 0;
    let aa = 0;
    let bb = 0;
    for (let i = 0; i < n; i++) {
      const x = sample(a + i);
      const y = sample(b + i);
      ab += x * y;
      aa += x * x;
      bb += y * y;
    }
    return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : -1;
  }

  /** Next mark from `last` in `direction` (+1 or -1), or null. */
  function step(last, period, direction, first, end) {
    const span = Math.round(period);
    const anchor = Math.round(last);
    const near = last + direction * (1 - MARK_RANGE) * period;
    const far = last + direction * (1 + MARK_RANGE) * period;
    const lo = Math.ceil(Math.min(near, far));
    const hi = Math.floor(Math.max(near, far));
    if (lo < first || hi + span > end) {
      return null;
    }
    let best = -Infinity;
    let place = -1;
    for (let p = lo; p <= hi; p++) {
      const value = correlation(anchor, p, span);
      if (value > best) {
        best = value;
        place = p;
      }
    }
    const [offset] = parabola(
      correlation(anchor, place - 1, span),
      best,
      correlation(anchor, place + 1, span)
    );
    return place + Math.max(-0.5, Math.min(0.5, offset));
  }

  /** Marks (working samples) of the run of frames a .. b. */
  function markRun(a, b) {
    const centre = (t) => Math.round(t * hopSamples);
    const first = Math.max(0, Math.round(centre(a) - hopSamples / 2));
    const end = Math.min(
      frames.sampleCount,
      Math.round(centre(b) + hopSamples / 2)
    );
    const middle = (first + end) / 2;
    const reach = (MARK_MIDDLE / 2) * rate;
    let start = Math.round(middle);
    let largest = -1;
    for (
      let n = Math.max(first, Math.ceil(middle - reach));
      n <= Math.min(end - 1, Math.floor(middle + reach));
      n++
    ) {
      const value = Math.abs(sample(n));
      if (value > largest) {
        largest = value;
        start = n;
      }
    }
    const periodAt = (position) => {
      const frame = Math.min(b, Math.max(a, Math.round(position / hopSamples)));
      return rate / track.f0[frame];
    };
    const backward = [];
    for (let last = start; ; ) {
      const next = step(last, periodAt(last), -1, first, end);
      if (next === null) {
        break;
      }
      backward.push(next);
      last = next;
    }
    const marks = backward.reverse();
    marks.push(start);
    for (let last = start; ; ) {
      const next = step(last, periodAt(last), 1, first, end);
      if (next === null) {
        break;
      }
      marks.push(next);
      last = next;
    }
    return marks;
  }

  /** Peak-to-peak amplitude of x over [a, b). */
  function amplitude(a, b) {
    let low = Infinity;
    let high = -Infinity;
    for (let n = Math.round(a); n < Math.round(b); n++) {
      const value = sample(n);
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
    return high > low ? high - low : 0;
  }

  return {
    /** Mark the run of committed voiced frames a .. b (inclusive). */
    run(a, b) {
      if (b - a + 1 < runFrames) {
        return;
      }
      const marks = markRun(a, b);
      for (const mark of marks) {
        push(frames.startTime + mark / rate);
      }
      for (let i = 0; i + 1 < marks.length; i++) {
        const period = marks[i + 1] - marks[i];
        const height = amplitude(marks[i], marks[i + 1]);
        sums.periods++;
        sums.period += period;
        sums.amplitude += height;
        if (i + 2 < marks.length) {
          sums.pairs++;
          sums.periodDiff += Math.abs(period - (marks[i + 2] - marks[i + 1]));
          sums.amplitudeDiff += Math.abs(
            height - amplitude(marks[i + 1], marks[i + 2])
          );
        }
      }
      track.marks = storage.subarray(0, length);
      if (sums.periods >= MIN_PERIODS && sums.pairs > 0) {
        const mean = (sum) => sum / sums.pairs;
        track.jitter =
          (100 * mean(sums.periodDiff)) / (sums.period / sums.periods);
        track.shimmer =
          sums.amplitude > 0
            ? (100 * mean(sums.amplitudeDiff)) /
              (sums.amplitude / sums.periods)
            : null;
      }
    },
  };
}

/**
 * Sorted f0 values of the committed voiced frames and their percentiles.
 */
function createDistribution(capacity) {
  const values = new Float64Array(capacity);
  let length = 0;
  const at = (fraction) => {
    const position = fraction * (length - 1);
    const index = Math.floor(position);
    const next = Math.min(length - 1, index + 1);
    return values[index] + (values[next] - values[index]) * (position - index);
  };
  return {
    add(value) {
      let lo = 0;
      let hi = length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (values[mid] <= value) {
          lo = mid + 1;
        } else {
          hi = mid;
        }
      }
      values.copyWithin(lo + 1, lo, length);
      values[lo] = value;
      length++;
    },
    update(track) {
      if (length === 0) {
        return;
      }
      [track.low, track.median, track.high] = PERCENTILES.map(at);
    },
  };
}

/**
 * Streaming pitch tracker over a frame set of the front end.
 *
 * `advance(final = false)` scores every frame whose 50 ms window (and the
 * low-pass tail) has arrived in `frames.samples`, then commits frame t once
 * frame t + lag is scored by tracing back the best path from the newest
 * frame; `advance(true)` scores all `frames.count` frames (zeros after the
 * end) and commits them all. The delay in a stream is `lag * hop` plus half
 * the window: 125 ms with the defaults.
 * @param {import('./frontend.js').FrameSet} frames
 * @param {Partial<typeof PITCH_DEFAULTS>} [options]
 */
export function createPitchTracker(frames, options = {}) {
  const settings = pitchSettings(frames, options);
  const { hop, hopSamples, lag, voicedUnvoicedCost, octaveJumpCost } =
    settings;
  const capacity = settings.candidates;
  const states = capacity + 1; // voiced 0 .. capacity-1, unvoiced last
  const rows = frames.capacity;
  const store = {
    frequency: new Float32Array(rows * capacity),
    height: new Float32Array(rows * capacity),
    strength: new Float32Array(rows * capacity),
    count: new Uint8Array(rows),
    unvoiced: new Float32Array(rows),
  };
  const back = new Int8Array(rows * states);
  const path = new Int8Array(rows);
  let previous = new Float64Array(states);
  let current = new Float64Array(states);
  const finder = createCandidateFinder(frames, settings, store);
  const track = createTrack(frames, settings);
  const marker = createMarker(frames, track, settings);
  const distribution = createDistribution(rows);
  const offset = Math.round(frames.startTime / settings.hop);
  const base = Math.round(offset * hopSamples);
  const centre = (t) => Math.round((offset + t) * hopSamples) - base;
  let peak = 0;
  let peakScanned = 0;
  let runStart = -1;

  /** Viterbi step into frame t (t > 0) or the start (t = 0). */
  function step(t) {
    const count = store.count[t];
    const row = t * capacity;
    const unvoiced = store.unvoiced[t];
    let top = -Infinity;
    for (let s = 0; s < states; s++) {
      current[s] = -Infinity;
    }
    const previousCount = t > 0 ? store.count[t - 1] : 0;
    const previousRow = (t - 1) * capacity;
    for (let s = 0; s < states; s++) {
      const voiced = s < capacity;
      if (voiced && s >= count) {
        continue;
      }
      const gain = voiced ? store.strength[row + s] : unvoiced;
      if (t === 0) {
        current[s] = gain;
        back[s] = -1;
      } else {
        let best = -Infinity;
        let from = capacity;
        for (let p = 0; p < states; p++) {
          const wasVoiced = p < capacity;
          if (wasVoiced && p >= previousCount) {
            continue;
          }
          let cost = 0;
          if (voiced && wasVoiced) {
            cost =
              octaveJumpCost *
              Math.abs(
                Math.log2(
                  store.frequency[row + s] / store.frequency[previousRow + p]
                )
              );
          } else if (voiced !== wasVoiced) {
            cost = voicedUnvoicedCost;
          }
          const value = previous[p] - cost;
          if (value > best) {
            best = value;
            from = p;
          }
        }
        current[s] = best + gain;
        back[t * states + s] = from;
      }
      top = Math.max(top, current[s]);
    }
    // Keep the numbers small: the best path scores 0.
    for (let s = 0; s < states; s++) {
      current[s] -= top;
    }
    [previous, current] = [current, previous];
  }

  /** Commit frames track.committed .. last - 1 along the best path. */
  /** Frequency of the path at frame `t` (Hz), 0 when unvoiced. */
  function pathFrequency(t) {
    const chosen = path[t];
    return chosen < capacity ? store.frequency[t * capacity + chosen] : 0;
  }

  /**
   * f0 of the period that starts at frame `t`: the window centred on the
   * frame measures the period centred there, which starts half a period
   * earlier, so take the path's frequency half a period later
   * (interpolated in log frequency between the voiced frames up to
   * `newest`). This is the convention of the glottis, whose period is
   * fixed when it starts, and of YIN.
   */
  function onsetFrequency(t, newest) {
    const own = pathFrequency(t);
    const position = 0.5 / (own * hop);
    const whole = Math.floor(position);
    const step = position - whole;
    let from = own;
    for (let k = 1; k <= whole && t + k <= newest; k++) {
      const next = pathFrequency(t + k);
      if (!(next > 0)) {
        return from;
      }
      from = next;
    }
    const after = t + whole + 1 <= newest ? pathFrequency(t + whole + 1) : 0;
    return after > 0 ? from * (after / from) ** step : from;
  }

  function commit(last) {
    if (last <= track.committed) {
      return;
    }
    const newest = track.count - 1;
    let state = capacity;
    let best = -Infinity;
    for (let s = 0; s < states; s++) {
      if (previous[s] > best) {
        best = previous[s];
        state = s;
      }
    }
    for (let t = newest; t >= track.committed; t--) {
      path[t] = state;
      state = back[t * states + state];
    }
    for (let t = track.committed; t < last; t++) {
      const chosen = path[t];
      const row = t * capacity;
      const count = store.count[t];
      const voiced = chosen < capacity;
      const bestVoiced = count > 0 ? store.strength[row] : -Infinity;
      track.f0[t] = voiced ? onsetFrequency(t, newest) : 0;
      track.strength[t] = voiced
        ? store.height[row + chosen]
        : count > 0
          ? store.height[row]
          : 0;
      track.voicing[t] =
        count > 0
          ? Math.min(
              1,
              Math.max(
                0,
                0.5 + (bestVoiced - store.unvoiced[t]) / VOICING_SPREAD
              )
            )
          : 0;
      if (voiced) {
        distribution.add(track.f0[t]);
        if (runStart < 0) {
          runStart = t;
        }
      } else if (runStart >= 0) {
        marker.run(runStart, t - 1);
        runStart = -1;
      }
    }
    track.committed = last;
    distribution.update(track);
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
      for (; peakScanned < frames.sampleCount; peakScanned++) {
        peak = Math.max(peak, Math.abs(frames.samples[peakScanned]));
      }
      while (track.count < frames.count) {
        const t = track.count;
        const middle = centre(t);
        if (
          !final &&
          (finder.lastSample(middle) >= frames.sampleCount ||
            t + settings.energyAhead >= frames.count)
        ) {
          break;
        }
        finder.score(t, middle, peak);
        step(t);
        track.count++;
      }
      commit(final ? track.count : Math.max(0, track.count - lag));
      if (final && runStart >= 0) {
        marker.run(runStart, track.count - 1);
        runStart = -1;
      }
    },
  };
}

/**
 * Pitch track of a whole frame set: a tracker and `advance(true)`.
 * @param {Parameters<typeof createPitchTracker>[0]} frames
 * @param {Partial<typeof PITCH_DEFAULTS>} [options]
 */
export function trackPitch(frames, options = {}) {
  const tracker = createPitchTracker(frames, options);
  tracker.advance(true);
  return tracker.track;
}
