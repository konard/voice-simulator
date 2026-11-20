/** Whisper detection and pitch-independent Mandarin tone cues. Unlicense. */
import { energyRatio } from '../analysis/mode-features.js';
import { toneCurve } from '../articulation/tone-model.js';

const EPSILON = 1e-9;
const clamp = (value) => Math.max(0, Math.min(1, value));
// Minimal-tier medians: voiced -26.03 dB, whispered -15.62 dB.
// node experiments/issue-72-whisper-detection.mjs
const RATIO_THRESHOLD = -20.82;
// The same utterances at 8 kHz: voiced -32.29 dB, whispered -20.98 dB.
const TELEPHONE_THRESHOLD = -26.63;

export function whisperSpeechRuns(frames, count = frames.count) {
  const runs = [];
  const { speech, hop, startTime } = frames;
  const maxEnd = startTime + frames.sampleCount / frames.rate;
  for (let i = 0; i < count; ) {
    if (!speech[i]) {
      i++;
      continue;
    }
    const from = i++;
    while (i < count && speech[i]) {
      i++;
    }
    const previous = runs.at(-1);
    const end = Math.min(maxEnd, startTime + i * hop);
    if (previous && (from - previous.to) * hop < 0.2 - EPSILON) {
      Object.assign(previous, { to: i, end });
    } else {
      runs.push({ from, to: i, start: startTime + from * hop, end });
    }
  }
  return runs;
}

function edgeRatio(samples, sampleRate, start, end, threshold) {
  let ratio = energyRatio(
    samples,
    sampleRate,
    start * sampleRate,
    end * sampleRate
  );
  if (ratio >= threshold) {
    return ratio;
  }
  // The low-frequency tail at a continuous change can mask the high band.
  // Require a full 300 ms of evidence within the independently found edge.
  for (let time = start; time + 0.3 <= end + EPSILON; time += 0.15) {
    ratio = Math.max(
      ratio,
      energyRatio(
        samples,
        sampleRate,
        time * sampleRate,
        (time + 0.3) * sampleRate
      )
    );
  }
  return ratio;
}

function measure(
  samples,
  sampleRate,
  frames,
  pitch,
  { from, to, start, end, edge }
) {
  let voiced = 0;
  let vowelLike = 0;
  let consecutive = 0;
  for (let i = from; i < to; i++) {
    voiced += Number(pitch.f0[i] > 0);
    consecutive =
      frames.gravity[i] < 2500 && frames.energy[i] > -95 ? consecutive + 1 : 0;
    vowelLike = Math.max(vowelLike, consecutive);
  }
  voiced /= to - from;
  if (voiced >= 0.05 || vowelLike * frames.hop < 0.05 - EPSILON) {
    return null;
  }
  const threshold = sampleRate <= 8000 ? TELEPHONE_THRESHOLD : RATIO_THRESHOLD;
  const ratio = edge
    ? edgeRatio(samples, sampleRate, start, end, threshold)
    : energyRatio(samples, sampleRate, start * sampleRate, end * sampleRate);
  if (ratio < threshold || (edge === 'leading' && ratio > -10)) {
    return null;
  }
  return {
    start,
    end,
    confidence: clamp(1 - voiced / 0.05) * clamp((ratio + 18) / 12),
  };
}

function edgeWhispers(run, frames, pitch) {
  const { from, to, start, end } = run;
  const { hop, startTime, energy } = frames;
  let first = from;
  let last = to - 1;
  while (first < to && !(pitch.f0[first] > 0)) {
    first++;
  }
  while (last > first && !(pitch.f0[last] > 0)) {
    last--;
  }
  // A mode change can occur without a pause. Only split a run if the pitch
  // cluster is sustained and there is also a substantial level step.
  if ((last - first) * hop < 0.08) {
    return [];
  }
  const peak = (a, b) => {
    let level = -Infinity;
    for (let i = a; i < b; i++) {
      level = Math.max(level, energy[i]);
    }
    return level;
  };
  const voicedLevel = peak(first, last + 1);
  const quiet = (a, b) =>
    (b - a) * hop >= 0.3 - EPSILON && peak(a, b) <= voicedLevel - 10;
  const edges = [];
  if (quiet(from, first)) {
    // Avoid labelling a microphone's noisy lead-in before the first vowel.
    edges.push({
      from,
      to: first,
      start,
      end: startTime + first * hop,
      edge: 'leading',
    });
  }
  if (quiet(last + 1, to)) {
    edges.push({
      from: last + 1,
      to,
      start: startTime + (last + 1) * hop,
      end,
      edge: 'trailing',
    });
  }
  return edges;
}

function nearest(runs, index) {
  const { start, end } = runs[index];
  const back = index > 0 ? start - runs[index - 1].end : Infinity;
  const forward =
    index + 1 < runs.length ? runs[index + 1].start - end : Infinity;
  return Math.min(back, forward) <= 0.5 + EPSILON
    ? index + (back <= forward ? -1 : 1)
    : -1;
}

function joinSpans(spans, span) {
  const previous = spans.at(-1);
  if (previous && previous.end + 0.2 > span.start + EPSILON) {
    previous.confidence = Math.min(previous.confidence, span.confidence);
    previous.end = span.end;
  } else {
    spans.push(span);
  }
  return spans;
}

/** Find whispered speech in seconds on the same time axis as the input. */
export function findWhisper(samples, sampleRate, frames, pitch) {
  const runs = whisperSpeechRuns(
    frames,
    Math.min(frames.count, pitch.count ?? frames.count)
  );
  const classify = (run) => measure(samples, sampleRate, frames, pitch, run);
  const decisions = runs.map((run) => {
    if (run.end - run.start < 0.3 - EPSILON) {
      return [];
    }
    const span = classify(run);
    return span
      ? [span]
      : edgeWhispers(run, frames, pitch).map(classify).filter(Boolean);
  });
  return runs
    .flatMap(({ start, end }, index) => {
      if (end - start >= 0.3 - EPSILON) {
        return decisions[index];
      }
      const neighbour = nearest(runs, index);
      const source =
        decisions[neighbour]?.[
          neighbour < index ? decisions[neighbour].length - 1 : 0
        ];
      return source ? [{ start, end, confidence: source.confidence }] : [];
    })
    .reduce(joinSpans, []);
}

export function whisperAt(spans, time) {
  return spans.find((span) => span.start <= time && time < span.end);
}

// Mean relative durations of the male and female minimal-tier whisper probes.
// node experiments/issue-72-whisper-tones.mjs
const TONES = [
  ['˥', [5], 1.0544],
  ['˧˥', [3, 5], 1.078],
  ['˨˩˦', [2, 1, 4], 1.1251],
  ['˥˩', [5, 1], 1.0072],
  ['', [], 0.7353],
];
const POINTS = 10;

function center(values) {
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.map((value) => value - average);
}

export function whisperToneCost(observed, curve, length, expected) {
  const energy = center(observed);
  const pitch = center(curve);
  const squared = pitch.reduce(
    (sum, value, i) => sum + (0.7 * value - energy[i]) ** 2,
    0
  );
  const shape = clamp(Math.sqrt(squared / POINTS) / 4);
  const duration = clamp(2 * Math.abs(length - expected));
  return 0.25 + 0.5 * (0.6 * shape + 0.4 * duration);
}

/** Weak tone costs from the modulation of whisper noise and syllable length. */
export function whisperTones(frames, syllable) {
  const {
    start,
    end,
    vowelStart = start,
    meanDuration = end - start,
  } = syllable;
  const first = Math.max(
    0,
    Math.ceil((vowelStart - frames.startTime) / frames.hop - EPSILON)
  );
  const last = Math.min(
    frames.count - 1,
    Math.ceil((end - frames.startTime) / frames.hop - EPSILON) - 1
  );
  if (last < first || end <= start || meanDuration <= 0) {
    return {
      ...Object.fromEntries(TONES.map(([name]) => [name, 0.5])),
      '˨˩': 0.5,
    };
  }
  const observed = Array.from({ length: POINTS }, (_, i) => {
    const index = first + (i * (last - first)) / (POINTS - 1);
    const before = Math.floor(index);
    return (
      frames.energy[before] +
      (index - before) *
        (frames.energy[Math.min(last, before + 1)] - frames.energy[before])
    );
  });
  const costs = Object.fromEntries(
    TONES.map(([name, levels, expected]) => {
      const curve = toneCurve(levels, {
        count: POINTS,
        duration: end - vowelStart,
      });
      return [
        name,
        whisperToneCost(
          observed,
          curve,
          (end - start) / meanDuration,
          expected
        ),
      ];
    })
  );
  costs['˨˩'] = costs['˨˩˦'];
  return costs;
}
