/**
 * Compare two recordings: align them with DTW on mel cepstra and report
 * spectral, pitch, formant and timing distances along the alignment.
 */

import { resample } from '../audio/resample.js';
import {
  SILENCE_DB,
  logSpectralDistanceOfFrames,
  melCepstralDistance,
  scaleRms,
  silentFrames,
} from './distortion.js';
import { dtw } from './dtw.js';
import { formantErrors, formantTrack } from './formants.js';
import { f0Errors, pitchTrack } from './pitch.js';
import {
  METRIC_DEFAULTS,
  cepstra,
  frameSettings,
  powerFrames,
} from './spectrum.js';

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
  const from = first * hop;
  const to = Math.min(samples.length, last * hop + length);
  const trimmed = new Float64Array(to - from);
  for (let i = from; i < to; i++) {
    trimmed[i - from] = samples[i];
  }
  return trimmed;
}

function prepare(recording, rate, options) {
  const converted =
    recording.sampleRate === rate
      ? recording.samples
      : resample(recording.samples, recording.sampleRate, rate);
  const trimmed = trimSilence(converted, rate, options);
  return scaleRms(trimmed, trimmed);
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

function alignSpectra(reference, test, rate, settings, band) {
  const powerR = powerFrames(reference, rate, settings);
  const powerT = powerFrames(test, rate, settings);
  const cepstraR = cepstra(powerR, rate, settings);
  const cepstraT = cepstra(powerT, rate, settings);
  const aligned = dtw(
    cepstraR.map((frame) => frame.subarray(1)),
    cepstraT.map((frame) => frame.subarray(1)),
    { band }
  );
  const silent = silentFrames(powerR);
  return {
    ...aligned,
    referenceFrames: cepstraR.length,
    testFrames: cepstraT.length,
    lsd: logSpectralDistanceOfFrames(
      powerR,
      powerT,
      aligned.path,
      silent,
      settings.range
    ),
    mcd: melCepstralDistance(cepstraR, cepstraT, aligned.path, silent),
  };
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
  const settings = {
    window: options.window,
    hop: options.hop,
    range: options.range,
  };
  const ref = prepare(reference, rate, settings);
  const tst = prepare(test, rate, settings);
  if (ref.length === 0 || tst.length === 0) {
    throw new RangeError('compareRecordings: a recording has no samples');
  }
  const hop = frameSettings(rate, settings).hop / rate;
  const aligned = alignSpectra(ref, tst, rate, settings, options.band);
  const { path, referenceFrames: n } = aligned;

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
    lsd: aligned.lsd,
    mcd: aligned.mcd,
    f0,
    formants,
    timing: timingErrors(path, hop, durationT / durationR),
    dtw: { normalizedCost: aligned.normalizedCost },
    frames: { reference: n, test: aligned.testFrames, path: path.length },
  };
}
