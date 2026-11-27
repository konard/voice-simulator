/** Vowel-frame features for mode recognition. Unlicense. */
import { measure } from './profile.js';
import { analyzeFrames } from './frontend.js';
import { trackPitchFrames } from './pitch.js';
import { trackBatchFormants, trackFormants } from './formants.js';
import { inverseModeMeasures } from './inverse-filter.js';
import {
  createAverageSpectrumWorkspace,
  glottalPeriods,
  MAX_PERIOD_FACTOR,
  vowelBandRatios,
} from '../analysis/mode-features.js';
import { parseIpa } from '../ipa/parse.js';
import { createUtteranceTimingPlanner } from '../articulation/plan.js';
import { semitones } from './mode-rules.js';

export function quantile(values, fraction = 0.5) {
  const sorted = [];
  for (const value of values) {
    if (Number.isFinite(value)) {
      sorted.push(value);
    }
  }
  sorted.sort((a, b) => a - b);
  if (!sorted.length) {
    return 0;
  }
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position);
  return (
    sorted[low] + (sorted[Math.ceil(position)] - sorted[low]) * (position - low)
  );
}
const mean = (values) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

/** Locate nuclei using timed phones when available, else fit each IPA word
 * to its observed word interval. No synthesis modes/timeline metadata read. */
function nuclei(word, phones, head, planners) {
  if (phones) {
    return phones
      .filter(
        (p) =>
          p.start >= word.start &&
          p.end <= word.end &&
          parseIpa(p.ipa ?? p.symbol ?? '').tokens.some(
            (t) => t.kind === 'vowel' || t.syllabic
          )
      )
      .map((p) => ({ ...p, vowel: p.ipa ?? p.symbol }));
  }
  const language = word.language ?? word.lang;
  let plan = planners.get(language);
  if (!plan) {
    plan = createUtteranceTimingPlanner({ head, language });
    planners.set(language, plan);
  }
  const segments = plan(word.ipa);
  const speech = segments.filter((s) => s.kind !== 'pause');
  if (!speech.length) {
    return [];
  }
  const start = speech[0].start;
  const scale = (word.end - word.start) / (speech.at(-1).end - start);
  return speech
    .filter((s) => s.kind === 'vowel' || s.token?.syllabic)
    .map((s) => ({
      start: word.start + (s.start - start) * scale,
      end: word.start + (s.end - start) * scale,
      vowel: s.token.symbol,
    }));
}

function vowelSamples(samples, vowels, rate, signal) {
  const intervals = vowels.map((v) =>
    samples.subarray(
      Math.round((v.start + (v.end - v.start) * 0.25) * rate),
      Math.round((v.end - (v.end - v.start) * 0.25) * rate)
    )
  );
  const length = intervals.reduce((n, part) => n + part.length, 0);
  if (signal.length < length) {
    signal = new Float32Array(length);
  }
  let offset = 0;
  for (const interval of intervals) {
    signal.set(interval, offset);
    offset += interval.length;
  }
  return { signal, length };
}

function analyzeWordSignal(samples, sampleRate, head, analyzed, options) {
  const { profile, kernels } = options;
  const seconds = samples.length / sampleRate;
  const frames =
    analyzed ??
    measure(profile, 'Front end', () =>
      analyzeFrames(samples, sampleRate, {
        hop: 0.01,
        maxSeconds: Math.max(0.1, seconds + 0.05),
      })
    );
  const pitch = measure(profile, 'Pitch', () =>
    trackPitchFrames(frames, { minF0: 35, maxF0: 800, kernels })
  );
  const formantOptions = {
    pitch,
    ...(head ? { vocalTractLength: head.vocalTractLength } : {}),
  };
  const formants = measure(profile, 'Formants', () =>
    options.reuseFormantCandidates
      ? trackBatchFormants(
          frames,
          formantOptions,
          options.reuseFormantCandidates === 'growing'
        )
      : trackFormants(frames, formantOptions)
  );
  const source = measure(profile, 'Inverse filter', () =>
    inverseModeMeasures(frames, { pitch, minF0: 35, maxF0: 800, kernels })
  );
  return { frames, pitch, formants, source };
}

function pulseTrains(samples, sampleRate) {
  return glottalPeriods(samples, sampleRate).map(({ start, periods }) => ({
    start,
    end: periods.reduce((time, period) => time + period, start),
    periods,
  }));
}

function insideNucleus(vowels, start, end) {
  for (const vowel of vowels) {
    if (start >= vowel.start && end <= vowel.end) {
      return true;
    }
  }
  return false;
}

function pulseFeatures(trains, vowels) {
  let start = Infinity;
  let end = -Infinity;
  for (const vowel of vowels) {
    start = Math.min(start, vowel.start);
    end = Math.max(end, vowel.end);
  }
  const periods = [];
  let difference = 0;
  let pairs = 0;
  for (const train of trains) {
    if (train.end <= start || train.start >= end) {
      continue;
    }
    let time = train.start;
    let previous = 0;
    for (let i = 0; i < train.periods.length && time < end; i++) {
      const period = train.periods[i];
      const next = time + period;
      if (insideNucleus(vowels, time, next)) {
        periods.push(period);
        if (
          previous &&
          period / previous <= MAX_PERIOD_FACTOR &&
          previous / period <= MAX_PERIOD_FACTOR
        ) {
          difference += Math.abs(period - previous);
          pairs++;
        }
        previous = period;
      } else {
        previous = 0;
      }
      time = next;
    }
  }
  return {
    pulsePitch: periods.length ? 1 / quantile(periods) : 0,
    jitter: pairs ? (100 * difference) / pairs / mean(periods) : 0,
  };
}

function wordVoicing(word, frames, pitch) {
  let count = 0;
  let voiced = 0;
  for (
    let t = Math.ceil(word.start / frames.hop);
    t < frames.count && t * frames.hop < word.end;
    t++
  ) {
    count++;
    if (pitch.f0[t] > 0 && pitch.strength[t] >= 0.7) {
      voiced++;
    }
  }
  return count ? voiced / count : 0;
}

/** Analyze the recording in one pass; retain scalar word features only. */
export function measureWords(
  samples,
  sampleRate,
  result,
  head,
  analyzed,
  options = {}
) {
  const { frames, pitch, formants, source } = analyzeWordSignal(
    samples,
    sampleRate,
    head,
    analyzed,
    options
  );
  const pulses = pulseTrains(samples, sampleRate);
  const phones = result.phonemes ?? result.phones;
  const planners = new Map();
  const spectrum = createAverageSpectrumWorkspace(sampleRate);
  let vowelBuffer = new Float32Array(0);
  const peakLevel = quantile(frames.energy.subarray(0, frames.count), 0.9);
  const measured = result.words.map((word) => {
    const vowels = nuclei(word, phones, head, planners);
    const rows = [];
    const f1Vowels = [];
    for (const vowel of vowels) {
      const from = vowel.start + (vowel.end - vowel.start) * 0.25;
      const to = vowel.end - (vowel.end - vowel.start) * 0.25;
      const frequencies = [];
      for (
        let t = Math.max(0, Math.ceil(from / frames.hop));
        t < frames.count && t * frames.hop <= to;
        t++
      ) {
        rows.push(t);
        if (formants.valid[t * 4]) {
          frequencies.push(formants.frequency[t * 4]);
        }
      }
      f1Vowels.push({
        vowel: vowel.vowel,
        value: quantile(frequencies),
      });
    }
    const rawF0 = [];
    const f0 = [];
    for (const t of rows) {
      const value = pitch.f0[t];
      if (value > 0) {
        rawF0.push(value);
        if (pitch.strength[t] >= 0.7) {
          f0.push(value);
        }
      }
    }
    // Source H1-H2 removes the formant envelope, unlike raw speech H1-H2.
    const values = (key) => rows.map((t) => source[key][t]);
    const hnr = quantile(values('hnr'));
    const { pulsePitch, jitter } = pulseFeatures(pulses, vowels);
    // A weak periodicity peak in noise is not a usable pitch. Require
    // harmonic support across the nucleus before falling back to it.
    const trackedPitch = quantile(f0.length ? f0 : hnr > 10 ? rawF0 : []);
    const { signal, length } = vowelSamples(
      samples,
      vowels,
      sampleRate,
      vowelBuffer
    );
    vowelBuffer = signal;
    return {
      start: word.start,
      end: word.end,
      vowels: vowels.length,
      f1Vowels,
      f1: null,
      ...vowelBandRatios(signal.subarray(0, length), sampleRate, spectrum),
      pitch: pulsePitch > 0 && pulsePitch < 90 ? pulsePitch : trackedPitch,
      pitches: f0,
      pitchSpan: semitones(quantile(f0, 0.95), quantile(f0, 0.05)),
      voiced: rows.length ? f0.length / rows.length : 0,
      wordVoiced: wordVoicing(word, frames, pitch),
      level: quantile(rows.map((t) => frames.energy[t])),
      peakLevel,
      h1h2: quantile(values('h1h2Source')),
      hnr,
      cpp: quantile(values('cpp')),
      jitter,
      rate: 0,
    };
  });
  measured.forEach((word, i) => {
    const near = measured.slice(Math.max(0, i - 1), i + 2);
    word.rate =
      near.reduce((n, w) => n + w.vowels, 0) /
      Math.max(0.01, near.at(-1).end - near[0].start);
  });
  return measured;
}

export function summarize(words) {
  const keys = [
    'alpha',
    'energyRatio',
    'pitch',
    'pitchSpan',
    'voiced',
    'h1h2',
    'hnr',
    'cpp',
    'jitter',
    'rate',
  ];
  return Object.fromEntries(
    keys.map((key) => [
      key,
      quantile(words.filter((w) => w.vowels > 0).map((w) => w[key])),
    ])
  );
}

/** Phrase range includes between-word intonation, not just vowel variation. */
export function phraseSummary(words, context, baseline) {
  const range = (rows) => {
    const pitches = rows.flatMap((word) => word.pitches);
    return semitones(quantile(pitches, 0.95), quantile(pitches, 0.05));
  };
  return {
    ...summarize(words),
    pitchSpan:
      range(words) - (context ? range(context) - baseline.pitchSpan : 0),
    f1: words.some((w) => w.f1 !== null)
      ? mean(words.map((w) => w.f1 ?? 0))
      : null,
  };
}

export function vowelReferences(words) {
  const grouped = new Map();
  for (const word of words) {
    for (const { vowel, value } of word.f1Vowels) {
      if (value > 0) {
        grouped.set(vowel, [...(grouped.get(vowel) ?? []), value]);
      }
    }
  }
  return new Map([...grouped].map(([vowel, values]) => [vowel, mean(values)]));
}
export function relativeF1(word, references) {
  const values = word.f1Vowels
    .filter(({ vowel, value }) => value > 0 && references.has(vowel))
    .map(({ vowel, value }) => value - references.get(vowel));
  return values.length ? mean(values) : null;
}
