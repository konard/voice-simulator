// Unlicense. Issue 63: planned median f0 / pitch of several English texts at
// pitch 100 and pitchRange 3, the ratio a reading without a transcript
// would assume. Usage: node planned-median-texts.mjs
import { plannedMedianF0 } from '../../src/analysis/voice-fit-transcript.js';
import { MATCH_TEXT } from '../../src/analysis/voice-fit-calibration.js';
const texts = [
  MATCH_TEXT,
  'The north wind and the sun were disputing which was the stronger.',
  'The north wind and the sun.',
  'When the sunlight strikes raindrops in the air, they act as a prism and form a rainbow.',
  'A traveller came along wrapped in a warm cloak.',
  'Hello world, how are you?',
];
for (const text of texts) {
  const row = [1.5, 3, 5].map((r) =>
    (plannedMedianF0(text, 100, r) / 100).toFixed(4)
  );
  console.log(row.join(' '), JSON.stringify(text));
}
