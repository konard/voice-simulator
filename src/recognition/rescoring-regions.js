/** Common boundaries and local alternatives for n-best rescoring. Unlicense. */

export function pieceKey(segments) {
  return JSON.stringify(
    segments.map(({ ipa, start, end }) => [ipa, start, end])
  );
}

const pieceCost = (segments) =>
  segments.reduce((sum, { cost }) => sum + cost, 0);

function sharedBoundaries(readings) {
  const edges = readings.map(
    ({ segments }) =>
      new Set(segments.flatMap(({ start, end }) => [start, end]))
  );
  return [...edges[0]]
    .filter((time) => edges.every((set) => set.has(time)))
    .sort((a, b) => a - b);
}

function splitReadings(readings, bounds) {
  return readings.map(({ segments }) => {
    let index = 0;
    return bounds.slice(1).map((end, interval) => {
      while (segments[index]?.end <= bounds[interval]) {
        index++;
      }
      const first = index;
      while (segments[index]?.end <= end) {
        index++;
      }
      return segments.slice(first, index);
    });
  });
}

function collectAlternatives(pieces) {
  const alternatives = new Map();
  const keys = pieces.map((segments) => {
    const key = pieceKey(segments);
    const cost = pieceCost(segments);
    if (!alternatives.has(key) || alternatives.get(key).cost > cost) {
      alternatives.set(key, { key, cost, segments });
    }
    return key;
  });
  return {
    keys,
    alternatives: [...alternatives.values()].sort((a, b) => a.cost - b.cost),
  };
}

function context(intervals, index, before) {
  const adjacent = intervals[index + (before ? -1 : 1)];
  if (adjacent?.alternatives.length !== 1) {
    return [];
  }
  const phone = adjacent.alternatives[0].segments.at(before ? -1 : 0);
  return phone && phone.kind !== 'pause' ? [phone] : [];
}

function sameTimetable(a, b) {
  return (
    a.length === b.length &&
    a.every(({ start, end, kind }, index) => {
      const other = b[index];
      return (
        start === other.start &&
        end === other.end &&
        (kind === 'pause') === (other.kind === 'pause')
      );
    })
  );
}

export function findRescoringRegions(
  readings,
  maxAlternatives,
  margin,
  preserveTiming
) {
  if (readings.length < 2 || maxAlternatives < 2) {
    return [];
  }
  const bounds = sharedBoundaries(readings);
  const pieces = splitReadings(readings, bounds);
  const intervals = bounds
    .slice(1)
    .map((_, index) => collectAlternatives(pieces.map((row) => row[index])));
  const regions = [];
  for (const [index, { keys, alternatives: all }] of intervals.entries()) {
    const alternatives = preserveTiming
      ? all.filter(({ segments }) => sameTimetable(pieces[0][index], segments))
      : all;
    const start = bounds[index];
    const end = bounds[index + 1];
    const gap = alternatives[1]?.cost - alternatives[0].cost;
    if (alternatives.length < 2 || gap > margin || end - start > 2) {
      continue;
    }
    const selected = alternatives.slice(0, maxAlternatives);
    // Always reserve a slot for the decoder's first choice.
    if (!selected.some(({ key }) => key === keys[0])) {
      selected[selected.length - 1] = alternatives.find(
        ({ key }) => key === keys[0]
      );
    }
    regions.push({
      start,
      end,
      gap,
      keys,
      alternatives: selected,
      phones: alternatives[0].segments.filter(({ kind }) => kind !== 'pause')
        .length,
      before: context(intervals, index, true),
      after: context(intervals, index, false),
    });
  }
  return regions.sort((a, b) => a.gap - b.gap || a.start - b.start);
}
