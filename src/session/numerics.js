/** Numerical reductions shared by the session's offline and streaming paths. Unlicense. */
import { HEAD_PARAMETERS } from '../head-config.js';

export const OFFSET_CHANNELS = ['height', 'backness', 'rounding'];
const limits = new Map(
  HEAD_PARAMETERS.map(({ key, min, max }) => [key, [min, max]])
);

export function bound(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function setParameter(head, key, value) {
  if (Number.isFinite(value)) {
    head[key] = bound(value, ...limits.get(key));
  }
}

export function quantile(values, q = 0.5) {
  if (!values.length) {
    return NaN;
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const index = q * (sorted.length - 1);
  const lower = Math.floor(index);
  return (
    sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower)
  );
}

export function semitones(value, reference) {
  return 12 * Math.log2(value / reference);
}

export function vowelPitch(values) {
  const accepted = [];
  const running = [];
  for (const value of values) {
    if (running.length && Math.abs(semitones(value, quantile(running))) > 9) {
      continue;
    }
    accepted.push(value);
    running.push(value);
    if (running.length > 101) {
      running.shift();
    }
  }
  return {
    pitch: quantile(accepted),
    pitchRange: semitones(quantile(accepted, 0.95), quantile(accepted, 0.05)),
  };
}

export function retainedWeight(voicedSeconds, halfLife) {
  return 2 ** (-voicedSeconds / halfLife);
}

export function jackknifeError(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / 4;
  return Math.sqrt(
    (3 / 4) * values.reduce((sum, value) => sum + (value - mean) ** 2, 0)
  );
}

export function parameterChanges(before, after) {
  return Object.fromEntries(
    HEAD_PARAMETERS.map(({ key, min, max }) => [
      key,
      normalizedChange(before[key], after[key], min, max),
    ])
  );
}

export function normalizedChange(before, after, min, max) {
  return Math.abs(after - before) / (max - min);
}

export function halfway(before, after) {
  const head = Object.fromEntries(
    HEAD_PARAMETERS.map(({ key }) => [
      key,
      (before.head[key] + after.head[key]) / 2,
    ])
  );
  const articulationOffsets = { ...before.articulationOffsets };
  for (const [ipa, offsets] of Object.entries(
    after.articulationOffsets ?? {}
  )) {
    const prior = Object.hasOwn(articulationOffsets, ipa)
      ? articulationOffsets[ipa]
      : {};
    articulationOffsets[ipa] = Object.fromEntries(
      OFFSET_CHANNELS.map((key) => [
        key,
        ((prior[key] ?? 0) + (offsets[key] ?? 0)) / 2,
      ])
    );
  }
  return { ...before, head, articulationOffsets };
}
