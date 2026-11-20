/** Retiming for analysis-by-synthesis. Unlicense. */
import { planUtterance } from '../articulation/plan.js';
import { parseIpa } from '../ipa/parse.js';

function validateAnchors(anchors) {
  for (const [index, [from, to]] of anchors.entries()) {
    const previous = anchors[index - 1];
    if (
      !Number.isFinite(from) ||
      !Number.isFinite(to) ||
      (previous && (from <= previous[0] || to <= previous[1]))
    ) {
      throw new RangeError('Both columns of plan anchors must rise strictly');
    }
  }
}

function timeMap(anchors, reverse = false) {
  const from = Number(reverse);
  const to = 1 - from;
  return (time) => {
    let low = 0;
    let high = anchors.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (anchors[mid][from] <= time) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    const before = anchors[low - 1];
    const after = anchors[low];
    if (
      !before ||
      !after ||
      (before[to] === before[from] && after[to] === after[from])
    ) {
      const edge = before ?? after;
      return edge ? time + (edge[to] - edge[from]) : time;
    }
    const fraction = (time - before[from]) / (after[from] - before[from]);
    return before[to] + fraction * (after[to] - before[to]);
  };
}

function interpolate(values, position, count = values.length) {
  const index = Math.max(0, Math.min(count - 1, position));
  const before = Math.floor(index);
  return (
    values[before] +
    (index - before) *
      (values[Math.min(before + 1, count - 1)] - values[before])
  );
}

/** Map plan times to recording times, keeping the render's time axis local. */
export function warpPlan(plan, anchors) {
  validateAnchors(anchors);
  const forward = timeMap(anchors);
  const inverse = timeMap(anchors, true);
  const offset = forward(0);
  const duration = forward(plan.duration) - offset;
  const { frameRate } = plan;
  const frameCount = Math.ceil(duration * frameRate) + 1;
  const positions = Float64Array.from(
    { length: frameCount },
    (_, frame) => frameRate * inverse(offset + frame / frameRate)
  );
  const channels = Object.fromEntries(
    Object.entries(plan.channels).map(([name, values]) => [
      name,
      Float32Array.from(positions, (position) => interpolate(values, position)),
    ])
  );
  const span = (item) => ({
    ...item,
    start: forward(item.start) - offset,
    end: forward(item.end) - offset,
  });
  return {
    ...plan,
    offset,
    duration,
    frameCount,
    channels,
    segments: plan.segments.map((segment) => {
      const mapped = span(segment);
      return { ...mapped, duration: mapped.end - mapped.start };
    }),
    modes: plan.modes?.map(span),
    sounds: plan.sounds?.map(span),
  };
}

function readingAnchors(plan, phones) {
  const anchors = [];
  let previous;
  let last;
  for (const segment of plan.segments) {
    if (!segment.token) {
      continue;
    }
    if (segment.token !== previous && segment.kind !== 'release') {
      anchors.push([segment.start, phones[anchors.length].start]);
    }
    previous = segment.token;
    last = segment;
  }
  if (last) {
    anchors.push([last.end, phones.at(-1).end]);
  }
  return anchors;
}

function copyProsody(plan, track) {
  if (!track?.frameCount) {
    return;
  }
  for (const name of ['f0', 'loudness']) {
    const values = plan.channels[name];
    const source = track.channels[name];
    for (let index = 0; index < values.length; index++) {
      const time = plan.offset + index / plan.frameRate - track.startTime;
      values[index] = interpolate(
        source,
        time * track.frameRate,
        track.frameCount
      );
    }
  }
}

/** Plan the given phones with their decoded timing, pitch, and loudness. */
export function planReading(decoded, segments) {
  const phones = segments.filter(({ kind }) => kind !== 'pause');
  // Preserve the decoder's token boundaries even when adjacent IPA strings
  // could be parsed as one unit (for example, t followed by ʃ).
  const tokens = phones.map(({ ipa }) => parseIpa(ipa).tokens[0]);
  const plan = planUtterance(tokens, {
    head: decoded.voice,
    language: decoded.language,
  });
  const warped = warpPlan(plan, readingAnchors(plan, phones));
  copyProsody(warped, decoded.tracks.articulation);
  return warped;
}
