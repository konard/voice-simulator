/** Retiming of planned speech on a measured time axis. Unlicense. */
import { alignEdits } from '../metrics/text.js';
import { parseIpa } from '../ipa/parse.js';

const SILENT_CHANNELS = new Set([
  'loudness',
  'voicing',
  'aspiration',
  'frication',
  'breath',
  'whisper',
  'lungPressure',
]);

export function sampleTrack(values, frame) {
  const t = Math.min(Math.max(frame, 0), values.length - 1);
  const i = Math.floor(t);
  return values[i] + (values[Math.ceil(t)] - values[i]) * (t - i);
}

export function sourceFrame(
  time,
  { start, end, sourceStart, sourceEnd },
  frameRate
) {
  const fraction = Math.min(1, (time - start) / (end - start));
  return (sourceStart + (sourceEnd - sourceStart) * fraction) * frameRate;
}

export function phoneDuration(planned, release, requested, clamp) {
  if (!clamp && requested > release) {
    return requested;
  }
  const minimum = Math.max(
    planned * 0.33,
    release + (planned - release) * 0.001
  );
  return Math.max(minimum, Math.min(planned * 3, requested));
}

/** A stop or affricate can occupy multiple segments of one IPA token. */
export function groupPhones(segments) {
  const groups = [];
  for (const segment of segments) {
    const { token, kind, start, end } = segment;
    if (!token || kind === 'pause' || token.kind === 'sound') {
      continue;
    }
    const last = groups.at(-1);
    if (last?.token === token) {
      last.end = end;
      last.parts.push(segment);
    } else {
      groups.push({ token, start, end, parts: [segment] });
    }
  }
  return groups;
}

function phoneKey(ipa) {
  return parseIpa(ipa).tokens[0]?.base ?? ipa;
}

function measurements(groups, measured) {
  const { pairs } = alignEdits(
    groups.map(({ token }) => token.base ?? token.symbol),
    measured.map(({ ipa }) => phoneKey(ipa))
  );
  return new Map(pairs.map(([i, j]) => [groups[i], measured[j]]));
}

function place(part, start, end) {
  return { ...part, start, end, duration: end - start };
}

function addGap(spans, segments, plan, gap) {
  const { start, end, sourceStart, sourceEnd } = gap;
  if (end <= start) {
    return;
  }
  const silent = sourceEnd <= sourceStart;
  const originals = plan.segments.filter(
    (part) => part.start >= sourceStart && part.end <= sourceEnd
  );
  spans.push({ ...gap, silent });
  if (originals.length && !silent) {
    const scale = (end - start) / (sourceEnd - sourceStart);
    for (const part of originals) {
      segments.push(
        place(
          part,
          start + (part.start - sourceStart) * scale,
          start + (part.end - sourceStart) * scale
        )
      );
    }
  } else {
    segments.push(
      place({ kind: 'pause', target: { voicing: 0, loudness: 0 } }, start, end)
    );
  }
}

function placePhone(spans, segments, group, start, length) {
  const releases = group.parts.reduce(
    (total, part) => total + (part.kind === 'release' ? part.duration : 0),
    0
  );
  const stretch = (length - releases) / (group.end - group.start - releases);
  let cursor = start;
  for (const [i, part] of group.parts.entries()) {
    const duration =
      part.kind === 'release' ? part.duration : part.duration * stretch;
    const end =
      i === group.parts.length - 1 ? start + length : cursor + duration;
    spans.push({
      start: cursor,
      end,
      sourceStart: part.start,
      sourceEnd: part.end,
    });
    segments.push(place(part, cursor, end));
    cursor = end;
  }
}

function interpolateChannels(plan, spans, count) {
  const { frameRate } = plan;
  const tracks = Object.entries(plan.channels).map(([name, input]) => ({
    name,
    input,
    output: new Float32Array(count),
    mutesInPause: SILENT_CHANNELS.has(name),
  }));
  let i = 0;
  for (let frame = 0; frame < count; frame++) {
    const t = frame / frameRate;
    while (i < spans.length - 1 && t >= spans[i].end) {
      i++;
    }
    const { silent } = spans[i];
    const mapped = sourceFrame(t, spans[i], frameRate);
    for (const { input, output, mutesInPause } of tracks) {
      output[frame] = silent && mutesInPause ? 0 : sampleTrack(input, mapped);
    }
  }
  return Object.fromEntries(tracks.map(({ name, output }) => [name, output]));
}

/**
 * Each phone supplies two anchors, with another anchor for a stop release.
 * Absolute starts absorb earlier clamps whenever there is room to do so.
 */
export function warpPlan(plan, measuredSegments, options = {}) {
  const groups = groupPhones(plan.segments);
  if (!groups.length || !measuredSegments.length) {
    return { ...plan, warnings: [] };
  }
  const measured = options.byIndex
    ? new Map(groups.map((group, i) => [group, measuredSegments[i]]))
    : measurements(groups, measuredSegments);
  const spans = [],
    segments = [],
    warnings = [];
  let cursor = 0;
  let sourceEnd = 0;
  for (const group of groups) {
    const measurement = measured.get(group);
    const start = Math.max(
      cursor,
      measurement?.start ?? cursor + group.start - sourceEnd
    );
    const planned = group.end - group.start;
    const requested = measurement
      ? measurement.end - measurement.start
      : planned;
    const fixed = group.parts
      .filter(({ kind }) => kind === 'release')
      .reduce((total, part) => total + part.duration, 0);
    const length = phoneDuration(
      planned,
      fixed,
      requested,
      options.clamp !== false
    );
    if (length !== requested) {
      warnings.push({
        ipa: group.token.symbol,
        start,
        requested,
        duration: length,
      });
    }
    addGap(spans, segments, plan, {
      start: cursor,
      end: start,
      sourceStart: sourceEnd,
      sourceEnd: group.start,
    });
    placePhone(spans, segments, group, start, length);
    cursor = start + length;
    sourceEnd = group.end;
  }
  const duration = Math.max(
    cursor,
    options.duration ?? measuredSegments.at(-1).end
  );
  addGap(spans, segments, plan, {
    start: cursor,
    end: duration,
    sourceStart: sourceEnd,
    sourceEnd: plan.duration,
  });
  const frameCount = Math.ceil(duration * plan.frameRate) + 1;
  return {
    ...plan,
    duration,
    frameCount,
    segments,
    channels: interpolateChannels(plan, spans, frameCount),
    warnings,
  };
}
