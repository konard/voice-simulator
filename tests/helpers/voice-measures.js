/**
 * Measures of a rendered utterance for the effect test of the head
 * parameters (issue 41): each HEAD_PARAMETERS entry names one of MEASURES
 * in `effect.measure`, and the sign of its change from `min` to `max` in
 * `effect.sign`. Used by tests/head-parameters.test.js and
 * experiments/issue-41-effects.mjs.
 *
 * An effect renders `effect.ipa` (default EFFECT_PHRASE) as IPA on the
 * audio tier `effect.tier` (default 'minimal') with a fixed seed, the head
 * `{...effect.head, [key]: value}` and the synthesize() options
 * `effect.options`; `effect.values` replaces `[min, max]` where the two
 * ends sound alike (an angle of -180° and 180°).
 */

import { synthesize } from '../../src/synthesize.js';
import {
  estimateFormants,
  lpcCoefficients,
  lpcEnvelope,
  decimate,
  harmonicLevel,
  rms,
} from '../../src/acoustics/analysis.js';
import {
  median,
  percentile,
  yinPitch,
} from '../../src/analysis/voice-features.js';
import { powerFrames } from '../../src/metrics/spectrum.js';

export const EFFECT_PHRASE = 'ˈmama ˈsasa';
export const EFFECT_SEED = 41;

export const MEASURES = [
  'duration',
  'rms',
  'f0',
  'f0Range',
  'hnr',
  'h1h2',
  'centroid',
  'f1',
  'f2',
  'f3',
  'bandwidth1',
  'noiseLevel',
  'nasalLevel',
  'reverb',
];

/** The two values an effect compares: `effect.values` or `[min, max]`. */
export function effectValues(parameter) {
  return parameter.effect.values ?? [parameter.min, parameter.max];
}

/** Render the effect phrase of `parameter` with the head value `value`. */
export function renderEffect(parameter, value) {
  const { effect } = parameter;
  return synthesize(effect.ipa ?? EFFECT_PHRASE, {
    ...effect.options,
    ipa: true,
    tier: effect.tier ?? 'minimal',
    seed: EFFECT_SEED,
    head: { ...effect.head, [parameter.key]: value },
  });
}

const index = (time, sampleRate) => Math.round(time * sampleRate);

/** RMS over the given plan segments. */
function segmentLevel(result, segments) {
  let sum = 0;
  let count = 0;
  for (const segment of segments) {
    const start = index(segment.start, result.sampleRate);
    const end = index(segment.end, result.sampleRate);
    sum += rms(result.samples, start, end) ** 2 * (end - start);
    count += end - start;
  }
  return Math.sqrt(sum / Math.max(1, count));
}

const vowels = (result) =>
  result.plan.segments.filter((segment) => segment.kind === 'vowel');

/** Noisy consonants: fricatives, voiceless and aspirated ones. */
const noisy = (result) =>
  result.plan.segments.filter(
    (segment) =>
      segment.kind === 'consonant' &&
      ((segment.target.frication ?? 0) > 0 ||
        (segment.target.sibilance ?? 0) > 0 ||
        (segment.target.aspiration ?? 0) > 0 ||
        segment.target.voicing === 0)
  );

const nasal = (result) =>
  result.plan.segments.filter(
    (segment) =>
      segment.kind === 'consonant' && (segment.target.velum ?? 0) > 0.5
  );

/** The middle 60 ms (at most half the vowel) of each vowel. */
function vowelWindows(result) {
  return vowels(result).map((segment) => {
    const duration = Math.min(0.06, (segment.end - segment.start) / 2);
    return {
      start: (segment.start + segment.end) / 2 - duration / 2,
      duration,
    };
  });
}

/** YIN frames (40 ms, every 10 ms) inside the vowels at 11025 Hz. */
function pitchFrames(result) {
  const { samples, sampleRate } = decimate(
    result.samples,
    result.sampleRate,
    11025
  );
  const length = Math.round(0.04 * sampleRate);
  const frames = [];
  for (const segment of vowels(result)) {
    for (
      let time = segment.start + 0.01;
      time + 0.04 <= segment.end - 0.01;
      time += 0.01
    ) {
      frames.push(
        yinPitch(samples, index(time, sampleRate), length, sampleRate)
      );
    }
  }
  return frames;
}

function f0Track(result) {
  return pitchFrames(result)
    .filter((frame) => frame.aperiodicity < 0.3)
    .map((frame) => frame.f0);
}

/** F1-F3 (Hz) and the -3 dB bandwidth of F1 of each vowel (LPC 14). */
function formantTrack(result) {
  return vowelWindows(result).map((window) => ({
    formants: estimateFormants(result.samples, result.sampleRate, {
      ...window,
      count: 3,
      order: 14,
    }),
    bandwidth1: firstBandwidth(result, window),
  }));
}

function firstBandwidth(result, { start, duration }) {
  const from = index(start, result.sampleRate);
  const slice = Array.prototype.slice.call(
    result.samples,
    from,
    from + index(duration, result.sampleRate)
  );
  const decimated = decimate(slice, result.sampleRate, 11025);
  const frame = decimated.samples;
  for (let at = frame.length - 1; at > 0; at--) {
    frame[at] -= 0.94 * frame[at - 1];
  }
  for (let at = 0; at < frame.length; at++) {
    frame[at] *=
      0.54 - 0.46 * Math.cos((2 * Math.PI * at) / (frame.length - 1));
  }
  const { frequencies, magnitudes } = lpcEnvelope(
    lpcCoefficients(frame, 14),
    decimated.sampleRate,
    5
  );
  let peak = -1;
  for (let at = 1; at < magnitudes.length - 1; at++) {
    if (
      frequencies[at] > 150 &&
      magnitudes[at] > magnitudes[at - 1] &&
      magnitudes[at] >= magnitudes[at + 1]
    ) {
      peak = at;
      break;
    }
  }
  if (peak < 0) {
    return 0;
  }
  const half = magnitudes[peak] / Math.SQRT2;
  let low = peak;
  while (low > 0 && magnitudes[low] > half) {
    low--;
  }
  let high = peak;
  while (high < magnitudes.length - 1 && magnitudes[high] > half) {
    high++;
  }
  return frequencies[high] - frequencies[low];
}

/** Amplitude-weighted centroid of the long-term spectrum (Hz). */
function centroid(result) {
  const frames = powerFrames(result.samples, result.sampleRate);
  const size = frames[0].length;
  let weighted = 0;
  let total = 0;
  for (let bin = 0; bin < size; bin++) {
    let power = 0;
    for (const frame of frames) {
      power += frame[bin];
    }
    const amplitude = Math.sqrt(power / frames.length);
    weighted += amplitude * ((bin * result.sampleRate) / (2 * (size - 1)));
    total += amplitude;
  }
  return weighted / (total || 1);
}

const formantMeasure = (slot) => (result) =>
  median(formantTrack(result).map((entry) => entry.formants[slot] ?? 0));

const MEASURE_FUNCTIONS = {
  /** Planned length of the utterance (s). */
  duration: (result) => result.plan.duration,
  rms: (result) => rms(result.samples),
  /** Median f0 of the vowels (Hz). */
  f0: (result) => median(f0Track(result)),
  /** Range of f0 from the 5th to the 95th percentile (semitones). */
  f0Range: (result) => {
    const track = f0Track(result);
    return 12 * Math.log2(percentile(track, 0.95) / percentile(track, 0.05));
  },
  /** Harmonics-to-noise ratio from the YIN aperiodicity (dB). */
  hnr: (result) => {
    const aperiodicity = median(
      pitchFrames(result).map((frame) =>
        Math.min(0.999, Math.max(1e-4, frame.aperiodicity))
      )
    );
    return 10 * Math.log10((1 - aperiodicity) / aperiodicity);
  },
  /** First minus second harmonic level of the vowels (dB). */
  h1h2: (result) => {
    const f0 = median(f0Track(result));
    return median(
      vowelWindows(result).map(
        (window) =>
          harmonicLevel(result.samples, result.sampleRate, f0, window) -
          harmonicLevel(result.samples, result.sampleRate, 2 * f0, window)
      )
    );
  },
  centroid,
  f1: formantMeasure(0),
  f2: formantMeasure(1),
  f3: formantMeasure(2),
  bandwidth1: (result) =>
    median(formantTrack(result).map((entry) => entry.bandwidth1)),
  /** RMS of the fricative, voiceless and aspirated consonants. */
  noiseLevel: (result) => segmentLevel(result, noisy(result)),
  /** RMS of the nasal consonants. */
  nasalLevel: (result) => segmentLevel(result, nasal(result)),
  /** Energy after the end of the plan (the room's tail). */
  reverb: (result) => {
    const start = index(result.plan.duration, result.sampleRate);
    return rms(result.samples, start) ** 2 * (result.samples.length - start);
  },
};

/** The value of `measure` (one of MEASURES) for a synthesize() result. */
export function measureVoice(result, measure) {
  const measureFunction = MEASURE_FUNCTIONS[measure];
  if (!measureFunction) {
    throw new Error(`Unknown measure "${measure}"`);
  }
  return measureFunction(result);
}

/**
 * Render a parameter at both effect values and measure its effect:
 * `{low, high, difference, sign}`.
 */
export function measureEffect(parameter) {
  const [low, high] = effectValues(parameter).map((value) =>
    measureVoice(renderEffect(parameter, value), parameter.effect.measure)
  );
  const difference = high - low;
  return { low, high, difference, sign: Math.sign(difference) };
}
