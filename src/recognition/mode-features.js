/** Vowel-frame features for mode recognition. Unlicense. */
import { measure } from './profile.js';
import { analyzeFrames } from './frontend.js';
import { trackPitchFrames } from './pitch.js';
import { trackFirstFormant } from './formants.js';
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

let quantileScratch = new Float64Array(64);

export function quantile(values, fraction = 0.5, rows) {
  const length = rows?.length ?? values.length;
  if (length === 0) {
    return 0;
  }
  if (length === 1) {
    const value = values[rows ? rows[0] : 0];
    return Number.isFinite(value) ? value + 0 : 0;
  }
  const sorted =
    quantileScratch.length >= length
      ? quantileScratch
      : new Float64Array(length);
  if (sorted.length <= 4096) {
    quantileScratch = sorted;
  }
  let size = 0;
  for (let i = 0; i < length; i++) {
    const value = values[rows ? rows[i] : i];
    if (Number.isFinite(value)) {
      sorted[size++] = value;
    }
  }
  if (size === 0) {
    return 0;
  }
  sorted.subarray(0, size).sort();
  const position = (size - 1) * fraction;
  const low = Math.floor(position);
  return (
    sorted[low] + (sorted[Math.ceil(position)] - sorted[low]) * (position - low)
  );
}
const mean = (values) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

function timedNuclei(word, phones, vowelByIpa) {
  const vowels = [];
  for (let i = 0; i < phones.length; i++) {
    if (!(i in phones)) {
      continue;
    }
    const { start, end } = phones[i];
    if (!(start >= word.start && end <= word.end)) {
      continue;
    }
    const vowel = phones[i].ipa ?? phones[i].symbol ?? '';
    let isNucleus = vowelByIpa.get(vowel);
    if (isNucleus === undefined) {
      isNucleus = parseIpa(vowel).tokens.some(
        (token) => token.kind === 'vowel' || token.syllabic
      );
      vowelByIpa.set(vowel, isNucleus);
    }
    if (isNucleus) {
      vowels.push({ start, end, vowel });
    }
  }
  return vowels;
}

/** Locate nuclei using timed phones when available, else fit each IPA word
 * to its observed word interval. No synthesis modes/timeline metadata read. */
function plannedNuclei(word, head, planners) {
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
  const pitch =
    options.pitch ??
    measure(profile, 'Pitch', () =>
      trackPitchFrames(frames, { minF0: 35, maxF0: 800, kernels })
    );
  const formantOptions = {
    pitch,
    ...(head ? { vocalTractLength: head.vocalTractLength } : {}),
  };
  const formants = options.skipFormants
    ? null
    : measure(profile, 'Formants', () =>
        trackFirstFormant(
          frames,
          formantOptions,
          options.reuseFormantCandidates
        )
      );
  return { frames, pitch, formants };
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

function vowelFrames(vowels, { hop, count }, seen, uniqueRows) {
  return vowels.map(({ start, end }) => {
    const margin = (end - start) * 0.25;
    const rows = [];
    for (
      let t = Math.max(0, Math.ceil((start + margin) / hop));
      t < count && t * hop <= end - margin;
      t++
    ) {
      rows.push(t);
      if (!seen[t]) {
        seen[t] = 1;
        uniqueRows.push(t);
      }
    }
    return rows;
  });
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
  const { frames, pitch, formants } = analyzeWordSignal(
    samples,
    sampleRate,
    head,
    analyzed,
    options
  );
  const pulses = measure(options.profile, 'Glottal periods', () =>
    pulseTrains(samples, sampleRate)
  );
  const phones = result.phonemes ?? result.phones;
  const vowelByIpa = new Map();
  const planners = new Map();
  const seen = new Uint8Array(frames.count);
  const uniqueRows = [];
  const wordVowels = result.words.map((word) => {
    const vowels = phones
      ? timedNuclei(word, phones, vowelByIpa)
      : plannedNuclei(word, head, planners);
    return { vowels, rows: vowelFrames(vowels, frames, seen, uniqueRows) };
  });
  const source = measure(options.profile, 'Inverse filter', () =>
    inverseModeMeasures(
      frames,
      {
        pitch,
        minF0: 35,
        maxF0: 800,
        kernels: options.kernels,
        ...(options.sourceStep !== undefined && { step: options.sourceStep }),
      },
      uniqueRows
    )
  );
  const spectrum = createAverageSpectrumWorkspace(sampleRate);
  let vowelBuffer = new Float32Array(0);
  const peakLevel = quantile(frames.energy.subarray(0, frames.count), 0.9);
  const measured = result.words.map((word, index) => {
    const { vowels, rows: byVowel } = wordVowels[index];
    const rows = [];
    const f1Vowels = [];
    for (let i = 0; i < vowels.length; i++) {
      const frequencies = [];
      for (const t of byVowel[i]) {
        rows.push(t);
        if (formants?.valid[t]) {
          frequencies.push(formants.frequency[t]);
        }
      }
      if (formants) {
        f1Vowels.push({
          vowel: vowels[i].vowel,
          value: quantile(frequencies),
        });
      }
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
    const hnr = quantile(source.hnr, 0.5, rows);
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
      level: quantile(frames.energy, 0.5, rows),
      peakLevel,
      h1h2: quantile(source.h1h2Source, 0.5, rows),
      hnr,
      cpp: quantile(source.cpp, 0.5, rows),
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

const SUMMARY_KEYS = [
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

export function summarize(words) {
  const vowels = words.filter((w) => w.vowels > 0);
  const values = new Array(vowels.length);
  const summary = {};
  for (const key of SUMMARY_KEYS) {
    for (let i = 0; i < vowels.length; i++) {
      values[i] = vowels[i][key];
    }
    summary[key] = quantile(values);
  }
  return summary;
}

/** Phrase range includes between-word intonation as well as vowel variation. */
export function phrasePitchSpan(words) {
  const pitches = words.flatMap((word) => word.pitches);
  return semitones(quantile(pitches, 0.95), quantile(pitches, 0.05));
}

/** Phrase range includes between-word intonation, not just vowel variation. */
export function phraseSummary(words, context, baseline) {
  return {
    ...summarize(words),
    pitchSpan:
      phrasePitchSpan(words) -
      (context ? phrasePitchSpan(context) - baseline.pitchSpan : 0),
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
        let entry = grouped.get(vowel);
        if (!entry) {
          entry = { total: 0, count: 0 };
          grouped.set(vowel, entry);
        }
        entry.total += value;
        entry.count++;
      }
    }
  }
  const references = new Map();
  for (const [vowel, { total, count }] of grouped) {
    references.set(vowel, total / count);
  }
  return references;
}
export function relativeF1(word, references) {
  const values = word.f1Vowels
    .filter(({ vowel, value }) => value > 0 && references.has(vowel))
    .map(({ vowel, value }) => value - references.get(vowel));
  return values.length ? mean(values) : null;
}
