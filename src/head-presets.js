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
 *   JASA 101). Raising f0 alone gives a "high-pitched man";
 * - corrected for the vowel, H1*-A3* of women is 9.6 dB above that of men
 *   and H1*-H2* 3.1 dB (Hanson and Chuang 1999, JASA 106, table X), mostly
 *   through posterior glottal chinks. A 1 mm² chink on the female and child
 *   presets gives 10 dB, the laxer pulse 4-5 dB
 *   (experiments/issue-9-preset-source.mjs); men keep a closed glottis;
 * - the membranous vocal folds are about 1.5 cm long in men, 1 cm in women
 *   and 0.7 cm in children (Titze 1989, JASA 85(4)); foldLength is drawn
 *   last so that the other values of a seed stay those of earlier versions.
 */

const BASE_PRESETS = {
  male: {
    label: 'Male adult',
    ranges: {
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
      tenseness: [0.595, 0.64, 0.1],
      breathiness: [0.15, 0.12, 0.06],
      vibrato: [0.25, 0.25, 0.1],
      speechRate: [1, 1, 0.06],
      foldLength: [1.4, 1.6, 0.05],
    },
  },
  female: {
    label: 'Female adult',
    ranges: {
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
      tenseness: [0.55, 0.565, 0.1],
      breathiness: [0.3, 0.27, 0.07],
      vibrato: [0.25, 0.25, 0.1],
      speechRate: [1.02, 1.02, 0.06],
      aspirationLevel: [1.3, 1.3, 0.15],
      glottalChink: [1, 1, 0.4],
      foldLength: [0.9, 1.1, 0.05],
    },
  },
  child: {
    label: 'Child (about ten years)',
    ranges: {
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
      tenseness: [0.54, 0.54, 0.08],
      breathiness: [0.28, 0.28, 0.06],
      vibrato: [0.2, 0.2, 0.08],
      speechRate: [0.92, 0.92, 0.06],
      aspirationLevel: [1.2, 1.2, 0.15],
      glottalChink: [1, 1, 0.4],
      foldLength: [0.6, 0.8, 0.05],
    },
  },
};

/**
 * Speaker types derived from a base preset (issue 41): the tract length
 * (cm) and the pitch (Hz) of the typical (size 0.5) speaker.
 * - five-year-old children: tract about 11.5 cm (Fitch & Giedd 1999,
 *   JASA 106(3)), f0 about 260 Hz (Lee, Potamianos & Narayanan 1999,
 *   JASA 105(3));
 * - teenagers of about 14 to 15 years: the male tract and f0 are between
 *   those of children and men after the voice change, the female ones near
 *   those of women (Fitch & Giedd 1999; Lee et al. 1999);
 * - elderly speakers: f0 rises in men and falls in women, jitter and
 *   shimmer grow, the voice gets breathier and speech slower (Linville
 *   2001, Vocal Aging);
 * - singers: the tract gets shorter and f0 higher from bass to tenor and
 *   from alto to soprano (Roers, Mürbe & Sundberg 2009, J Voice 23(4),
 *   vocal tract and fold lengths of singers per voice type; mean speaking
 *   f0 per voice type).
 * The membranous folds are shorter in higher voices (Titze 1989, JASA
 * 85(4); Roers et al. 2009): foldLength scales with base pitch / pitch.
 */
const DERIVED_PRESETS = {
  child5: {
    base: 'child',
    label: 'Child (about five years)',
    tract: 11.5,
    pitch: 260,
  },
  teenMale: {
    base: 'male',
    label: 'Teenage boy',
    tract: 15.8,
    pitch: 130,
  },
  teenFemale: {
    base: 'female',
    label: 'Teenage girl',
    tract: 14.2,
    pitch: 220,
  },
  elderlyMale: {
    base: 'male',
    label: 'Elderly man',
    tract: 17.2,
    pitch: 125,
    elderly: true,
  },
  elderlyFemale: {
    base: 'female',
    label: 'Elderly woman',
    tract: 14.8,
    pitch: 175,
    elderly: true,
  },
  bass: { base: 'male', label: 'Bass', tract: 18.5, pitch: 95 },
  baritone: { base: 'male', label: 'Baritone', tract: 17.5, pitch: 110 },
  tenor: { base: 'male', label: 'Tenor', tract: 16.5, pitch: 135 },
  alto: { base: 'female', label: 'Alto', tract: 15.3, pitch: 185 },
  mezzo: { base: 'female', label: 'Mezzo-soprano', tract: 14.8, pitch: 210 },
  soprano: { base: 'female', label: 'Soprano', tract: 14.2, pitch: 240 },
};

/** Defaults of the values that the elderly presets change (head-config.js). */
const ADULT_SOURCE = { jitter: 0.4, shimmer: 3, breathiness: 0.2 };
/** Elderly voices: jitter and shimmer times this (Linville 2001). */
const ELDERLY_PERTURBATION = 1.5;
/** Elderly voices: breathiness plus this (Linville 2001). */
const ELDERLY_BREATHINESS = 0.1;
/** Elderly voices: speech rate (Linville 2001). */
const ELDERLY_RATE = 0.9;

/** `[small, large, spread]` scaled so the middle (size 0.5) is `middle`. */
function centred([small, large, spread], middle, geometric) {
  const centre = geometric ? Math.sqrt(small * large) : (small + large) / 2;
  return [(small * middle) / centre, (large * middle) / centre, spread];
}

function derivePreset({ base, label, tract, pitch, elderly }) {
  const { ranges } = BASE_PRESETS[base];
  const basePitch = Math.sqrt(ranges.pitch[0] * ranges.pitch[1]);
  const [foldSmall, foldLarge] = ranges.foldLength;
  const fold = (basePitch / pitch) * ((foldSmall + foldLarge) / 2);
  const result = {
    ...ranges,
    vocalTractLength: centred(ranges.vocalTractLength, tract, false),
    pitch: centred(ranges.pitch, pitch, true),
    foldLength: centred(ranges.foldLength, fold, false),
  };
  if (elderly) {
    const breathiness = ranges.breathiness ?? [0.2, 0.2, 0.06];
    Object.assign(result, {
      jitter: [ADULT_SOURCE.jitter * ELDERLY_PERTURBATION, 0, 0.1],
      shimmer: [ADULT_SOURCE.shimmer * ELDERLY_PERTURBATION, 0, 0.5],
      breathiness: [
        breathiness[0] + ELDERLY_BREATHINESS,
        breathiness[1] + ELDERLY_BREATHINESS,
        breathiness[2],
      ],
      speechRate: [ELDERLY_RATE, ELDERLY_RATE, ranges.speechRate[2]],
    });
    result.jitter[1] = result.jitter[0];
    result.shimmer[1] = result.shimmer[0];
  }
  for (const key of Object.keys(result)) {
    result[key] = Object.freeze(result[key]);
  }
  return Object.freeze({ label, base, ranges: Object.freeze(result) });
}

export const HEAD_PRESETS = Object.freeze({
  ...Object.fromEntries(
    Object.entries(BASE_PRESETS).map(([name, preset]) => [
      name,
      Object.freeze({
        label: preset.label,
        ranges: Object.freeze(
          Object.fromEntries(
            Object.entries(preset.ranges).map(([key, range]) => [
              key,
              Object.freeze(range),
            ])
          )
        ),
      }),
    ])
  ),
  ...Object.fromEntries(
    Object.entries(DERIVED_PRESETS).map(([name, entry]) => [
      name,
      derivePreset(entry),
    ])
  ),
});

/** Preset names accepted by randomHeadConfig ('any' keeps the wide range). */
export const HEAD_PRESET_NAMES = Object.freeze([
  'any',
  ...Object.keys(HEAD_PRESETS),
]);
