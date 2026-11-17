/** Word decisions -> timed spans. Unlicense. */
import { emotionChanges } from '../articulation/emotion.js';
const same = (a, b) =>
  a?.notation === b?.notation &&
  JSON.stringify(a?.phonation) === JSON.stringify(b?.phonation);

export function phrases(words) {
  const result = [];
  words.forEach((word, i) => {
    if (!i || word.start - words[i - 1].end >= 0.2) {
      result.push({ from: i, to: i + 1 });
    } else {
      result.at(-1).to = i + 1;
    }
  });
  return result;
}
export function wordSpans(words, features, labels, field) {
  const selected = labels.map((l) => l[field]);
  // Read the original decisions so smoothing cannot propagate in a chain.
  const smoothed = selected.map((label, i) =>
    i > 0 &&
    i < selected.length - 1 &&
    words[i].start - words[i - 1].end < 0.2 &&
    words[i + 1].start - words[i].end < 0.2 &&
    selected[i - 1] &&
    same(selected[i - 1], selected[i + 1])
      ? selected[i - 1]
      : label
  );
  const spans = [];
  smoothed.forEach((decision, i) => {
    if (!decision || !features[i].vowels) {
      return;
    }
    const mode = { ...decision };
    delete mode.E;
    const last = spans.at(-1);
    if (
      last &&
      last.to === i &&
      same(last, decision) &&
      words[i].start - last.end < 0.2
    ) {
      const count = last.to - last.from;
      last.confidence =
        (last.confidence * count + decision.confidence) / (count + 1);
      last.to = i + 1;
      last.end = words[i].end;
    } else {
      spans.push({
        start: words[i].start,
        end: words[i].end,
        from: i,
        to: i + 1,
        ...mode,
      });
    }
  });
  return spans.filter((s) => s.notation === 'W' || s.end - s.start >= 0.3);
}

/** Least-squares effort change across >=4 consecutive effort words.
 * The run may cross quantization boundaries; otherwise a ramp would split. */
// Independent fit and pitch corroboration gates keep abrupt steps out of ramps.
// eslint-disable-next-line complexity
export function effortRamps(words, labels, spans) {
  let from = 0;
  const ramps = [];
  while (from < labels.length) {
    if (labels[from].quality?.phonation) {
      from++;
      continue;
    }
    let to = from + 1;
    while (
      to < labels.length &&
      !labels[to].quality?.phonation &&
      words[to].start - words[to - 1].end < 0.2
    ) {
      to++;
    }
    if (to - from >= 4) {
      const time = words.slice(from, to).map((w) => (w.start + w.end) / 2);
      const centre = time.reduce((a, b) => a + b, 0) / time.length;
      const energies = labels.slice(from, to).map((l) => l.E);
      const mean = energies.reduce((a, b) => a + b, 0) / energies.length;
      const slope =
        time.reduce((n, t, i) => n + (t - centre) * (energies[i] - mean), 0) /
        time.reduce((n, t) => n + (t - centre) ** 2, 0);
      const change = slope * (time.at(-1) - time[0]);
      const variance = energies.reduce((n, E) => n + (E - mean) ** 2, 0);
      const residual = time.reduce(
        (n, t, i) => n + (energies[i] - mean - slope * (t - centre)) ** 2,
        0
      );
      const pitch = labels.slice(from, to).map((l) => l.pitchEffort ?? 0);
      const pitchMean = pitch.reduce((a, b) => a + b, 0) / pitch.length;
      const pitchSlope =
        time.reduce((n, t, i) => n + (t - centre) * (pitch[i] - pitchMean), 0) /
        time.reduce((n, t) => n + (t - centre) ** 2, 0);
      const corroborated = Math.abs(pitchSlope * (time.at(-1) - time[0])) >= 8;
      const pitchVariance = pitch.reduce((n, p) => n + (p - pitchMean) ** 2, 0);
      const pitchResidual = time.reduce(
        (n, t, i) =>
          n + (pitch[i] - pitchMean - pitchSlope * (t - centre)) ** 2,
        0
      );
      if (
        Math.abs(change) >= 8 &&
        variance > 0 &&
        corroborated &&
        pitchResidual < 0.05 * pitchVariance &&
        residual / variance < 1
      ) {
        ramps.push({
          start: words[from].start,
          end: words[to - 1].end,
          from,
          to,
          effort: 0.5,
          effortEnd: change > 0 ? 0.75 : 0.25,
          notation: change > 0 ? 'crescendo' : 'diminuendo',
          confidence: 1 - residual / variance,
        });
      }
    }
    from = to;
  }
  return [
    ...spans.filter(
      (s) =>
        s.effort === undefined ||
        !ramps.some((r) => s.from >= r.from && s.to <= r.to)
    ),
    ...ramps,
  ];
}

/** Split crossing spans at phrase boundaries; remove only matching preset
 * keys, retaining independent effects and uncovered words. */
export function removePresetEffects(spans, emotionSpan) {
  const changes = emotionChanges(emotionSpan.emotion);
  return spans.flatMap((span) => {
    if (
      span.to <= emotionSpan.from ||
      span.from >= emotionSpan.to ||
      span.emotion ||
      span.sound
    ) {
      return [span];
    }
    const kept = [];
    if (span.from < emotionSpan.from) {
      kept.push({ ...span, to: emotionSpan.from, end: emotionSpan.start });
    }
    if (span.to > emotionSpan.to) {
      kept.push({ ...span, from: emotionSpan.to, start: emotionSpan.end });
    }
    const inside = {
      ...span,
      from: Math.max(span.from, emotionSpan.from),
      to: Math.min(span.to, emotionSpan.to),
      start: Math.max(span.start, emotionSpan.start),
      end: Math.min(span.end, emotionSpan.end),
    };
    let redundant = false;
    if (span.effort !== undefined) {
      redundant = Math.abs(span.effort - changes.effort) <= 0.25;
    }
    if (span.rate !== undefined) {
      redundant = Math.abs(span.rate - changes.rate) <= 0.25;
    }
    if (span.phonation) {
      redundant = Object.entries(span.phonation).every(
        ([key, value]) =>
          Math.abs(value - (changes.phonation[key] ?? 0)) <= 0.34
      );
    }
    return redundant ? kept : [...kept, inside];
  });
}
