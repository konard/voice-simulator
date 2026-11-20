/** Candidate boundaries and acoustic costs independent of beam search. Unlicense. */
import { CODEBOOK_CHANNELS } from './codebook.js';
import {
  TEMPLATE_CHANNELS,
  TEMPLATE_FLOORS,
  TEMPLATE_POINTS,
} from './decode-model.js';
import { BROAD_CLASSES } from './landmarks.js';

const EPSILON = 1e-9;
const MIN_SEPARATION = 0.015;
const MAX_PHONE_DURATION = 0.4;

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
  return kept.map(({ time }) => time);
}

function fillLongSpans(candidates, pauses) {
  const times = [];
  for (const time of candidates) {
    const previous = times.at(-1) ?? time;
    const duration = time - previous;
    if (
      duration > MAX_PHONE_DURATION + EPSILON &&
      !pauses.some(({ start }) => start === previous)
    ) {
      // A stable tract and unchanged broad class may leave no candidates.
      const parts = Math.ceil(duration / MAX_PHONE_DURATION);
      for (let part = 1; part < parts; part++) {
        times.push(previous + (part * duration) / parts);
      }
    }
    times.push(time);
  }
  return Float64Array.from(times);
}

// Speech bounds, event candidates and their priority merging share one time grid.
// eslint-disable-next-line complexity
export function decodeBoundaries(
  frames,
  landmarks,
  track,
  { from, to, open = false, locked = false }
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
  speedPeaks(frames, track, first, last, add);
  const speechEdges = consolidate(candidates).filter(
    (time) => !pauses.some((gap) => gap.start < time && time < gap.end)
  );
  return { times: fillLongSpans(speechEdges, pauses), pauses };
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

/** Keep the three terms separate so tuning can reuse the same observations. */
export function prepareDecode(
  frames,
  landmarks,
  track,
  templates,
  bounds,
  templatesForTime = () => templates
) {
  const { times, pauses } = decodeBoundaries(frames, landmarks, track, bounds);
  const spans = Array.from(times, () => []);
  const score = createSpanScorer(frames, landmarks, track);
  let gap = 0;
  for (let from = 0; from < times.length - 1; from++) {
    const start = times[from];
    const phones = templatesForTime(start);
    while (gap < pauses.length && pauses[gap].end <= start + EPSILON) {
      gap++;
    }
    const pause = pauses[gap];
    if (pause && Math.abs(pause.start - start) <= EPSILON) {
      spans[from].push({ to: from + 1, pause: true });
      continue;
    }
    for (let to = from + 1; to <= from + 4 && to < times.length; to++) {
      const duration = times[to] - start;
      if (
        duration > MAX_PHONE_DURATION + EPSILON ||
        (pause && times[to] > pause.start + EPSILON)
      ) {
        break;
      }
      if (duration < 0.02 - EPSILON) {
        continue;
      }
      spans[from].push({ to, ...score(start, times[to], phones) });
    }
  }
  return { times, spans };
}
