/**
 * MRI shape of the vocal tract, built by scripts/build-tract-template.mjs
 * from the CC0 tracts of the Dresden Vocal Tract Dataset (Birkholz et al.
 * 2020, Scientific Data 7, 255) hosted in tests/fixtures/dvtd. Do not edit
 * by hand.
 *
 * Both profiles are sampled at 41 equal steps of a remapped arc
 * length that puts the 45° point of the bend half way along: the glottis
 * to the bend is the first half, the bend to the lips the second.
 */

export const TRACT_TEMPLATE = Object.freeze({
  /**
   * Midsagittal angle of the centreline (degrees, 0 = up, 90 = forward),
   * mean of the schwa tracts with the pharynx turned vertical.
   */
  bendAngles: Object.freeze([
    -0.9, -0.2, 0.3, -2.5, -12.5, -22.7, -28, -24.4, -14.2, -4.1, 2.9, 9.6,
    16.5, 22.8, 24.8, 23.1, 23.8, 27.8, 30, 34.6, 45, 53.6, 58.5, 64, 70.8, 77,
    81.7, 86.2, 88.7, 91, 96.1, 105.5, 116.5, 127.1, 134.3, 138.5, 139.9, 134.5,
    123, 115.8, 115.9,
  ]),
  /**
   * Lateral width over midsagittal depth of the cross-section, mean of all
   * tracts.
   */
  aspects: Object.freeze([
    1, 1.08, 1.3, 1.64, 1.97, 2.14, 2.16, 2.08, 2.03, 1.98, 1.91, 1.83, 1.74,
    1.67, 1.6, 1.53, 1.46, 1.4, 1.36, 1.34, 1.38, 1.52, 1.76, 2.01, 2.24, 2.49,
    2.79, 3.06, 3.2, 3.13, 2.93, 2.75, 2.67, 2.7, 2.8, 2.97, 3.23, 3.61, 4.03,
    4.33, 4.43,
  ]),
  /** Arc fraction of the 45° point of the bend in each tract. */
  bendFractions: Object.freeze({
    's1-01-bahn-tense-a': 0.402,
    's1-03-tiere-tense-i': 0.548,
    's1-22-ehe-schwa': 0.559,
    's2-01-bahn-tense-a': 0.409,
    's2-03-tiere-tense-i': 0.468,
    's2-22-ehe-schwa': 0.444,
  }),
});
