/** Simulator calibration. Unlicense. Reproduce with experiments/issue-63/calibrate.mjs, cpp-calibrate.mjs, speech-time-calibrate.mjs, pitch-range-calibrate.mjs and tenseness-calibrate.mjs. */
export const MATCH_TEXT =
  'Please call Stella and ask her to bring these things with her.';
// MATCH_TEXT, default head, seed 1, waveguide, 16000 Hz, JS engine.
// Default pitchRange 3 divided by the measured 5th–95th percentile range.
export const PITCH_RANGE_FACTOR = 3 / 7.146042124836602;
// findLandmarks nuclei per speech second (activeDuration + 0.03) of the
// same render; experiments/issue-63/calibrate.mjs prints landmarkNuclei.
export const DEFAULT_SYLLABLE_RATE = 16 / 3.27;
// Median inverse-filter CPP (dB) of MATCH_TEXT on the default head at each
// pitch (Hz) and breathiness (experiments/issue-63/cpp-calibrate.txt). The
// inverse-filter HNR the issue names falls by 1.5 to 3.5 dB with low pitch,
// high tenseness or a male head at fixed breathiness, as much as from 0.2 to
// 0.6 breathiness (experiments/issue-63/hnr-dependence.txt). CPP falls with
// breathiness at every pitch; conditioning on the measured pitch removes its
// pitch dependence.
export const BREATHINESS_CPP = {
  breathiness: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
  pitch: [80, 110, 150, 210, 290],
  cpp: [
    [
      1.734, 1.659, 1.354, 0.984, 0.758, 0.687, 0.663, 0.657, 0.645, 0.645,
      0.644,
    ],
    [
      2.701, 2.687, 2.348, 1.836, 1.338, 1.067, 0.923, 0.854, 0.813, 0.778,
      0.767,
    ],
    [
      4.074, 3.958, 3.721, 2.931, 2.122, 1.589, 1.273, 1.113, 1.043, 0.99,
      0.948,
    ],
    [
      4.91, 4.892, 4.505, 3.655, 2.733, 1.988, 1.563, 1.311, 1.186, 1.094,
      1.038,
    ],
    [
      4.542, 4.355, 4.127, 3.595, 2.885, 2.203, 1.751, 1.475, 1.29, 1.173,
      1.116,
    ],
  ],
};
// Measured speech seconds (activeDuration + 0.03) of default-head renders
// = slope * planned seconds from first to last sound + offset; four texts at
// speechRate 0.8, 1 and 1.25 (experiments/issue-63/speech-time-calibrate.mjs).
export const SPEECH_TIME = { slope: 0.805, offset: 0.267 };
// Measured 5th-95th percentile f0 range (semitones) of renders over the
// range of the planned f0 of voiced frames: median of three texts, pitch 100
// and 210 Hz, pitchRange 2, 3 and 4.5 (0.94 to 1.25 without the one octave
// error; experiments/issue-63/pitch-range-calibrate.txt).
export const PLANNED_RANGE_RATIO = 1.05;
// Median inverse-filter rd (0.05 bins) of MATCH_TEXT on the default head
// by pitch (Hz), breathiness and tenseness, rd[pitch][breathiness][tenseness]
// (experiments/issue-63/tenseness-calibrate.txt). The issue names
// tenseness = 1 - median(rd)/3, but the measured rd is compressed (0.5 to
// 1.4 for an LF Rd of 0.45 to 2.4), rises with breathiness beyond its Rd
// term and saturates near 0.85 above about 210 Hz (experiments/issue-63/
// rd-calibrate.txt). 0 marks a render without rd frames.
export const TENSENESS_RD = {
  tenseness: [0.2, 0.35, 0.5, 0.65, 0.8, 0.95],
  breathiness: [0.1, 0.4, 0.7, 1],
  pitch: [80, 110, 150, 210, 290],
  bin: 0.05,
  rd: [
    [
      [0.9, 0.85, 0.8, 0.6, 0.5, 0.5],
      [1.2, 1, 0.9, 0.8, 0.6, 0.5],
      [1.3, 1.4, 1.25, 1.15, 0.9, 0.65],
      [0.85, 0.85, 0.9, 0.9, 0.9, 0.85],
    ],
    [
      [0.9, 0.9, 0.85, 0.65, 0.5, 0.5],
      [1.2, 1.1, 0.9, 0.85, 0.65, 0.5],
      [1.4, 1.4, 1.25, 1.15, 0.9, 0.7],
      [1.1, 1.1, 1.15, 1.1, 1, 0.9],
    ],
    [
      [0.9, 0.9, 0.85, 0.65, 0.5, 0.5],
      [1.2, 1.1, 0.95, 0.85, 0.65, 0.5],
      [1.25, 1.25, 1.2, 1.1, 0.9, 0.7],
      [1.2, 1.2, 1.2, 1.2, 1.1, 0.9],
    ],
    [
      [0.85, 0.85, 0.85, 0.7, 0.55, 0.5],
      [0.95, 0.9, 0.85, 0.85, 0.7, 0.55],
      [1.15, 1.15, 1.1, 0.95, 0.9, 0.8],
      [1, 1, 1.1, 1, 0.95, 0.9],
    ],
    [
      [0.85, 0.85, 0.85, 0.7, 0, 0],
      [0.85, 0.85, 0.85, 0.85, 0.7, 0],
      [0.85, 0.85, 0.85, 0.85, 0.85, 0.7],
      [0.85, 0.85, 0.85, 0.85, 0.85, 0.85],
    ],
  ],
};
