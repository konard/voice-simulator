/**
 * Randomization presets for typical speaker groups.
 *
 * Every range is `[small, large, spread]`: a preset person is drawn with a
 * body-size factor between 0 (small) and 1 (large), each value is
 * interpolated between `small` and `large` and then jittered by a normal
 * deviate scaled by `spread`. Pitch is interpolated on a log scale and its
 * spread is in semitones.
 *
 * Anchors (see docs/case-studies/issue-5/research/anatomy-and-acoustics.md):
 * - mean f0 of men, women and 10-12 year old children is about 131, 220 and
 *   237 Hz (Hillenbrand et al. 1995, JASA 97(5), table I);
 * - vocal tract length is about 17-18 cm for men and about 15 cm for
 *   women, and grows through childhood (Vorperian et al. 2009, JASA 125(3);
 *   Fitch and Giedd 1999, JASA 106(3));
 * - the male pharynx grows more after puberty, so the pharynx/oral ratio is
 *   lower for women and children (Fant 1966; Vorperian et al. 2009);
 * - the vocal tract anatomy of the mid-size female and child heads (length,
 *   pharynx ratio, widths, tongue, jaw and lips) is fitted within those
 *   anatomical bounds so that the eleven measured vowels, piriform fossae
 *   included, resonate at the mean F1-F3 of the women and children of
 *   Hillenbrand et al. (1995), as the measured shapes do for the men
 *   (experiments/issue-9-preset-fit.mjs, rms error about 5%);
 * - female voices are on average breathier, with a laxer (higher Rd) pulse
 *   and more aspiration noise (Klatt and Klatt 1990, JASA 87; Hanson 1997,
 *   JASA 101). Raising f0 alone gives a "high-pitched man".
 */

export const HEAD_PRESETS = Object.freeze({
  male: Object.freeze({
    label: 'Male adult',
    ranges: Object.freeze({
      vocalTractLength: [16.2, 18.2, 0.4],
      pharynxRatio: [0.47, 0.52, 0.015],
      pharynxWidth: [1.02, 1.15, 0.05],
      oralWidth: [1, 1.08, 0.05],
      mouthWidth: [1, 1.1, 0.08],
      lipThickness: [0.95, 1.05, 0.15],
      jawRange: [1, 1.06, 0.08],
      tongueSize: [1, 1.08, 0.04],
      nasalSize: [1.05, 1.2, 0.07],
      headWidth: [1.02, 1.1, 0.03],
      headHeight: [1.02, 1.1, 0.03],
      noseLength: [1, 1.15, 0.1],
      pitch: [140, 100, 1.5],
      pitchRange: [3, 3, 0.7],
      tenseness: [0.62, 0.68, 0.1],
      breathiness: [0.15, 0.12, 0.06],
      vibrato: [0.25, 0.25, 0.1],
      speechRate: [1, 1, 0.06],
    }),
  }),
  female: Object.freeze({
    label: 'Female adult',
    ranges: Object.freeze({
      vocalTractLength: [14, 15.6, 0.35],
      pharynxRatio: [0.455, 0.485, 0.015],
      pharynxWidth: [0.76, 0.84, 0.04],
      oralWidth: [0.78, 0.86, 0.05],
      mouthWidth: [0.98, 1.06, 0.08],
      lipThickness: [1.02, 1.1, 0.15],
      jawRange: [0.89, 0.95, 0.08],
      tongueSize: [0.99, 1.05, 0.04],
      nasalSize: [0.85, 0.95, 0.06],
      headWidth: [0.93, 0.98, 0.03],
      headHeight: [0.93, 0.98, 0.03],
      noseLength: [0.86, 0.98, 0.1],
      pitch: [240, 195, 1.5],
      pitchRange: [3.6, 3.6, 0.8],
      tenseness: [0.5, 0.53, 0.1],
      breathiness: [0.3, 0.27, 0.07],
      vibrato: [0.25, 0.25, 0.1],
      speechRate: [1.02, 1.02, 0.06],
      aspirationLevel: [1.3, 1.3, 0.15],
    }),
  }),
  child: Object.freeze({
    label: 'Child (about ten years)',
    ranges: Object.freeze({
      vocalTractLength: [13, 14.6, 0.35],
      pharynxRatio: [0.46, 0.5, 0.015],
      pharynxWidth: [0.71, 0.79, 0.04],
      oralWidth: [0.735, 0.805, 0.05],
      mouthWidth: [0.96, 1.04, 0.06],
      lipThickness: [0.9, 1, 0.1],
      jawRange: [0.865, 0.935, 0.06],
      tongueSize: [1.035, 1.085, 0.03],
      nasalSize: [0.68, 0.78, 0.05],
      headWidth: [0.86, 0.92, 0.02],
      headHeight: [0.86, 0.92, 0.02],
      noseLength: [0.75, 0.85, 0.06],
      pitch: [265, 215, 1.5],
      pitchRange: [4, 4, 0.8],
      tenseness: [0.5, 0.5, 0.08],
      breathiness: [0.28, 0.28, 0.06],
      vibrato: [0.2, 0.2, 0.08],
      speechRate: [0.92, 0.92, 0.06],
      aspirationLevel: [1.2, 1.2, 0.15],
    }),
  }),
});

/** Preset names accepted by randomHeadConfig ('any' keeps the wide range). */
export const HEAD_PRESET_NAMES = Object.freeze([
  'any',
  ...Object.keys(HEAD_PRESETS),
]);
