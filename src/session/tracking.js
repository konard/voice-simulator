/** Track a stable speaker in voiced time and compare recent audio with the fit. Unlicense. */
import { quantile, retainedWeight, semitones } from './numerics.js';
import { refit } from './refine.js';

export function createSpeakerTracking({ sampleRate, halfLife, driftFactor }) {
  let pitch;
  let recentDistances;
  let baseline;
  let observedVoiced;
  let averaged;
  let tokensThrough;
  let hasVoiced;

  function clear() {
    pitch = [];
    recentDistances = [];
    baseline = Infinity;
    observedVoiced = 0;
    averaged = null;
    tokensThrough = 0;
    hasVoiced = false;
  }

  function smooth(voice, tokens, voiced) {
    const latest = refit(voice, tokens);
    const retain = retainedWeight(voiced - observedVoiced, halfLife);
    observedVoiced = voiced;
    averaged ??= voice.head;
    const head = Object.fromEntries(
      Object.keys(averaged).map((key) => [
        key,
        averaged[key] * retain + latest.head[key] * (1 - retain),
      ])
    );
    averaged = head;
    return { ...latest, head };
  }

  clear();
  return {
    clear,
    start(distance, voiced) {
      clear();
      baseline = distance;
      observedVoiced = voiced;
    },
    get hasVoiced() {
      return hasVoiced;
    },
    addPitch(values) {
      if (values.length) {
        hasVoiced = true;
        pitch = pitch.concat(values).slice(-300);
      }
    },
    pitchChanged(reference) {
      return (
        pitch.length >= 300 &&
        Math.abs(semitones(quantile(pitch.map(({ f0 }) => f0)), reference)) > 4
      );
    },
    observe({ tokens, distance, samples }, voice, captured, voiced) {
      hasVoiced = false;
      const from = (captured - samples.length) / sampleRate;
      const time = captured / sampleRate;
      const recent = tokens.filter(({ end }) => from + end >= pitch[0]?.time);
      const ratios = recent
        .map(({ tractRatio }) => tractRatio)
        .filter(Number.isFinite);
      const tractRatio = quantile(ratios);
      if (
        pitch.length >= 300 &&
        ratios.length >= 3 &&
        Math.abs(tractRatio - 1) > 0.08
      ) {
        return { speakerChanged: true };
      }
      recentDistances.push({ time, distance });
      recentDistances = recentDistances.filter(
        (entry) => entry.time > time - 5
      );
      const mean =
        recentDistances.reduce((sum, entry) => sum + entry.distance, 0) /
        recentDistances.length;
      if (recentDistances.length >= 5 && mean > baseline * driftFactor) {
        return { drift: true };
      }
      const fresh = tokens.filter(({ end }) => from + end > tokensThrough);
      tokensThrough = time;
      return fresh.length ? { candidate: smooth(voice, fresh, voiced) } : null;
    },
  };
}
