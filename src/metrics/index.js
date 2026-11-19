/**
 * Objective speech metrics (issue 18): distances between two recordings
 * (spectrum, pitch, formants, timing) and between two transcripts (word,
 * character and phoneme error rates). Plain mathematics, no dependency.
 */

export {
  DYNAMIC_RANGE_DB,
  EPSILON,
  METRIC_DEFAULTS,
  cepstra,
  fft,
  hzToMel,
  melFilterbank,
  melToHz,
  mfcc,
  nextPowerOfTwo,
  powerFloor,
  powerFrames,
} from './spectrum.js';
export { DTW_MAX_CELLS, dtw, euclideanDistance } from './dtw.js';
export {
  constantCepstrumDistortion,
  logSpectralDistance,
  melCepstralDistortion,
  normalizeRms,
} from './distortion.js';
export { f0Errors, pitchTrack } from './pitch.js';
export { formantErrors, formantTrack } from './formants.js';
export { editDistance, errorRate, tokenize } from './text.js';
export { compareRecordings, trimSilence } from './compare.js';
