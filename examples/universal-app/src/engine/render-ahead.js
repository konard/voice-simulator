/**
 * Render ahead: when the simulation is slower than real time (the 3D
 * tiers on most devices), playback waits until the rest of the utterance
 * is predicted to be rendered before the player reaches it, so the voice
 * plays without gaps on the chosen tier.
 *
 * If playback starts once `rendered` of `total` samples exist and the
 * renderer keeps its measured load L (render time / audio time), the
 * renderer reaches sample s after (s - rendered) L / rate seconds and the
 * player after s / rate; it stays ahead for every s up to `total` when
 * rendered >= total (1 - 1 / L).
 */

/** Margin on the measured load (the load varies along an utterance). */
export const RENDER_AHEAD_SAFETY = 1.2;
/** Seconds of audio to measure before trusting the load. */
const MIN_MEASURED = 0.05;

/**
 * Whether playback can start.
 * @param {{rendered: number, total: number, busy: number, sampleRate: number, safety?: number}} progress
 *   `rendered` and `total` in samples, `busy` the seconds spent rendering.
 */
export function readyToPlay({ rendered, total, busy, sampleRate, safety }) {
  if (rendered >= total) {
    return true;
  }
  const audio = rendered / sampleRate;
  if (audio < MIN_MEASURED) {
    return false;
  }
  const load = (busy / audio) * (safety ?? RENDER_AHEAD_SAFETY);
  return load <= 1 || rendered >= total * (1 - 1 / load);
}

/**
 * Seconds until playback can start at the measured load, or 0.
 * @param {{rendered: number, total: number, busy: number, sampleRate: number, safety?: number}} progress
 */
export function secondsToPlay({ rendered, total, busy, sampleRate, safety }) {
  if (rendered === 0) {
    return Infinity;
  }
  const load =
    (busy / (rendered / sampleRate)) * (safety ?? RENDER_AHEAD_SAFETY);
  const needed = load <= 1 ? 0 : total * (1 - 1 / load);
  return Math.max(0, ((needed - rendered) / sampleRate) * load);
}
