/**
 * Compare two recordings: align them with DTW on mel cepstra and report
 * spectral, pitch, formant and timing distances along the alignment.
 */

import { resample } from '../audio/resample.js';
import {
  NORMALIZED_RMS,
  SILENCE_DB,
  logSpectralDistance,
  melCepstralDistortion,
  normalizeRms,
} from './distortion.js';
import { dtw } from './dtw.js';
import { formantErrors, formantTrack } from './formants.js';
import { f0Errors, pitchTrack } from './pitch.js';
import { METRIC_DEFAULTS, frameSettings, mfcc } from './spectrum.js';

/**
 * Cut the frames at both ends whose energy is more than SILENCE_DB below
 * the loudest frame. A signal without sound is returned unchanged.
 * @param {ArrayLike<number>} samples
 * @param {number} sampleRate
 * @param {{window?: number, hop?: number}} [options]
 * @returns {Float64Array}
 */
export function trimSilence(samples, sampleRate, options = {}) {
  const { length, hop } = frameSettings(sampleRate, options);
  const energies = [];
  for (let start = 0; start < samples.length; start += hop) {
    let sum = 0;
    const end = Math.min(samples.length, start + length);
    for (let index = start; index < end; index++) {
      sum += samples[index] * samples[index];
    }
    energies.push(sum);
    if (end === samples.length) {
      break;
    }
  }
  const loudest = energies.reduce((max, energy) => Math.max(max, energy), 0);
  if (!(loudest > 0)) {
    return Float64Array.from(samples);
  }
  const threshold = loudest * 10 ** (-SILENCE_DB / 10);
  const first = energies.findIndex((energy) => energy >= threshold);
  const last = energies.findLastIndex((energy) => energy >= threshold);
  return Float64Array.from(
    Array.prototype.slice.call(
      samples,
      first * hop,
      Math.min(samples.length, last * hop + length)
    )
  );
}

function prepare(recording, rate, options) {
  const converted =
    recording.sampleRate === rate
      ? recording.samples
      : resample(recording.samples, recording.sampleRate, rate);
  return normalizeRms(trimSilence(converted, rate, options), NORMALIZED_RMS);
}

/**
 * Test-track value paired with each reference frame along a path (the first
 * pair of a reference frame wins).
 */
function warpTrack(track, path, length, empty) {
  const warped = new Array(length).fill(undefined);
  for (const [i, j] of path) {
    if (warped[i] === undefined) {
      warped[i] = track[j] ?? empty;
    }
  }
  return warped.map((value) => value ?? empty);
}

function timingErrors(path, hop, ratio) {
  let sum = 0;
  let max = 0;
  for (const [i, j] of path) {
    const delta = j * hop - i * hop * ratio;
    sum += delta * delta;
    max = Math.max(max, Math.abs(delta));
  }
  return { rmsSeconds: Math.sqrt(sum / path.length), maxSeconds: max };
}

/**
 * Compare a test recording with a reference recording.
 *
 * Both are resampled to min(16000, both rates), silence is cut from both
 * ends (frames more than 40 dB below the loudest), both are scaled to an RMS
 * of 0.1 and aligned by DTW on the MFCC c[1] .. c[13]. LSD and MCD are taken
 * along the path; pitch and formant tracks compare each reference frame with
 * the first test frame paired with it; the timing error of a pair is
 * j hop - i hop Tt / Tr.
 * @param {{samples: ArrayLike<number>, sampleRate: number}} reference
 * @param {{samples: ArrayLike<number>, sampleRate: number}} test
 * @param {{band?: number, window?: number, hop?: number, formants?: boolean}} [options]
 *   band limits the DTW path (default 1 = no limit); formants: false skips
 *   the formant tracks.
 */
export function compareRecordings(reference, test, options = {}) {
  const rate = Math.min(
    METRIC_DEFAULTS.sampleRate,
    reference.sampleRate,
    test.sampleRate
  );
  const settings = { window: options.window, hop: options.hop };
  const ref = prepare(reference, rate, settings);
  const tst = prepare(test, rate, settings);
  if (ref.length === 0 || tst.length === 0) {
    throw new RangeError('compareRecordings: a recording has no samples');
  }
  const hop = frameSettings(rate, settings).hop / rate;
  const cepstraR = mfcc(ref, rate, settings).map((c) => c.subarray(1));
  const cepstraT = mfcc(tst, rate, settings).map((c) => c.subarray(1));
  const aligned = dtw(cepstraR, cepstraT, { band: options.band });
  const { path } = aligned;
  const along = { ...settings, path, normalize: false };
  const n = cepstraR.length;

  const pitchR = pitchTrack(ref, rate, { hop });
  const pitchT = pitchTrack(tst, rate, { hop });
  const f0 = f0Errors(pitchR.subarray(0, n), warpTrack(pitchT, path, n, 0));

  let formants = null;
  if (options.formants !== false) {
    const formantsR = formantTrack(ref, rate, { hop, pitch: pitchR });
    const formantsT = formantTrack(tst, rate, { hop, pitch: pitchT });
    formants = formantErrors(
      formantsR.slice(0, n),
      warpTrack(formantsT, path, n, null)
    );
  }

  const durationR = ref.length / rate;
  const durationT = tst.length / rate;
  return {
    sampleRate: rate,
    duration: {
      reference: durationR,
      test: durationT,
      ratio: durationT / durationR,
    },
    lsd: logSpectralDistance(ref, tst, rate, along),
    mcd: melCepstralDistortion(ref, tst, rate, along),
    f0,
    formants,
    timing: timingErrors(path, hop, durationT / durationR),
    dtw: { normalizedCost: aligned.normalizedCost },
    frames: { reference: n, test: cepstraT.length, path: path.length },
  };
}
