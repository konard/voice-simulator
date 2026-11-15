/**
 * Issue 38: the vocal tract length that analyzeVoice() reads from renders
 * of the male and female presets (waveguide, 16 kHz) for several sentences,
 * in a given checkout, to tell a systematic shift from the noise of one
 * sentence. Usage: node experiments/issue-38-vtl-sentences.mjs [root]
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] ?? '.');
const load = (path) => import(pathToFileURL(`${root}/${path}`).href);
const { synthesize, presetHeadConfig } = await load('src/index.js');
const { analyzeVoice } = await load('src/analysis/voice-features.js');

const SENTENCES = [
  'The north wind and the sun were disputing which was the stronger.',
  'Please call Stella and ask her to bring these things with her.',
  'When the sunlight strikes raindrops in the air, they act as a prism.',
  'A rainbow is a division of white light into many beautiful colors.',
  'We were away a year ago.',
];
const sums = { male: 0, female: 0 };
for (const text of SENTENCES) {
  const row = ['male', 'female'].map((preset) => {
    const { samples } = synthesize(text, {
      head: presetHeadConfig(preset),
      solver: 'waveguide',
      sampleRate: 16000,
    });
    const value = analyzeVoice(samples, 16000).vocalTractLength;
    sums[preset] += value / SENTENCES.length;
    return value.toFixed(2);
  });
  console.log(`${row.join('  ')}  ${text}`);
}
console.log(
  `${sums.male.toFixed(2)}  ${sums.female.toFixed(2)}  mean (heads 17.2 and 14.8)`
);
