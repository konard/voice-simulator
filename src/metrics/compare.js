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
  powerFramesInto,
} from './spectrum.js';

// The waveforms and power frames never leave a comparison. Retain one
// bounded buffer for each input and take separate storage on reentry.
const MAX_RETAINED_VALUES = 128 * 1024;
let idleStorage = createComparisonStorage();

function reusableColumn() {
  let buffer = new Float64Array(0);
  return (length) => {
    if (length > MAX_RETAINED_VALUES) {
      return new Float64Array(length);
    }
    if (length > buffer.length) {
      buffer = new Float64Array(
        Math.min(MAX_RETAINED_VALUES, Math.max(length, buffer.length * 2))
      );
    }
    return buffer.subarray(0, length);
  };
}

function createComparisonStorage() {
  return {
    waveR: reusableColumn(),
    waveT: reusableColumn(),
    powerR: reusableColumn(),
    powerT: reusableColumn(),
  };
}

/**
 * Cut the frames at both ends whose energy is more than SILENCE_DB below
 * the loudest frame. A signal without sound is returned unchanged.
 * @param {ArrayLike<number>} samples
 * @param {number} sampleRate
 * @param {{window?: number, hop?: number}} [options]
 * @returns {Float64Array}
 */
export function trimSilence(samples, sampleRate, options = {}) {
  return trimAudio(samples, sampleRate, options);
}

function trimAudio(samples, sampleRate, options, allocate) {
  const { length, hop } = frameSettings(sampleRate, options);
  const energies = new Float64Array(Math.ceil(samples.length / hop));
  let count = 0;
  let loudest = 0;
  for (let start = 0; start < samples.length; start += hop) {
    let sum = 0;
    const end = Math.min(samples.length, start + length);
    for (let index = start; index < end; index++) {
      sum += samples[index] * samples[index];
    }
    energies[count++] = sum;
    loudest = Math.max(loudest, sum);
    if (end === samples.length) {
      break;
    }
  }
  if (!(loudest > 0)) {
    return Float64Array.from(samples);
  }
  const threshold = loudest * 10 ** (-SILENCE_DB / 10);
  let first = 0;
  let last = count - 1;
  while (energies[first] < threshold) {
    first++;
  }
  while (energies[last] < threshold) {
    last--;
  }
  const from = first * hop;
  const to = Math.min(samples.length, last * hop + length);
  const trimmed = allocate?.(to - from) ?? new Float64Array(to - from);
  for (let i = from; i < to; i++) {
    trimmed[i - from] = samples[i];
  }
  return trimmed;
}

function prepare(recording, rate, options, allocate) {
  const converted =
    recording.sampleRate === rate
      ? recording.samples
      : resample(recording.samples, recording.sampleRate, rate);
  const trimmed = trimAudio(converted, rate, options, allocate);
  return scaleRms(trimmed, trimmed);
}

/**
 * Test-track value paired with each reference frame along a path (the first
 * pair of a reference frame wins).
 */
function warpTrack(track, path, warped, empty) {
  let previous = -1;
  for (const [i, j] of path) {
    // DTW visits reference frames in order.
    if (i !== previous) {
      warped[i] = track[j] ?? empty;
      previous = i;
    }
  }
  return warped;
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

function alignSpectra(reference, test, rate, settings, band, storage) {
  const powerR = powerFramesInto(reference, rate, settings, storage.powerR);
  const powerT = powerFramesInto(test, rate, settings, storage.powerT);
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
  const storage = idleStorage ?? createComparisonStorage();
  idleStorage = null;
  try {
    return compareWithStorage(reference, test, options, storage);
  } finally {
    idleStorage = storage;
  }
}

function compareWithStorage(reference, test, options, storage) {
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
  const ref = prepare(reference, rate, settings, storage.waveR);
  const tst = prepare(test, rate, settings, storage.waveT);
  if (ref.length === 0 || tst.length === 0) {
    throw new RangeError('compareRecordings: a recording has no samples');
  }
  const hop = frameSettings(rate, settings).hop / rate;
  const aligned = alignSpectra(ref, tst, rate, settings, options.band, storage);
  const { path, referenceFrames: n } = aligned;

  const pitchR = pitchTrack(ref, rate, { hop });
  const pitchT = pitchTrack(tst, rate, { hop });
  const f0 = f0Errors(
    pitchR.subarray(0, n),
    warpTrack(pitchT, path, new Float64Array(n), 0)
  );

  let formants = null;
  if (options.formants !== false) {
    const formantsR = formantTrack(ref, rate, { hop, pitch: pitchR });
    const formantsT = formantTrack(tst, rate, { hop, pitch: pitchT });
    formants = formantErrors(
      formantsR.slice(0, n),
      warpTrack(formantsT, path, new Array(n).fill(null), null)
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
