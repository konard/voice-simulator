/**
 * Probe for issue 38: the vocal tract length that analyzeVoice() reads from
 * renders of the male and female presets, for the test sentence of
 * tests/voice-match.test.js and MATCH_TEXT, in a given checkout.
 * Usage: node experiments/issue-38-voice-match-probe.mjs [root]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] ?? '.');
const load = (path) => import(pathToFileURL(`${root}/${path}`).href);
const { synthesize, presetHeadConfig, matchVoice } = await load('src/index.js');
const { analyzeVoice } = await load('src/analysis/voice-features.js');
const { MATCH_TEXT } = await load('src/analysis/voice-match.js');
const source = readFileSync(`${root}/tests/voice-match.test.js`, 'utf8');

const TEXT = eval(source.match(/const TEXT\s*=\s*([^;]+);/)[1]);

for (const [name, text] of [
  ['TEXT', TEXT],
  ['MATCH_TEXT', MATCH_TEXT],
]) {
  for (const preset of ['male', 'female']) {
    const head = presetHeadConfig(preset);
    const { samples, sampleRate } = synthesize(text, {
      head,
      solver: 'waveguide',
      sampleRate: 16000,
      seed: 1,
    });
    const features = analyzeVoice(samples, sampleRate);
    let line = `${name.padEnd(10)} ${preset.padEnd(6)} head vtl ${head.vocalTractLength} read vtl ${features.vocalTractLength?.toFixed(2)}`;
    if (name === 'TEXT') {
      const match = matchVoice(samples, sampleRate, { iterations: 2 });
      line += ` match vtl ${match.head.vocalTractLength} preset ${match.preset}`;
    }
    console.log(line);
  }
}
