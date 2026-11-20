/** Candidate boundaries and acoustic costs independent of beam search. Unlicense. */
import { CODEBOOK_CHANNELS } from './codebook.js';
import {
  TEMPLATE_CHANNELS,
  TEMPLATE_FLOORS,
  TEMPLATE_POINTS,
} from './decode-model.js';
import { BROAD_CLASSES } from './landmarks.js';
import { whisperAt } from './whisper.js';

const EPSILON = 1e-9;
const MIN_SEPARATION = 0.015;
const MIN_PHONE_DURATION = 0.02;

function findGaps(frames, first, last, startTime, end) {
  const gaps = [];
  for (let i = first; i < last; i++) {
    if (frames.speech[i]) {
      continue;
    }
    const from = i;
    while (i + 1 < last && !frames.speech[i + 1]) {
      i++;
    }
    const start = Math.max(startTime, frames.startTime + from * frames.hop);
    const stop = i + 1 === last ? end : frames.startTime + (i + 1) * frames.hop;
    gaps.push({ start, end: stop, pause: stop - start >= 0.15 - EPSILON });
  }
  return gaps;
}

function speedPeaks(frames, track, first, last, add) {
  const n = last - first;
  const speed = new Float64Array(n);
  for (const { name, min, max } of CODEBOOK_CHANNELS) {
    const channel = track.channels[name];
    for (let i = 2; i + 2 < n; i++) {
      speed[i] +=
        ((channel[first + i + 2] - channel[first + i - 2]) / (max - min)) ** 2;
    }
  }
  for (let i = 2; i + 2 < n; i++) {
    if (
      speed[i] > 0.15 ** 2 &&
      speed[i] > speed[i - 1] &&
      speed[i] >= speed[i + 1]
    ) {
      add(frames.startTime + (first + i) * frames.hop, 0);
    }
  }
}

function consolidate(candidates) {
  candidates.sort((a, b) => a.time - b.time || b.priority - a.priority);
  const kept = [];
  for (const candidate of candidates) {
    const previous = kept.at(-1);
    if (
      !previous ||
      candidate.time - previous.time >= MIN_SEPARATION - EPSILON
    ) {
      kept.push(candidate);
    } else if (candidate.priority > previous.priority) {
      kept[kept.length - 1] = candidate;
    } else if (
      candidate.priority === 4 &&
      previous.priority === 4 &&
      candidate.time - previous.time > EPSILON
    ) {
      // Never move the endpoints of pauses or of the requested interval.
      kept.push(candidate);
    }
  }
  return Float64Array.from(kept, ({ time }) => time);
}

// Speech bounds, event candidates and their priority merging share one time grid.
// eslint-disable-next-line complexity
export function decodeBoundaries(
  frames,
  landmarks,
  track,
  { from, to, open = false, locked = false },
  whisperSpans = []
) {
  const first = Math.max(
    0,
    Math.floor((from - frames.startTime) / frames.hop + EPSILON)
  );
  const last = Math.min(
    track.frameCount,
    Math.ceil((to - frames.startTime) / frames.hop - EPSILON)
  );
  if (first >= last || !frames.speech.subarray(first, last).some(Boolean)) {
    if (locked && to - from >= 0.15 - EPSILON) {
      return {
        times: Float64Array.of(from, to),
        pauses: [{ start: from, end: to }],
      };
    }
    return { times: new Float64Array(), pauses: [] };
  }
  const gaps = findGaps(frames, first, last, from, to);
  const leading = gaps[0];
  const trailing = gaps.at(-1);
  const start =
    !locked && leading?.start <= from && !leading.pause ? leading.end : from;
  const end =
    !open && trailing?.end === to && !trailing.pause ? trailing.start : to;
  const pauses = gaps.filter((gap) => gap.pause);
  const candidates = [];
  const add = (time, priority) => {
    if (time >= start && time <= end) {
      candidates.push({ time, priority });
    }
  };
  add(start, 4);
  add(end, 4);
  for (const gap of gaps) {
    add(gap.start, gap.pause ? 4 : 3);
    add(gap.end, gap.pause ? 4 : 3);
  }
  for (const { time } of landmarks.landmarks) {
    add(time, 2);
  }
  const classes = landmarks.classes;
  for (let i = first + 1; i < last; i++) {
    if (classes[i] !== classes[i - 1]) {
      add(frames.startTime + i * frames.hop, 1);
    }
  }
  // In whisper, movement in the inferred tract can be caused by noise.
  // Use the spectral landmarks and the finer whisper grid there.
  speedPeaks(frames, track, first, last, (time, priority) => {
    if (!whisperAt(whisperSpans, time)) {
      add(time, priority);
    }
  });
  const times = consolidate(candidates).filter(
    (time) => !pauses.some((gap) => gap.start < time && time < gap.end)
  );
  return { times, pauses };
}

function classCounts(frames, landmarks, start, end) {
  const out = new Uint16Array(BROAD_CLASSES.length);
  const from = Math.max(
    0,
    Math.ceil((start - frames.startTime) / frames.hop - EPSILON)
  );
  const to = Math.min(
    landmarks.count,
    Math.ceil((end - frames.startTime) / frames.hop - EPSILON)
  );
  for (let frame = from; frame < to; frame++) {
    out[landmarks.classes[frame]]++;
  }
  return [out, Math.max(1, to - from)];
}

function sample(track, start, duration, means, precision) {
  const { channels, variance } = track;
  const width = TEMPLATE_CHANNELS.length;
  TEMPLATE_POINTS.forEach((relative, point) => {
    const index = Math.max(
      0,
      Math.min(
        track.frameCount - 1,
        (start + relative * duration - track.startTime) * track.frameRate
      )
    );
    const lo = Math.floor(index);
    const hi = Math.min(lo + 1, track.frameCount - 1);
    const ratio = index - lo;
    for (let col = 0; col < width; col++) {
      const name = TEMPLATE_CHANNELS[col];
      const data = channels[name];
      const spread = variance[name];
      const cell = point * width + col;
      means[cell] = (1 - ratio) * data[lo] + ratio * data[hi];
      const v =
        ratio === 0
          ? spread[lo]
          : (1 - ratio) * spread[lo] + ratio * spread[hi];
      precision[cell] = 1 / (v + TEMPLATE_FLOORS[col]);
    }
  });
}

export function createSpanScorer(frames, landmarks, track) {
  const means = new Float64Array(
    TEMPLATE_CHANNELS.length * TEMPLATE_POINTS.length
  );
  const precision = new Float64Array(means.length);
  return (start, end, phones) => {
    const duration = end - start;
    const [counts, frameCount] = classCounts(frames, landmarks, start, end);
    sample(track, start, duration, means, precision);
    const terms = new Float64Array(phones.length * 3);
    const long = new Uint8Array(phones.length);
    phones.forEach((unit, index) => {
      let acoustic = 0;
      let mismatch = 0;
      for (let i = 0; i < unit.compared.length; i++) {
        const cell = unit.compared[i];
        acoustic += (means[cell] - unit.values[cell]) ** 2 * precision[cell];
      }
      for (let i = 0; i < counts.length; i++) {
        if (!(unit.classMask & (1 << i))) {
          mismatch += counts[i];
        }
      }
      long[index] = Number(duration > 1.6 * unit.duration);
      terms[index * 3] = acoustic / unit.compared.length;
      terms[index * 3 + 1] = 2 * Math.log(duration / unit.duration) ** 2;
      terms[index * 3 + 2] = mismatch / frameCount;
    });
    return { terms, long };
  };
}

function whisperGrid(original, pauses, whisperSpans, bounds) {
  const start = original[0] ?? bounds.from;
  const end = original.at(-1) ?? bounds.to;
  const spansInBounds = whisperSpans.filter(
    ({ start, end }) => end > bounds.from && start < bounds.to
  );
  const edges = whisperEdges(spansInBounds, pauses, start, end);
  const times = whisperBoundaries(original, spansInBounds, edges, pauses);
  return { times, spansInBounds, edges };
}

function whisperEdges(spans, pauses, start, end) {
  const mandatory = [start, end, ...pauses.flatMap((p) => [p.start, p.end])];
  const candidates = [
    ...new Set(spans.flatMap((span) => [span.start, span.end])),
  ].filter((time) => time > start && time < end);
  const minimum = MIN_PHONE_DURATION - EPSILON;
  // Leave a path across short spans and gaps that cannot contain a phone.
  return candidates.filter(
    (time, i) =>
      time - (candidates[i - 1] ?? -Infinity) >= minimum &&
      (candidates[i + 1] ?? Infinity) - time >= minimum &&
      mandatory.every((edge) => Math.abs(edge - time) >= minimum)
  );
}

/** Keep the three terms separate so tuning can reuse the same observations. */
export function prepareDecode(
  frames,
  landmarks,
  track,
  templates,
  bounds,
  {
    templatesForTime = () => templates,
    whisperSpans = [],
    whisperScore = null,
  } = {}
) {
  const { times: original, pauses } = decodeBoundaries(
    frames,
    landmarks,
    track,
    bounds,
    whisperSpans
  );
  const { times, spansInBounds, edges } = whisperGrid(
    original,
    pauses,
    whisperSpans,
    bounds
  );
  const score = createSpanScorer(frames, landmarks, track);
  return {
    times,
    spans: scoreBoundaries({
      times,
      pauses,
      spansInBounds,
      edges,
      templatesForTime,
      score: whisperScore
        ? (start, end, phones) =>
            whisperScore(start, end) ?? score(start, end, phones)
        : score,
    }),
  };
}

function scoreBoundaries({
  times,
  pauses,
  spansInBounds,
  edges,
  templatesForTime,
  score,
}) {
  const spans = Array.from(times, () => []);
  const nextEdge = (start) =>
    edges.find((edge) => edge > start + EPSILON) ?? Infinity;
  let gap = 0;
  for (let from = 0; from < times.length - 1; from++) {
    const start = times[from];
    const phones = templatesForTime(start);
    const whispered = spansInBounds.some(
      (span) => span.start <= start + EPSILON && start + EPSILON < span.end
    );
    const limit = whispered ? 28 : 4;
    while (gap < pauses.length && pauses[gap].end <= start + EPSILON) {
      gap++;
    }
    const pause = pauses[gap];
    if (pause && Math.abs(pause.start - start) <= EPSILON) {
      spans[from].push({ to: from + 1, pause: true });
      continue;
    }
    const end = Math.min(pause?.start ?? Infinity, nextEdge(start));
    for (let to = from + 1; to <= from + limit && to < times.length; to++) {
      const duration = times[to] - start;
      if (duration > 0.4 + EPSILON || times[to] > end + EPSILON) {
        break;
      }
      if (duration < MIN_PHONE_DURATION - EPSILON) {
        continue;
      }
      spans[from].push({ to, ...score(start, times[to], phones) });
    }
  }
  return spans;
}

function whisperBoundaries(original, spans, edges, pauses) {
  if (!spans.length || !original.length) {
    return original;
  }
  const start = original[0];
  const end = original.at(-1);
  const candidates = [...original].map((time) => ({ time, priority: 2 }));
  for (const time of [
    start,
    end,
    ...edges,
    ...pauses.flatMap((p) => [p.start, p.end]),
  ]) {
    candidates.push({ time, priority: 4 });
  }
  for (const span of spans) {
    for (
      let time = Math.max(start, span.start) + 0.02;
      time < Math.min(end, span.end);
      time += 0.02
    ) {
      if (!pauses.some((p) => p.start < time && time < p.end)) {
        candidates.push({ time, priority: 0 });
      }
    }
  }
  return consolidate(candidates);
}
