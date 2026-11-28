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
 * arrived and commits frame t when frame t + lag has been scored (all frames with
 * `final`). Rows of the track before `committed` never change.
 */

import { createFft } from './fft.js';
import { withPitchDsp } from './pitch-rust.js';

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
/** Short-lag peaks can be the ringing of a consonant's release. */
const SHORT_PERIOD_F0 = 400;
/** Allow for comparing a coarse, interpolated peak with a refined peak. */
const SECOND_PERIOD_TOLERANCE = 0.12;
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

const pitchWindows = new Map();

function pitchWindow(length, maxLag) {
  const key = `${length}/${maxLag}`;
  if (!pitchWindows.has(key)) {
    if (pitchWindows.size === 8) {
      pitchWindows.delete(pitchWindows.keys().next().value);
    }
    const window = hannWindow(length);
    pitchWindows.set(key, {
      window,
      correlation: windowCorrelation(window, maxLag),
    });
  }
  return pitchWindows.get(key);
}

/** Write [offset, top] of the parabola through (−1, a), (0, b), (1, c). */
function parabola(a, b, c, peak) {
  const curvature = a - 2 * b + c;
  if (!(curvature < 0)) {
    peak[0] = 0;
    peak[1] = b;
    return;
  }
  const offset = (0.5 * (a - c)) / curvature;
  peak[0] = offset;
  peak[1] = b - 0.25 * (a - c) * offset;
}

/** Empty track of `capacity` rows. */
function createTrack(frames, settings, rows) {
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

/** Working sample `index` of `frames`, 0 outside the received samples. */
function sampleAt(frames, index) {
  return index >= 0 && index < frames.sampleCount ? frames.samples[index] : 0;
}

function samplePeak(samples, start, end, prior) {
  let peak = prior;
  for (let n = start; n < end; n++) {
    const magnitude = Math.abs(samples[n]);
    if (magnitude > peak || Number.isNaN(magnitude)) {
      peak = magnitude;
    }
  }
  return peak;
}

/**
 * Extra unvoiced strength of frame `t` from the front end's energies: a
 * frame far below the loudest frame of the last 200 ms (and the next 10 ms)
 * is the decaying tail of a vowel or a quiet consonant whose 50 ms window
 * still holds the periodic neighbour; a frame near the noise floor is noise.
 */
function quietness(frames, settings, t) {
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

function decimateTail(frames, kernel, factor, start, coarse, kept) {
  const { samples, sampleCount } = frames;
  const half = (kernel.length - 1) / 2;
  for (let n = kept; n < coarse.length; n++) {
    const first = (start + n) * factor - half;
    const from = Math.max(0, -first);
    const to = Math.min(kernel.length, sampleCount - first);
    let sum = 0;
    for (let k = from; k < to; k++) {
      sum += kernel[k] * samples[first + k];
    }
    coarse[n] = sum;
  }
}

function windowCoarse(coarse, window, re) {
  let mean = 0;
  for (let n = 0; n < coarse.length; n++) {
    mean += coarse[n];
  }
  mean /= coarse.length;
  for (let n = 0; n < coarse.length; n++) {
    re[n] = (coarse[n] - mean) * window[n];
  }
}

function autocorrelate(fft, re, im, correlation, q, { lagMin, lagMax }) {
  fft.forward(re, im);
  for (let k = 0; k < re.length; k++) {
    re[k] = re[k] * re[k] + im[k] * im[k];
    im[k] = 0;
  }
  fft.inverse(re, im);
  const energy = re[0];
  if (!(energy > 0)) {
    return false;
  }
  for (let lag = lagMin - 1; lag <= lagMax + 1; lag++) {
    q[lag] = re[lag] / (energy * correlation[lag]);
  }
  return true;
}

/**
 * The coarse signal (low-passed, every `factor`-th sample, computed as the
 * samples arrive) and the normalised autocorrelation of its Hann-windowed
 * frames by the transform.
 */
function createCoarseCorrelator(frames, settings, buffers) {
  const { factor, coarseLength, size, lagMax } = settings;
  const { kernel, half } = coarseKernel(factor);
  const { window, correlation } = pitchWindow(coarseLength, lagMax + 1);
  const fft = createFft(size);
  const { re, im, coarse } = buffers;
  const frameHalf = Math.floor(coarseLength / 2);
  let previous = -Infinity;

  /** Keep the overlap with the previous window and fill its new tail. */
  function fill(start) {
    const shift = start - previous;
    previous = start;
    if (shift === 0) {
      return;
    }
    const kept = Math.max(0, coarseLength - shift);
    if (kept > 0) {
      coarse.copyWithin(0, shift);
    }
    if (settings.dsp) {
      settings.dsp.decimate(
        frames,
        kernel,
        half,
        start + kept,
        coarse.subarray(kept)
      );
      return;
    }
    decimateTail(frames, kernel, factor, start, coarse, kept);
  }

  return {
    /** Last working sample the coarse frame at `centre` reads. */
    lastSample(centre) {
      return (
        (Math.round(centre / factor) - frameHalf + coarseLength - 1) * factor +
        half
      );
    },
    /**
     * Normalised autocorrelation of the coarse frame at working sample
     * `centre` into `q` (lags lagMin - 1 .. lagMax + 1); false when the
     * frame is silent.
     */
    correlate(centre, q) {
      const start = Math.round(centre / factor) - frameHalf;
      fill(start);
      windowCoarse(coarse, window, re);
      if (settings.dsp) {
        return settings.dsp.correlate(re, correlation, q);
      }
      re.fill(0, coarseLength);
      im.fill(0);
      return autocorrelate(fft, re, im, correlation, q, settings);
    },
  };
}

function loadPitchWindow(frames, start, window, full, frame) {
  const { samples, sampleCount } = frames;
  const from = Math.max(0, -start);
  const to = Math.max(from, Math.min(full.length, sampleCount - start));
  full.fill(0, 0, from);
  full.fill(0, to);
  let mean = 0;
  let largest = 0;
  for (let n = from; n < to; n++) {
    const value = samples[start + n];
    full[n] = value;
    mean += value;
    largest = Math.max(largest, Math.abs(value));
  }
  mean /= full.length;
  let energy = 0;
  for (let n = 0; n < full.length; n++) {
    const value = (full[n] - mean) * window[n];
    full[n] = value;
    energy += value * value;
  }
  frame.energy = energy;
  frame.largest = largest;
}

function lagPower(full, lag) {
  const length = full.length - lag;
  let sum = 0;
  for (let n = 0; n < length; n++) {
    sum += full[n] * full[n + lag];
  }
  return sum;
}

/**
 * The Hann-windowed full-rate frame without its mean, and the refinement
 * of a coarse lag on it.
 */
function createFullFrame(frames, settings, full) {
  const { factor, fullLength, lagMax } = settings;
  const maxLag = factor * (lagMax + 1) + factor + 1;
  const { window, correlation } = pitchWindow(
    fullLength,
    Math.min(fullLength - 1, maxLag)
  );
  const half = Math.floor(fullLength / 2);
  const frame = { energy: 0, largest: 0 };

  /** Normalised autocorrelation of the frame at `lag`. */
  function at(lag) {
    if (lag < 1 || lag >= correlation.length) {
      return -1;
    }
    return lagPower(full, lag) / (frame.energy * correlation[lag]);
  }

  return {
    frame,
    /** Last working sample the frame at `centre` reads. */
    lastSample(centre) {
      return centre - half + fullLength - 1;
    },
    /** Load the frame at working sample `centre`: its energy after the
     * window and its largest |sample| before. */
    load(centre) {
      const start = centre - half;
      if (settings.dsp) {
        settings.dsp.load(frames, start, window, correlation, frame);
        return;
      }
      loadPitchWindow(frames, start, window, full, frame);
    },
    /** Write [full-rate lag, height] of a valid refined maximum. */
    refine(coarseLag, peak) {
      const centre = Math.round(coarseLag * factor);
      if (settings.dsp) {
        return settings.dsp.refine(frame.energy, centre, peak);
      }
      let best = -Infinity;
      let bestLag = -1;
      for (let lag = centre - factor; lag <= centre + factor; lag++) {
        const value = at(lag);
        if (value > best) {
          best = value;
          bestLag = lag;
        }
      }
      if (bestLag < 2) {
        return false;
      }
      parabola(at(bestLag - 1), best, at(bestLag + 1), peak);
      peak[0] = bestLag + peak[0];
      peak[1] = Math.min(1, peak[1]);
      return true;
    },
  };
}

/**
 * Insert a candidate into the `kept` (sorted by strength) of the row of
 * `capacity` that starts at `row`; returns the new count.
 */
function insertCandidate(store, row, kept, capacity, candidate) {
  let slot = Math.min(kept, capacity);
  while (slot > 0 && store.strength[row + slot - 1] < candidate.strength) {
    if (slot < capacity) {
      store.frequency[row + slot] = store.frequency[row + slot - 1];
      store.height[row + slot] = store.height[row + slot - 1];
      store.strength[row + slot] = store.strength[row + slot - 1];
    }
    slot--;
  }
  if (slot < capacity) {
    store.frequency[row + slot] = candidate.frequency;
    store.height[row + slot] = candidate.height;
    store.strength[row + slot] = candidate.strength;
  }
  return Math.min(capacity, kept + 1);
}

/**
 * Candidate finder: the coarse autocorrelation and the refinement at the
 * full rate. `score(t, centre, peak)` writes the voiced candidates of frame
 * t (frequency, height, strength), their number and the strength of the
 * unvoiced candidate.
 */
const MAX_BATCH_WINDOW_CELLS = 16384;

function candidateBuffers(settings, workspace) {
  const { size, coarseLength, fullLength } = settings;
  const length = 2 * size + coarseLength + fullLength;
  let data = workspace?.windows;
  if (!data || data.length < length) {
    data = new Float64Array(length);
    if (workspace && length <= MAX_BATCH_WINDOW_CELLS) {
      workspace.windows = data;
    }
  }
  return {
    re: data.subarray(0, size),
    im: data.subarray(size, 2 * size),
    coarse: data.subarray(2 * size, 2 * size + coarseLength),
    full: data.subarray(2 * size + coarseLength, length),
  };
}

function createCandidateFinder(frames, settings, store, shared, workspace) {
  const { lagMin, lagMax, rate, minF0, maxF0, octaveCost } = settings;
  const capacity = settings.candidates;
  const buffers = candidateBuffers(settings, workspace);
  const coarse = createCoarseCorrelator(frames, settings, buffers);
  const full = createFullFrame(frames, settings, buffers.full);
  const q = new Float64Array(lagMax + 2);
  // Only the strongest coarse maxima reach full-rate refinement.
  const tried = 2 * capacity + 2;
  const peakLag = new Float64Array(tried);
  const peakHeight = new Float64Array(tried);
  const interpolated = new Float64Array(2);
  const candidate = { frequency: 0, height: 0, strength: 0 };
  const strengthOf = (height, frequency) =>
    height - octaveCost * Math.log2(maxF0 / frequency);

  /** Keep the strongest maxima of q, preserving lag order for ties. */
  function findMaxima() {
    let count = 0;
    for (let lag = lagMin; lag <= lagMax; lag++) {
      if (q[lag] > q[lag - 1] && q[lag] >= q[lag + 1] && q[lag] > 0) {
        parabola(q[lag - 1], q[lag], q[lag + 1], interpolated);
        const exact = lag + interpolated[0];
        const strength = strengthOf(
          Math.min(1, interpolated[1]),
          settings.coarseRate / exact
        );
        let slot = count;
        while (slot > 0 && peakHeight[slot - 1] < strength) {
          if (slot < tried) {
            peakLag[slot] = peakLag[slot - 1];
            peakHeight[slot] = peakHeight[slot - 1];
          }
          slot--;
        }
        if (slot < tried) {
          peakLag[slot] = exact;
          peakHeight[slot] = strength;
          count = Math.min(count + 1, tried);
        }
      }
    }
    return count;
  }

  function scoreUnvoiced(t, largest, peak) {
    const ratio = peak > 0 ? largest / peak : 0;
    store.unvoiced[t] =
      settings.voicingThreshold +
      Math.max(0, 2 - ratio / settings.silence) +
      quietness(frames, settings, t);
  }

  return {
    lastSample(centre) {
      return Math.max(full.lastSample(centre), coarse.lastSample(centre));
    },
    /**
     * Candidates of frame `t` centred on working sample `centre`; `peak` is
     * the largest absolute sample so far.
     */
    score(t, centre, peak) {
      if (shared?.source) {
        const { source } = shared;
        const fine = t * 2;
        store.count[t] = source.count[fine];
        for (let i = 0; i < store.count[t]; i++) {
          const from = fine * capacity + i;
          const to = t * capacity + i;
          store.frequency[to] = source.frequency[from];
          store.height[to] = source.height[from];
          store.strength[to] = source.strength[from];
        }
        scoreUnvoiced(t, source.largest[fine], peak);
        return;
      }
      full.load(centre);
      const { energy, largest } = full.frame;
      if (store.largest) {
        store.largest[t] = largest;
      }
      scoreUnvoiced(t, largest, peak);
      store.count[t] = 0;
      if (!coarse.correlate(centre, q) || !(energy > 0)) {
        return;
      }
      let kept = 0;
      const count = findMaxima();
      for (let index = 0; index < count; index++) {
        const coarseLag = peakLag[index];
        if (!full.refine(coarseLag, interpolated)) {
          continue;
        }
        const frequency = rate / interpolated[0];
        if (frequency >= minF0 && frequency <= maxF0) {
          candidate.frequency = frequency;
          candidate.height = interpolated[1];
          // A brief resonant burst can have a strong short-lag peak. At
          // high frequencies, check that it persists for a second period.
          const second = 2 * coarseLag;
          const lag = Math.floor(second);
          const support =
            frequency > SHORT_PERIOD_F0 && lag < lagMax
              ? q[lag] + (q[lag + 1] - q[lag]) * (second - lag)
              : interpolated[1];
          candidate.strength = strengthOf(
            Math.min(interpolated[1], support + SECOND_PERIOD_TOLERANCE),
            frequency
          );
          kept = insertCandidate(
            store,
            t * capacity,
            kept,
            capacity,
            candidate
          );
        }
      }
      store.count[t] = kept;
    },
  };
}

/** Normalised cross-correlation of x[a ..] and x[b ..], `n` samples. */
function crossCorrelation(frames, a, b, n) {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    const x = sampleAt(frames, a + i);
    const y = sampleAt(frames, b + i);
    ab += x * y;
    aa += x * x;
    bb += y * y;
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : -1;
}

/** Peak-to-peak amplitude of x over [a, b). */
function peakToPeak(frames, a, b) {
  let low = Infinity;
  let high = -Infinity;
  const end = Math.round(b);
  for (let n = Math.round(a); n < end; n++) {
    const value = sampleAt(frames, n);
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  return high > low ? high - low : 0;
}

/** Add the periods between `marks` (working samples) of one run to the
 * sums of jitter and shimmer. */
function addPeriods(frames, sums, marks) {
  let previousPeriod = 0;
  let previousHeight = 0;
  for (let i = 0; i + 1 < marks.length; i++) {
    const period = marks[i + 1] - marks[i];
    const height = peakToPeak(frames, marks[i], marks[i + 1]);
    sums.periods++;
    sums.period += period;
    sums.amplitude += height;
    if (i > 0) {
      sums.pairs++;
      sums.periodDiff += Math.abs(previousPeriod - period);
      sums.amplitudeDiff += Math.abs(previousHeight - height);
    }
    previousPeriod = period;
    previousHeight = height;
  }
}

/** Jitter and shimmer (percent) of the sums, from MIN_PERIODS periods. */
function setPerturbation(track, sums) {
  if (sums.periods < MIN_PERIODS || sums.pairs === 0) {
    return;
  }
  const meanPeriod = sums.period / sums.periods;
  const meanAmplitude = sums.amplitude / sums.periods;
  track.jitter = (100 * sums.periodDiff) / sums.pairs / meanPeriod;
  track.shimmer =
    meanAmplitude > 0
      ? (100 * sums.amplitudeDiff) / sums.pairs / meanAmplitude
      : null;
}

/**
 * Period marks, jitter and shimmer of committed runs of voiced frames.
 */
function createMarker(frames, track, settings) {
  const { rate, hopSamples } = settings;
  const runFrames = Math.ceil(MARK_RUN / settings.hop - 1e-9);
  const interpolated = new Float64Array(2);
  let storage = new Float64Array(256);
  let length = 0;
  const sums = {
    periods: 0,
    period: 0,
    amplitude: 0,
    pairs: 0,
    periodDiff: 0,
    amplitudeDiff: 0,
  };

  function push(time) {
    if (length === storage.length) {
      const grown = new Float64Array(storage.length * 2);
      grown.set(storage);
      storage = grown;
    }
    storage[length++] = time;
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
    if (settings.dsp) {
      return settings.dsp.mark(frames, anchor, lo, hi, span);
    }
    let best = -Infinity;
    let place = -1;
    for (let p = lo; p <= hi; p++) {
      const value = crossCorrelation(frames, anchor, p, span);
      if (value > best) {
        best = value;
        place = p;
      }
    }
    parabola(
      crossCorrelation(frames, anchor, place - 1, span),
      best,
      crossCorrelation(frames, anchor, place + 1, span),
      interpolated
    );
    return place + Math.max(-0.5, Math.min(0.5, interpolated[0]));
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
      const value = Math.abs(sampleAt(frames, n));
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
      addPeriods(frames, sums, marks);
      track.marks = storage.subarray(0, length);
      setPerturbation(track, sums);
      // Additive sufficient statistics; periods are seconds so stretches
      // recorded at different sample rates can be pooled by voice fitting.
      track.perturbation = {
        ...sums,
        period: sums.period / rate,
        periodDiff: sums.periodDiff / rate,
      };
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
      track.low = at(PERCENTILES[0]);
      track.median = at(PERCENTILES[1]);
      track.high = at(PERCENTILES[2]);
    },
  };
}

/**
 * Viterbi search over the candidates of `store`: states 0 .. capacity - 1
 * are the voiced candidates of a frame, state `capacity` is unvoiced.
 * `step(t)` adds frame t; `trace(path, first)` writes the best path to the
 * newest frame into `path` from that frame back to `first`.
 */
function createViterbi(store, settings, back) {
  const capacity = settings.candidates;
  const states = capacity + 1;
  const { voicedUnvoicedCost, octaveJumpCost } = settings;
  const { count: counts, frequency, strength, unvoiced } = store;
  let previous = new Float64Array(states);
  let current = new Float64Array(states);
  let newest = -1;

  function firstFrame(count) {
    let top = -Infinity;
    for (let s = 0; s < count; s++) {
      const score = 0 + strength[s];
      current[s] = score;
      top = Math.max(top, score);
    }
    const score = 0 + unvoiced[0];
    current[capacity] = score;
    return Math.max(top, score);
  }

  function followingFrame(t, count) {
    const row = t * capacity;
    const previousRow = row - capacity;
    const previousCount = counts[t - 1];
    const backRow = t * states;
    const fromUnvoiced = previous[capacity] - voicedUnvoicedCost;
    let top = -Infinity;
    for (let s = 0; s < count; s++) {
      const hz = frequency[row + s];
      let score = -Infinity;
      let from = capacity;
      for (let p = 0; p < previousCount; p++) {
        const cost =
          octaveJumpCost * Math.abs(Math.log2(hz / frequency[previousRow + p]));
        const value = previous[p] - cost;
        if (value > score) {
          score = value;
          from = p;
        }
      }
      // The unvoiced state follows the voiced states, including on ties.
      if (fromUnvoiced > score) {
        score = fromUnvoiced;
        from = capacity;
      }
      back[backRow + s] = from;
      const emitted = score + strength[row + s];
      current[s] = emitted;
      top = Math.max(top, emitted);
    }
    let score = -Infinity;
    let from = capacity;
    for (let p = 0; p < previousCount; p++) {
      const value = previous[p] - voicedUnvoicedCost;
      if (value > score) {
        score = value;
        from = p;
      }
    }
    if (previous[capacity] > score) {
      score = previous[capacity];
      from = capacity;
    }
    back[backRow + capacity] = from;
    const emitted = score + unvoiced[t];
    current[capacity] = emitted;
    return Math.max(top, emitted);
  }

  return {
    /** Add frame t (frames in order from 0). */
    step(t) {
      const count = counts[t];
      const top = t === 0 ? firstFrame(count) : followingFrame(t, count);
      for (let s = count; s < capacity; s++) {
        current[s] = -Infinity;
      }
      // Keep the numbers small: the best path scores 0.
      for (let s = 0; s < states; s++) {
        current[s] -= top;
      }
      const completed = current;
      current = previous;
      previous = completed;
      newest = t;
    },
    trace(path, first) {
      let state = capacity;
      let top = -Infinity;
      for (let s = 0; s < states; s++) {
        if (previous[s] > top) {
          top = previous[s];
          state = s;
        }
      }
      for (let t = newest; t >= first; t--) {
        path[t] = state;
        state = back[t * states + state];
      }
    },
  };
}

/**
 * f0 of the period that starts at frame `t`, from the path frequencies
 * `frequencyAt(k)` (0 when unvoiced) up to frame `newest`: the window
 * centred on the frame measures the period centred there, which starts
 * half a period earlier, so take the path's frequency half a period later,
 * interpolated in log frequency between voiced frames. This is the
 * convention of the glottis, whose period is fixed when it starts, and of
 * YIN.
 */
function onsetFrequency(frequencyAt, hop, t, newest) {
  const own = frequencyAt(t);
  const position = 0.5 / (own * hop);
  const whole = Math.floor(position);
  const fraction = position - whole;
  let from = own;
  for (let k = 1; k <= whole && t + k <= newest; k++) {
    const next = frequencyAt(t + k);
    if (!(next > 0)) {
      return from;
    }
    from = next;
  }
  const after = t + whole + 1 <= newest ? frequencyAt(t + whole + 1) : 0;
  return after > 0 ? from * (after / from) ** fraction : from;
}

/** Strength and voicing of frame t whose path state is `chosen` (the
 * best candidate's height when unvoiced). */
function frameScores(track, store, capacity, t, chosen) {
  const row = t * capacity;
  if (store.count[t] === 0) {
    track.strength[t] = 0;
    track.voicing[t] = 0;
    return;
  }
  track.strength[t] = store.height[row + (chosen < capacity ? chosen : 0)];
  const margin = store.strength[row] - store.unvoiced[t];
  track.voicing[t] = Math.min(1, Math.max(0, 0.5 + margin / VOICING_SPREAD));
}

/**
 * Streaming pitch tracker over a frame set of the front end.
 *
 * `advance(final = false)` scores every frame whose 50 ms window (and the
 * low-pass tail) has arrived in `frames.samples`, then commits frame t when
 * frame t + lag has been scored, by tracing back the best path from the newest
 * frame; `advance(true)` scores all `frames.count` frames (zeros after the
 * end) and commits them all. The delay in a stream is `lag * hop` plus half
 * the window: 125 ms with the defaults.
 * @param {import('./frontend.js').FrameSet} frames
 * @param {Partial<typeof PITCH_DEFAULTS>} [options]
 */
export function createPitchTracker(frames, options = {}) {
  return pitchTracker(frames, options);
}

function pitchScratch(rows, capacity, workspace) {
  const cells = rows * capacity;
  const traces = rows * (capacity + 1);
  const prior = workspace?.scratch;
  if (
    prior?.path.length >= rows &&
    prior.store.height.length >= cells &&
    prior.back.length >= traces
  ) {
    return prior;
  }
  const scratch = {
    store: {
      frequency: new Float32Array(cells),
      height: new Float32Array(cells),
      strength: new Float32Array(cells),
      count: new Uint8Array(rows),
      unvoiced: new Float32Array(rows),
    },
    path: new Int8Array(rows),
    back: new Int8Array(traces),
  };
  if (workspace) {
    workspace.scratch = scratch;
  }
  return scratch;
}

function pitchTracker(frames, options, shared, workspace, frameOnly = false) {
  const settings = pitchSettings(frames, options);
  const { hop, hopSamples, lag } = settings;
  const capacity = settings.candidates;
  const rows = frameOnly ? frames.count : frames.capacity;
  const { store, path, back } = pitchScratch(rows, capacity, workspace);
  if (shared && !shared.source) {
    store.largest = new Float64Array(rows);
    shared.save = store;
  }
  const viterbi = createViterbi(store, settings, back);
  const finder = createCandidateFinder(
    frames,
    settings,
    store,
    shared,
    workspace
  );
  const track = createTrack(frames, settings, rows);
  const marks = !frameOnly && !options.frameOnly;
  const marker = marks ? createMarker(frames, track, settings) : null;
  const distribution =
    marks || options.percentiles ? createDistribution(rows) : null;
  const offset = Math.round(frames.startTime / settings.hop);
  const base = Math.round(offset * hopSamples);
  const centre = (t) => Math.round((offset + t) * hopSamples) - base;
  /** Frequency of the path at frame `t` (Hz), 0 when unvoiced. */
  const pathFrequency = (t) =>
    path[t] < capacity ? store.frequency[t * capacity + path[t]] : 0;
  let peak = 0;
  let peakScanned = 0;
  let runStart = -1;

  /** Commit frames track.committed .. last - 1 along the best path. */
  function commit(last) {
    if (last <= track.committed) {
      return;
    }
    const newest = track.count - 1;
    viterbi.trace(path, track.committed);
    for (let t = track.committed; t < last; t++) {
      const voiced = path[t] < capacity;
      track.f0[t] = voiced ? onsetFrequency(pathFrequency, hop, t, newest) : 0;
      frameScores(track, store, capacity, t, path[t]);
      if (voiced) {
        distribution?.add(track.f0[t]);
      }
      if (marker) {
        observeRun(voiced, t);
      }
    }
    track.committed = last;
    distribution?.update(track);
  }

  function observeRun(voiced, t) {
    if (voiced) {
      if (runStart < 0) {
        runStart = t;
      }
    } else if (runStart >= 0) {
      marker.run(runStart, t - 1);
      runStart = -1;
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
      const sampleCount = frames.sampleCount;
      if (peakScanned < sampleCount) {
        peak = samplePeak(frames.samples, peakScanned, sampleCount, peak);
        peakScanned = sampleCount;
      }
      const clipPeak = peak;
      withPitchDsp(options.kernels?.module, settings, () => {
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
          finder.score(t, middle, clipPeak);
          viterbi.step(t);
          track.count++;
        }
        commit(final ? track.count : Math.max(0, track.count - lag));
        if (final && runStart >= 0) {
          marker.run(runStart, track.count - 1);
          runStart = -1;
        }
      });
    },
  };
}

/**
 * Pitch track of a whole frame set: a tracker and `advance(true)`.
 * @param {Parameters<typeof createPitchTracker>[0]} frames
 * @param {Partial<typeof PITCH_DEFAULTS>} [options]
 */
export function trackPitch(frames, options = {}) {
  return batchPitch(frames, options, false);
}

let batchPitchWorkspace;

/** Batch frame-level pitch and optional percentiles, without pulse trains. */
export function trackPitchFrames(frames, options = {}) {
  return batchPitch(frames, options, true);
}

function batchPitch(frames, options, frameOnly) {
  const workspace = batchPitchWorkspace ?? {};
  batchPitchWorkspace = undefined;
  try {
    const tracker = pitchTracker(
      frames,
      options,
      undefined,
      workspace,
      frameOnly
    );
    tracker.advance(true);
    return tracker.track;
  } finally {
    // Retain scratch for typical clips. Output columns have their own storage.
    if (workspace.scratch?.back.length <= 65536) {
      batchPitchWorkspace = workspace;
    }
  }
}

/** Score shared 5 ms and 10 ms windows once, then solve their paths independently. */
export function trackPitchHops({ fine, coarse }, options = {}) {
  const shared = {};
  const fast = pitchTracker(fine, options, shared);
  fast.advance(true);
  const slow = pitchTracker(coarse, options, { source: shared.save });
  slow.advance(true);
  return { fitPitch: fast.track, pitch: slow.track };
}
