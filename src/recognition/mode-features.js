/** Vowel-frame features for mode recognition. Unlicense. */
import { analyzeFrames } from './frontend.js';
import { trackPitch } from './pitch.js';
import { trackFormants } from './formants.js';
import { inverseFilter } from './inverse-filter.js';
import {
  alphaRatio,
  energyRatio,
  glottalPeriods,
  MAX_PERIOD_FACTOR,
} from '../analysis/mode-features.js';
import { parseIpa } from '../ipa/parse.js';
import { planUtterance } from '../articulation/plan.js';
import { semitones } from './mode-rules.js';

export function quantile(values, fraction = 0.5) {
  const sorted = Array.from(values)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
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
function nuclei(word, phones, head) {
  if (phones) {
    return phones
      .filter(
        (p) =>
          p.start >= word.start &&
          p.end <= word.end &&
          parseIpa(p.ipa ?? p.symbol ?? '').tokens.some(
            (t) => t.kind === 'vowel'
          )
      )
      .map((p) => ({ ...p, vowel: p.ipa ?? p.symbol }));
  }
  const plan = planUtterance(word.ipa, {
    head,
    language: word.language ?? word.lang,
  });
  const speech = plan.segments.filter((s) => s.kind !== 'pause');
  if (!speech.length) {
    return [];
  }
  const start = speech[0].start;
  const scale = (word.end - word.start) / (speech.at(-1).end - start);
  return speech
    .filter((s) => s.kind === 'vowel')
    .map((s) => ({
      start: word.start + (s.start - start) * scale,
      end: word.start + (s.end - start) * scale,
      vowel: s.token.symbol,
    }));
}

/** Analyze the recording in one pass; retain scalar word features only. */
export function measureWords(samples, sampleRate, result, head) {
  const words = result.words;
  const seconds = samples.length / sampleRate;
  const frames = analyzeFrames(samples, sampleRate, {
    hop: 0.01,
    maxSeconds: Math.max(0.1, seconds + 0.05),
  });
  const pitch = trackPitch(frames, { minF0: 35, maxF0: 800 });
  const formants = trackFormants(frames, {
    pitch,
    ...(head ? { vocalTractLength: head.vocalTractLength } : {}),
  });
  const source = inverseFilter(frames, { pitch, minF0: 35, maxF0: 800 });
  const pulses = glottalPeriods(samples, sampleRate);
  const phones = result.phonemes ?? result.phones;
  const peakLevel = quantile(frames.energy.subarray(0, frames.count), 0.9);
  // Vowel extraction combines independent source, formant and pulse validity checks.
  // eslint-disable-next-line complexity
  const measured = words.map((word) => {
    const vowels = nuclei(word, phones, head);
    const whole = [];
    for (
      let t = Math.ceil(word.start / frames.hop);
      t < frames.count && t * frames.hop < word.end;
      t++
    ) {
      whole.push(t);
    }
    const rows = [];
    const f1Vowels = [];
    for (const vowel of vowels) {
      const from = vowel.start + (vowel.end - vowel.start) * 0.25;
      const to = vowel.end - (vowel.end - vowel.start) * 0.25;
      const indices = [];
      for (
        let t = Math.max(0, Math.ceil(from / frames.hop));
        t < frames.count && t * frames.hop <= to;
        t++
      ) {
        indices.push(t);
      }
      rows.push(...indices);
      f1Vowels.push({
        vowel: vowel.vowel,
        value: quantile(
          indices
            .filter((t) => formants.valid[t * 4])
            .map((t) => formants.frequency[t * 4])
        ),
      });
    }
    const rawF0 = rows.map((t) => pitch.f0[t]).filter((v) => v > 0);
    const f0 = rows
      .filter((t) => pitch.strength[t] >= 0.7)
      .map((t) => pitch.f0[t])
      .filter((v) => v > 0);
    // Source H1-H2 removes the formant envelope, unlike raw speech H1-H2.
    const values = (key) =>
      rows.map((t) => source[key][t]).filter(Number.isFinite);
    const periods = [];
    let difference = 0,
      pairs = 0;
    for (const train of pulses) {
      let time = train.start;
      let previous = null;
      for (const period of train.periods) {
        const vowel = vowels.find(
          (v) => time >= v.start && time + period <= v.end
        );
        if (vowel) {
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
          previous = null;
        }
        time += period;
      }
    }
    const pulsePitch = periods.length ? 1 / quantile(periods) : 0;
    const trackedPitch = quantile(
      f0.length ? f0 : values('hnr').some((v) => v > 3) ? rawF0 : []
    );
    const vowelSignal = Float32Array.from(
      vowels.flatMap((v) =>
        Array.from(
          samples.subarray(
            Math.round((v.start + (v.end - v.start) * 0.25) * sampleRate),
            Math.round((v.end - (v.end - v.start) * 0.25) * sampleRate)
          )
        )
      )
    );
    return {
      start: word.start,
      end: word.end,
      vowels: vowels.length,
      f1Vowels,
      f1: null,
      alpha: alphaRatio(vowelSignal, sampleRate),
      energyRatio: energyRatio(vowelSignal, sampleRate),
      pitch: pulsePitch > 0 && pulsePitch < 90 ? pulsePitch : trackedPitch,
      pitchSpan: semitones(quantile(f0, 0.95), quantile(f0, 0.05)),
      voiced: rows.length ? f0.length / rows.length : 0,
      wordVoiced: whole.length
        ? whole.filter((t) => pitch.f0[t] > 0 && pitch.strength[t] >= 0.7)
            .length / whole.length
        : 0,
      level: quantile(rows.map((t) => frames.energy[t])),
      peakLevel,
      h1h2: quantile(values('h1h2Source')),
      hnr: quantile(values('hnr')),
      cpp: quantile(values('cpp')),
      jitter: pairs ? (100 * difference) / pairs / mean(periods) : 0,
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
