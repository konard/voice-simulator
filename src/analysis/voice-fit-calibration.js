/** Simulator calibration. Unlicense. Reproduce with experiments/issue-63/calibrate.mjs. */
export const MATCH_TEXT =
  'Please call Stella and ask her to bring these things with her.';
// MATCH_TEXT, default head, seed 1, waveguide, 16000 Hz, JS engine.
// Default pitchRange 3 divided by the measured 5th–95th percentile range.
export const PITCH_RANGE_FACTOR = 3 / 7.146042124836602;
export const DEFAULT_SYLLABLE_RATE = 10 / 3.27;
// [head.breathiness, median inverse-filter HNR in dB]. The first segment
// rises: the noise floor masks weak aspiration. Inversion retains that ambiguity.
export const BREATHINESS_HNR = [
  [0, 16.822946],
  [0.25, 17.768036],
  [0.5, 15.357405],
  [0.75, 10.878433],
  [1, 7.146085],
];
