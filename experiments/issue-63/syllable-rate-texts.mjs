// Unlicense. Issue 63: stage A speechRate without a transcript (landmark
// syllable rate / DEFAULT_SYLLABLE_RATE) of the default head at rate 1 for
// several texts. Usage: node syllable-rate-texts.mjs
import { fitVoice, synthesize, DEFAULT_HEAD } from '../../src/index.js';
import { MATCH_TEXT } from '../../src/analysis/voice-fit-calibration.js';
const texts = [
  MATCH_TEXT,
  'The north wind and the sun were disputing which was the stronger.',
  'When the sunlight strikes raindrops in the air, they act as a prism and form a rainbow.',
  'A traveller came along wrapped in a warm cloak.',
];
for (const text of texts) {
  const { samples, sampleRate } = synthesize(text, {
    head: DEFAULT_HEAD,
    seed: 1,
    sampleRate: 16000,
    solver: 'waveguide',
    engine: 'js',
  });
  const fit = fitVoice(samples, sampleRate, { refine: false });
  console.log(fit.head.speechRate.toFixed(3), JSON.stringify(text));
}
