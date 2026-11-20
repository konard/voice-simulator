import { quantile } from './mode-features.js';

export const mean = (values) =>
  values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
export const span = (values) => quantile(values, 0.95) - quantile(values, 0.05);
export const pitchAt = (track, i) => track.startTime + i * track.hop;

export function frameSlice(track, values, start, end) {
  const first = Math.max(
    0,
    Math.ceil((start - track.startTime) / track.hop - 1e-9)
  );
  const last = Math.max(
    first,
    Math.ceil((end - track.startTime) / track.hop - 1e-9)
  );
  return values.slice(first, last);
}

export function voicedBetween(pitch, start, end) {
  return frameSlice(pitch, pitch.semitones, start, end).filter(
    (value) => value !== null
  );
}

export function bestTone(tones) {
  let best = '';
  let cost = Infinity;
  for (const [tone, score] of Object.entries(tones ?? {})) {
    if (score < cost) {
      best = tone;
      cost = score;
    }
  }
  return best;
}
