/**
 * Acoustic measures of accented speech (issue 57), used by
 * tests/accents-acoustics.test.js and experiments/issue-57-acoustics.mjs.
 * Every utterance is rendered on tier medium with seed 1; the segments come
 * from the plan of the synthesize() result.
 */

import { synthesize } from '../../src/synthesize.js';
import { decimate, rms } from '../../src/acoustics/analysis.js';
import { yinPitch } from '../../src/analysis/voice-features.js';
import { powerFrames } from '../../src/metrics/spectrum.js';

export const ACCENT_TIER = 'medium';
export const ACCENT_SEED = 1;

/** Render `text` in `lang` with an accent option (tier medium, seed 1). */
export function renderAccent(text, lang, accent) {
  return synthesize(text, {
    lang,
    accent,
    tier: ACCENT_TIER,
    seed: ACCENT_SEED,
  });
}

const at = (time, sampleRate) => Math.round(time * sampleRate);
const decibels = (value) => 20 * Math.log10(Math.max(value, 1e-12));

/** The consonant segments (closures and constrictions, not releases). */
export function consonants(result) {
  return result.plan.segments.filter((segment) => segment.kind === 'consonant');
}

/** The vowel segments. */
export function vowels(result) {
  return result.plan.segments.filter((segment) => segment.kind === 'vowel');
}

/** RMS level of a time span (dB). */
export function spanLevel(result, start, end) {
  const { samples, sampleRate } = result;
  return decibels(rms(samples, at(start, sampleRate), at(end, sampleRate)));
}

/**
 * How far the quietest 10 ms of a consonant lies below the following vowel
 * (dB): a closure is far below it (a silent stop), a fricative or an
 * approximant much less. Windows step by 1 ms.
 */
export function consonantDip(result, consonant) {
  const vowel = vowels(result).find(
    (segment) => segment.start >= consonant.end
  );
  const vowelLevel = spanLevel(result, vowel.start, vowel.end);
  let lowest = Infinity;
  for (
    let time = consonant.start;
    time + 0.01 <= consonant.end;
    time += 0.001
  ) {
    lowest = Math.min(lowest, spanLevel(result, time, time + 0.01));
  }
  return vowelLevel - lowest;
}

/**
 * Frames of 10 ms every `hop` seconds with their level (dB) and the YIN
 * aperiodicity and f0 of the 30 ms around them, at 11025 Hz.
 */
function frames(result, start, end, hop = 0.01) {
  const { samples, sampleRate } = decimate(
    result.samples,
    result.sampleRate,
    11025
  );
  const length = Math.round(0.03 * sampleRate);
  const list = [];
  for (let time = start; time + 0.01 <= end; time += hop) {
    const from = at(time + 0.005, sampleRate) - Math.round(length / 2);
    const frame =
      from >= 0 ? yinPitch(samples, from, length, sampleRate) : null;
    list.push({
      time,
      level: decibels(
        rms(samples, at(time, sampleRate), at(time + 0.01, sampleRate))
      ),
      aperiodicity: frame?.aperiodicity ?? 1,
      f0: frame?.f0 ?? 0,
    });
  }
  return list;
}

/**
 * Whether each frame is voiced: periodic (YIN aperiodicity below 0.3, f0
 * from 60 to 400 Hz) and no more than 30 dB below the loudest vowel.
 */
function voicedFrames(result, start, end, hop) {
  const loudest = Math.max(
    ...vowels(result).map((vowel) => spanLevel(result, vowel.start, vowel.end))
  );
  return frames(result, start, end, hop).map(
    (frame) =>
      frame.aperiodicity < 0.3 &&
      frame.f0 >= 60 &&
      frame.f0 <= 400 &&
      frame.level > loudest - 30
  );
}

/** The share of voiced 10 ms frames (every 10 ms) in a segment. */
export function voicedShare(result, segment) {
  const voiced = voicedFrames(result, segment.start, segment.end);
  return voiced.filter(Boolean).length / Math.max(1, voiced.length);
}

/**
 * Time from the burst of a plosive to the onset of voicing (s). The burst
 * is the first 1 ms step after the middle of the closure whose 2 ms level
 * comes within 40 dB of the following vowel; voicing starts at the first
 * of three successive voiced frames (every 2.5 ms) after it.
 */
export function burstToVoicing(result, consonant) {
  const vowel = vowels(result).find(
    (segment) => segment.start >= consonant.end
  );
  const threshold = spanLevel(result, vowel.start, vowel.end) - 40;
  let burst = consonant.end;
  for (
    let time = (consonant.start + consonant.end) / 2;
    time < vowel.end;
    time += 0.001
  ) {
    if (spanLevel(result, time, time + 0.002) > threshold) {
      burst = time;
      break;
    }
  }
  const hop = 0.0025;
  const voiced = voicedFrames(result, burst, vowel.end, hop);
  for (let index = 0; index + 2 < voiced.length; index++) {
    if (voiced[index] && voiced[index + 1] && voiced[index + 2]) {
      return index * hop;
    }
  }
  return vowel.end - burst;
}

/** Amplitude-weighted spectral centroid of the middle 60 % of a segment (Hz). */
export function segmentCentroid(result, segment) {
  const { samples, sampleRate } = result;
  const span = segment.end - segment.start;
  const slice = samples.slice(
    at(segment.start + 0.2 * span, sampleRate),
    at(segment.end - 0.2 * span, sampleRate)
  );
  const list = powerFrames(slice, sampleRate);
  const size = list[0].length;
  let weighted = 0;
  let total = 0;
  for (let bin = 0; bin < size; bin++) {
    let power = 0;
    for (const frame of list) {
      power += frame[bin];
    }
    const amplitude = Math.sqrt(power / list.length);
    weighted += amplitude * ((bin * sampleRate) / (2 * (size - 1)));
    total += amplitude;
  }
  return weighted / (total || 1);
}

/**
 * The normalised pairwise variability index of successive vowel durations
 * within each phrase (the planned durations; 0 for even timing).
 */
export function vowelNpvi(result) {
  const durations = vowels(result).map((vowel) => vowel.end - vowel.start);
  let sum = 0;
  for (let index = 1; index < durations.length; index++) {
    const [a, b] = [durations[index - 1], durations[index]];
    sum += Math.abs(a - b) / ((a + b) / 2);
  }
  return (100 * sum) / Math.max(1, durations.length - 1);
}
