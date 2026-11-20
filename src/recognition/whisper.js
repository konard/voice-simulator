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
const EDGE_LEVEL_DROP = 10;
const EDGE_RATIO_RISE = 5;
const EDGE_RATIO_ALLOWANCE = 6;

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

function edgeThreshold(samples, sampleRate, threshold, start, before) {
  if (before === undefined) {
    return threshold;
  }
  const voicedRatio = energyRatio(
    samples,
    sampleRate,
    Math.max(before, start - 0.3) * sampleRate,
    start * sampleRate
  );
  // After a level step, a large change in the band ratio is also evidence.
  // Limit the adjustment and require vowel-like frames as in the full run.
  return Math.max(
    threshold - EDGE_RATIO_ALLOWANCE,
    Math.min(threshold, voicedRatio + EDGE_RATIO_RISE)
  );
}

function measure(
  samples,
  sampleRate,
  frames,
  pitch,
  { from, to, start, end, edge, before }
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
  const base = sampleRate <= 8000 ? TELEPHONE_THRESHOLD : RATIO_THRESHOLD;
  const threshold = edgeThreshold(samples, sampleRate, base, start, before);
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

function framePeak(energy, from, to) {
  let peak = -Infinity;
  for (let i = from; i < to; i++) {
    peak = Math.max(peak, energy[i]);
  }
  return peak;
}

export function whisperVoiceEdges(run, frames, pitch, committed = run.to) {
  const { from, to, start, end } = run;
  const { hop, startTime, energy } = frames;
  const observed = Math.min(to, committed);
  let first = from;
  let last = observed - 1;
  while (first < observed && !(pitch.f0[first] > 0)) {
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
  const voicedLevel = framePeak(energy, first, last + 1);
  const quiet = (a, b) =>
    a < b && framePeak(energy, a, b) <= voicedLevel - EDGE_LEVEL_DROP;
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
      before: startTime + first * hop,
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
      : whisperVoiceEdges(run, frames, pitch)
          .filter(({ start, end }) => end - start >= 0.3 - EPSILON)
          .map(classify)
          .filter(Boolean);
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

export function clipWhisperSpans(spans, recordingEnd) {
  return spans
    .filter(({ start }) => start < recordingEnd)
    .map((span) => ({ ...span, end: Math.min(span.end, recordingEnd) }));
}

// Mean relative durations of medial and final syllables across rotated tone
// sequences in male and female minimal-tier whisper probes. Phrase-final
// lengthening moves the duration target for each tone.
// node experiments/issue-72-whisper-tone-duration.mjs
const TONES = [
  ['˥', [5], 0.9256, 1.182],
  ['˧˥', [3, 5], 0.9564, 1.2056],
  ['˨˩˦', [2, 1, 4], 0.9999, 1.3109],
  ['˥˩', [5, 1], 0.8737, 1.1135],
  ['', [], 0.7143, 0.7641],
];
const POINTS = 10;

function center(values) {
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.map((value) => value - average);
}

function isPhraseFinal(frames, last) {
  // Leave one analysis window for speech overhang from the syllable itself.
  const from = last + Math.ceil(frames.window / frames.hop);
  const to = Math.min(frames.count, last + Math.ceil(0.2 / frames.hop));
  return !frames.speech.subarray(from, to).includes(1);
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
  const phraseFinal = isPhraseFinal(frames, last);
  const costs = Object.fromEntries(
    TONES.map(([name, levels, medial, final]) => {
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
          phraseFinal ? final : medial
        ),
      ];
    })
  );
  costs['˨˩'] = costs['˨˩˦'];
  return costs;
}
