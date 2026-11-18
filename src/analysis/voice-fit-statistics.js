/** Fixed-memory sufficient statistics for voice fitting. Unlicense, issue 63. */
import { analyzeFrames } from '../recognition/frontend.js';
import { trackPitch, jitterToHead } from '../recognition/pitch.js';
import { trackFormants } from '../recognition/formants.js';
import { inverseFilter } from '../recognition/inverse-filter.js';
import { HEAD_PARAMETERS, DEFAULT_HEAD } from '../head-config.js';
import { prepareLegacyVoice } from './voice-features.js';
import { transcriptSpeechRate } from './voice-fit-rate.js';
import {
  PITCH_RANGE_FACTOR,
  BREATHINESS_CPP,
  DEFAULT_SYLLABLE_RATE,
} from './voice-fit-calibration.js';

export const HISTOGRAMS = Object.freeze({
  f0: [0, 192, 1], // indices are quarter semitones above 50 Hz
  dF: [600, 2000, 5],
  rd: [0, 3, 0.05],
  hnr: [-40, 60, 0.5],
  cpp: [-10, 30, 0.01], // the breathiness table spans 0.6 to 4.9 dB
  h1h2Source: [-60, 80, 0.5],
  h1h2: [-60, 80, 0.5],
  f1: [0, 2000, 5],
  f2: [0, 4000, 5],
  f3: [0, 6000, 5],
  f4: [0, 8000, 5],
});
export function emptyState() {
  return {
    version: 1,
    histograms: Object.fromEntries(
      Object.entries(HISTOGRAMS).map(([k, [a, b, d]]) => [
        k,
        Array(Math.round((b - a) / d) + 1).fill(0),
      ])
    ),
    duration: 0,
    voicedSeconds: 0,
    speechSeconds: 0,
    nuclei: 0,
    voicedFrames: 0,
    mel: Array(24).fill(0),
    tilt: 0,
    diagnostics: { hnr: 0, h1h2: 0, frames: 0 },
    perturbation: {
      periods: 0,
      period: 0,
      amplitude: 0,
      pairs: 0,
      periodDiff: 0,
      amplitudeDiff: 0,
    },
  };
}
export function copyState(state) {
  if (!state) {
    return emptyState();
  }
  const copy = JSON.parse(JSON.stringify(state));
  const expected = emptyState();
  if (
    copy.version !== 1 ||
    Object.entries(expected.histograms).some(
      ([key, bins]) =>
        copy.histograms?.[key]?.length !== bins.length ||
        copy.histograms[key].some((n) => !Number.isFinite(n) || n < 0)
    ) ||
    Object.keys(expected)
      .filter((key) => typeof expected[key] === 'number' && key !== 'tilt')
      .some((key) => !Number.isFinite(copy[key]) || copy[key] < 0) ||
    copy.mel?.length !== 24 ||
    copy.mel.some((v) => !Number.isFinite(v)) ||
    !Number.isFinite(copy.tilt) ||
    !['hnr', 'h1h2', 'frames'].every((key) =>
      Number.isFinite(copy.diagnostics?.[key])
    ) ||
    copy.diagnostics.frames < 0 ||
    Object.keys(expected.perturbation).some(
      (key) =>
        !Number.isFinite(copy.perturbation?.[key]) || copy.perturbation[key] < 0
    )
  ) {
    throw new RangeError('Invalid voice fitter state');
  }
  return Object.fromEntries(
    Object.keys(expected).map((key) => [
      key,
      key === 'histograms'
        ? Object.fromEntries(
            Object.keys(HISTOGRAMS).map((k) => [k, copy.histograms[k]])
          )
        : key === 'diagnostics' || key === 'perturbation'
          ? Object.fromEntries(
              Object.keys(expected[key]).map((k) => [k, copy[key][k]])
            )
          : copy[key],
    ])
  );
}
export function addValue(state, key, value) {
  if (!Number.isFinite(value) || (key === 'f0' && value <= 0)) {
    return;
  }
  const [min, max, step] = HISTOGRAMS[key];
  const x = key === 'f0' ? 48 * Math.log2(value / 50) : value;
  const index = Math.round((Math.max(min, Math.min(max, x)) - min) / step);
  state.histograms[key][index]++;
}
function binValue(key, i) {
  const [a, , d] = HISTOGRAMS[key];
  return key === 'f0' ? 50 * 2 ** (i / 48) : a + i * d;
}
export function histogramCount(state, key) {
  return state.histograms[key].reduce((a, b) => a + b, 0);
}
export function quantile(state, key, p = 0.5) {
  const bins = state.histograms[key];
  const count = histogramCount(state, key);
  if (!count) {
    return 0;
  }
  const at = p * (count - 1);
  let sum = 0,
    lo = null;
  for (let i = 0; i < bins.length; i++) {
    sum += bins[i];
    if (lo === null && sum > Math.floor(at)) {
      lo = binValue(key, i);
    }
    if (sum > Math.ceil(at)) {
      return lo + (binValue(key, i) - lo) * (at - Math.floor(at));
    }
  }
  return binValue(key, bins.length - 1);
}
export function medianSd(state, key) {
  const centre = quantile(state, key),
    count = histogramCount(state, key);
  if (!count) {
    return 0;
  }
  const values = state.histograms[key]
    .map((n, i) => [Math.abs(binValue(key, i) - centre), n])
    .sort((a, b) => a[0] - b[0]);
  const at = (count - 1) / 2;
  let sum = 0,
    lo = null,
    mad = 0;
  for (const [d, n] of values) {
    sum += n;
    if (lo === null && sum > Math.floor(at)) {
      lo = d;
    }
    if (sum > Math.ceil(at)) {
      mad = lo + (d - lo) * (at - Math.floor(at));
      break;
    }
  }
  // Half a bin is the quantisation floor, including a perfectly steady tone.
  const width =
    key === 'f0' ? centre * (2 ** (1 / 48) - 1) : HISTOGRAMS[key][2];
  return (1.4826 * Math.max(mad, width / 2)) / Math.sqrt(count / 20);
}
function collectFrames(state, frames, pitch, formants, source, formantCount) {
  for (let t = 0; t < frames.count; t++) {
    if (!(pitch.f0[t] > 0)) {
      continue;
    }
    state.voicedFrames++;
    state.voicedSeconds += frames.hop;
    addValue(state, 'f0', pitch.f0[t]);
    state.tilt += frames.tilt[t];
    for (let k = 0; k < 24; k++) {
      state.mel[k] += frames.mel[t * 24 + k];
    }
    for (let k = 0; k < Math.min(4, formantCount); k++) {
      if (formants.valid[t * 4 + k]) {
        addValue(state, `f${k + 1}`, formants.frequency[t * 4 + k]);
      }
    }
    if (
      formantCount >= 3 &&
      !formants.nasal[t] &&
      [0, 1, 2].every((k) => formants.valid[t * 4 + k])
    ) {
      const spacing =
        [0, 1, 2].reduce(
          (sum, k) => sum + formants.frequency[t * 4 + k] * (k + 0.5),
          0
        ) / 8.75;
      addValue(state, 'dF', spacing);
    }
    if (source.reliable[t]) {
      for (const key of ['rd', 'hnr', 'cpp', 'h1h2Source', 'h1h2']) {
        addValue(state, key, source[key][t]);
      }
    }
  }
}
function collectDiagnostics(state, legacy) {
  const weight = legacy.voicedDuration / 0.01;
  state.diagnostics.frames += weight;
  for (const key of ['hnr', 'h1h2']) {
    state.diagnostics[key] += legacy[key] * weight;
  }
}
export function accumulate(
  state,
  samples,
  sampleRate,
  options = {},
  diagnostics = true,
  captureDiagnostics = null
) {
  const maxSeconds = options.maxDuration ?? 30;
  const input = Float32Array.from(
    samples.length > maxSeconds * sampleRate
      ? Array.prototype.slice.call(
          samples,
          0,
          Math.floor(maxSeconds * sampleRate)
        )
      : samples
  );
  const frames = analyzeFrames(input, sampleRate, {
    maxSeconds,
    order: options.order,
    rate: options.analysisRate,
  });
  const pitch = trackPitch(frames);
  // Use the tracker's initial tract prior for every stretch. Re-estimating
  // that prior from a whole utterance makes the pooled dF depend on splits.
  const formants = trackFormants(frames, { pitch, vocalTractLength: 16.5 });
  const source = inverseFilter(frames, { pitch, trace: options.trace ?? null });
  const analysis = prepareLegacyVoice(input, sampleRate, {
    ...options,
    diagnosticsOnly: true,
  });
  const legacy = diagnostics ? analysis.complete() : analysis.rateFeatures;
  captureDiagnostics?.(analysis.complete);
  state.duration += input.length / sampleRate;
  // A 40 ms sliding window represents its 10 ms hop plus 30 ms at
  // the stretch edges. Include that coverage when pooling stretches.
  const speech =
    legacy.activeDuration > 0
      ? Math.min(input.length / sampleRate, legacy.activeDuration + 0.03)
      : 0;
  state.speechSeconds += speech;
  if (diagnostics) {
    collectDiagnostics(state, legacy);
  }
  state.nuclei += Math.round(legacy.syllableRate * legacy.activeDuration);
  collectFrames(
    state,
    frames,
    pitch,
    formants,
    source,
    options.formantCount ?? Math.min(4, Math.floor((0.45 * frames.rate) / 1000))
  );
  if (pitch.perturbation) {
    for (const key of Object.keys(state.perturbation)) {
      state.perturbation[key] += pitch.perturbation[key];
    }
  }
  options.trace?.({
    stage: 'voice-fit-statistics',
    voicedFrames: state.voicedFrames,
    duration: state.duration,
  });
  return state;
}
export function stateFeatures(state) {
  const f0 = quantile(state, 'f0'),
    f0Low = quantile(state, 'f0', 0.05),
    f0High = quantile(state, 'f0', 0.95);
  const spacing = quantile(state, 'dF');
  return {
    duration: state.duration,
    activeDuration: state.speechSeconds,
    voicedDuration: state.voicedSeconds,
    f0,
    f0Low,
    f0High,
    f0Range: f0Low > 0 ? 12 * Math.log2(f0High / f0Low) : 0,
    formants: [1, 2, 3, 4].map((k) => quantile(state, `f${k}`)),
    formantSpacing: spacing,
    vocalTractLength: spacing > 0 ? 17500 / spacing : 0,
    h1h2: state.diagnostics.h1h2 / Math.max(1, state.diagnostics.frames),
    hnr: state.diagnostics.hnr / Math.max(1, state.diagnostics.frames),
    rd: quantile(state, 'rd'),
    cpp: quantile(state, 'cpp'),
    h1h2Source: quantile(state, 'h1h2Source'),
    syllableRate:
      state.speechSeconds > 0 ? state.nuclei / state.speechSeconds : 0,
  };
}
export function tableInverse(value, table) {
  let best = { residual: Infinity, value: 0 };
  for (let i = 1; i < table.length; i++) {
    const [a, x] = table[i - 1],
      [b, y] = table[i];
    const t = Math.max(0, Math.min(1, (value - x) / (y - x)));
    const residual = Math.abs(value - (x + (y - x) * t));
    if (residual < best.residual) {
      best = { residual, value: a + (b - a) * t };
    }
  }
  return best.value;
}
/**
 * Breathiness from the median CPP at the median pitch: the default-head
 * CPP row at that pitch (interpolated in log pitch, clamped to the table)
 * is inverted. Returns the value and the CPP change per unit breathiness.
 */
export function cppBreathiness(cpp, f0, table = BREATHINESS_CPP) {
  const x = Math.log(
    Math.max(table.pitch[0], Math.min(table.pitch.at(-1), f0))
  );
  let i = 1;
  while (i < table.pitch.length - 1 && x > Math.log(table.pitch[i])) {
    i++;
  }
  const t =
    (x - Math.log(table.pitch[i - 1])) /
    (Math.log(table.pitch[i]) - Math.log(table.pitch[i - 1]));
  const row = table.breathiness.map((b, k) => [
    b,
    table.cpp[i - 1][k] + (table.cpp[i][k] - table.cpp[i - 1][k]) * t,
  ]);
  const value = tableInverse(cpp, row);
  const k = Math.max(
    1,
    Math.min(row.length - 1, Math.ceil(value / table.breathiness[1]))
  );
  const slope = Math.abs(
    (row[k][1] - row[k - 1][1]) / (row[k][0] - row[k - 1][0])
  );
  return { value, slope };
}
// Relative sd of the speaking-time rate: calibration residuals reach 3 %,
// and a female head speaks the same plan up to 5 % faster
// (experiments/issue-63/speech-time-calibrate.txt, rate-counters.txt).
const SPEECH_TIME_SD = 0.04;
export function statisticsResult(state, options = {}) {
  if (state.voicedFrames < 20) {
    throw new Error('No voiced speech found in the recording');
  }
  const features = stateFeatures(state),
    head = { ...DEFAULT_HEAD };
  const parameters = Object.fromEntries(
    HEAD_PARAMETERS.map((p) => [
      p.key,
      { value: p.default, sd: 0, source: 'default', frames: 0 },
    ])
  );
  const parts = options.parts ?? ['tract', 'pitch', 'source', 'rate'];
  const fit = (part, key, value, sd, frames) => {
    if (!parts.includes(part) || !frames || !Number.isFinite(value)) {
      return;
    }
    const p = HEAD_PARAMETERS.find((p) => p.key === key);
    head[key] = Math.max(p.min, Math.min(p.max, value));
    parameters[key] = {
      value: head[key],
      sd: Math.max(sd, Number.EPSILON),
      source: 'statistics',
      frames,
    };
  };
  const count = (key) => histogramCount(state, key),
    sd = (key) => medianSd(state, key);
  fit(
    'tract',
    'vocalTractLength',
    features.vocalTractLength,
    (17500 * sd('dF')) / features.formantSpacing ** 2,
    count('dF')
  );
  fit('pitch', 'pitch', features.f0, sd('f0'), count('f0'));
  fit(
    'pitch',
    'pitchRange',
    features.f0Range * PITCH_RANGE_FACTOR,
    (((sd('f0') / features.f0) * 12) / Math.LN2) * PITCH_RANGE_FACTOR,
    count('f0')
  );
  fit('source', 'tenseness', 1 - features.rd / 3, sd('rd') / 3, count('rd'));
  const breathiness = cppBreathiness(quantile(state, 'cpp'), features.f0);
  fit(
    'source',
    'breathiness',
    breathiness.value,
    Math.min(1, sd('cpp') / Math.max(0.1, breathiness.slope)),
    count('cpp')
  );
  const p = state.perturbation;
  if (p.periods >= 20 && p.pairs > 0) {
    const jitter = (100 * p.periodDiff) / p.pairs / (p.period / p.periods);
    const shimmer =
      p.amplitude > 0
        ? (100 * p.amplitudeDiff) / p.pairs / (p.amplitude / p.periods)
        : 0;
    for (const [key, value] of [
      ['jitter', jitter],
      ['shimmer', shimmer],
    ]) {
      fit(
        'source',
        key,
        jitterToHead(value),
        Math.max(0.01, value / Math.sqrt(p.periods / 20)),
        p.periods
      );
    }
  }
  // With a transcript the recording says the planned syllables, so the
  // speaking time, steady within 3 % across texts and rates, replaces the
  // syllable count, which scatters by 10 to 35 % across heads
  // (experiments/issue-63/rate-counters.txt, speech-time-calibrate.txt).
  const timed = options.transcript
    ? transcriptSpeechRate(state.speechSeconds, options.transcript, options)
    : null;
  if (timed !== null) {
    fit(
      'rate',
      'speechRate',
      timed,
      timed * SPEECH_TIME_SD,
      Math.round(state.speechSeconds * 100)
    );
    return { head, parameters, features };
  }
  fit(
    'rate',
    'speechRate',
    features.syllableRate / DEFAULT_SYLLABLE_RATE,
    Math.max(
      0.01,
      features.syllableRate /
        DEFAULT_SYLLABLE_RATE /
        Math.sqrt(Math.max(1, state.nuclei))
    ),
    state.nuclei
  );
  return { head, parameters, features };
}
