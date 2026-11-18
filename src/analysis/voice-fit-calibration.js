/** Simulator calibration. Unlicense. Reproduce with experiments/issue-63/calibrate.mjs, cpp-calibrate.mjs and speech-time-calibrate.mjs. */
export const MATCH_TEXT =
  'Please call Stella and ask her to bring these things with her.';
// MATCH_TEXT, default head, seed 1, waveguide, 16000 Hz, JS engine.
// Default pitchRange 3 divided by the measured 5th–95th percentile range.
export const PITCH_RANGE_FACTOR = 3 / 7.146042124836602;
export const DEFAULT_SYLLABLE_RATE = 10 / 3.27;
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
