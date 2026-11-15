/**
 * Formant track of a recording (LPC peaks of voiced frames) and the mean
 * formant errors between two tracks.
 */

import { estimateFormants } from '../acoustics/analysis.js';
import { pitchTrack } from './pitch.js';

const NAMES = ['f1', 'f2', 'f3'];

/**
 * F1-F3 (Hz) every `hop` seconds from `estimateFormants` on 0.03 s starting
 * at t * hop; null for frames that `pitchTrack` finds unvoiced. A list can
 * hold fewer than three values when the LPC envelope has fewer peaks.
 * @param {ArrayLike<number>} samples
 * @param {number} sampleRate
 * @param {{hop?: number, pitch?: ArrayLike<number>}} [options] pitch is a
 *   precomputed pitchTrack with the same hop.
 * @returns {(number[]|null)[]}
 */
export function formantTrack(samples, sampleRate, options = {}) {
  const hop = options.hop ?? 0.01;
  const pitch = options.pitch ?? pitchTrack(samples, sampleRate, { hop });
  return Array.from(pitch, (f0, frame) =>
    f0 > 0
      ? estimateFormants(samples, sampleRate, {
          start: frame * hop,
          duration: 0.03,
          count: 3,
        })
      : null
  );
}

/**
 * Mean absolute F1, F2 and F3 differences, in Hz and in percent of the
 * reference, over the frames that have formants in both tracks.
 * @param {(ArrayLike<number>|null)[]} reference
 * @param {(ArrayLike<number>|null)[]} test
 * @returns {{f1: {hz: number|null, percent: number|null}, f2: {hz: number|null, percent: number|null}, f3: {hz: number|null, percent: number|null}, frames: number}}
 */
export function formantErrors(reference, test) {
  const length = Math.min(reference.length, test.length);
  const sums = NAMES.map(() => ({ hz: 0, percent: 0, count: 0 }));
  let frames = 0;
  for (let index = 0; index < length; index++) {
    const r = reference[index];
    const t = test[index];
    if (!r || !t || r.length === 0 || t.length === 0) {
      continue;
    }
    frames++;
    sums.forEach((sum, formant) => {
      if (r[formant] > 0 && t[formant] > 0) {
        const delta = Math.abs(t[formant] - r[formant]);
        sum.hz += delta;
        sum.percent += (100 * delta) / r[formant];
        sum.count++;
      }
    });
  }
  const result = { frames };
  NAMES.forEach((name, formant) => {
    const { hz, percent, count } = sums[formant];
    result[name] = {
      hz: count ? hz / count : null,
      percent: count ? percent / count : null,
    };
  });
  return result;
}
