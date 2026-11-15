#!/usr/bin/env node
// Issue 40: matchVoice (tests/voice-match.test.js) on the female and male
// presets at three sizes: relative errors of the recovered pitch, tract
// length and speech rate.
// Usage: node experiments/issue-40-voice-match.mjs [root] [matcher.js]
//   root        a checkout (default .)
//   matcher.js  another src/analysis/voice-match.js inside that checkout's
//               src/analysis, e.g. git show main:src/analysis/voice-match.js
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] ?? '.');
const url = (path) => pathToFileURL(path).href;
const { synthesize, presetHeadConfig } = await import(
  url(`${root}/src/index.js`)
);
const { matchVoice } = await import(
  url(resolve(process.argv[3] ?? `${root}/src/analysis/voice-match.js`))
);
const TEXT =
  'The north wind and the sun were disputing which was the stronger.';
const error = (a, b) => Math.abs(a - b) / b;
const lengths = [];
for (const preset of ['female', 'male']) {
  for (const size of [undefined, 0.2, 0.8]) {
    const target = presetHeadConfig(preset, size);
    const { samples, sampleRate } = synthesize(TEXT, {
      head: target,
      solver: 'waveguide',
      sampleRate: 22050,
    });
    const result = matchVoice(samples, sampleRate, { transcript: TEXT });
    lengths.push(error(result.head.vocalTractLength, target.vocalTractLength));
    console.log(
      preset,
      size ?? 'default',
      result.preset,
      'pitch',
      error(result.head.pitch, target.pitch).toFixed(4),
      'length',
      `${result.head.vocalTractLength.toFixed(1)} vs ${target.vocalTractLength}`,
      lengths.at(-1).toFixed(4),
      'rate',
      error(result.head.speechRate, target.speechRate).toFixed(4)
    );
  }
}
console.log(
  'length error mean',
  (lengths.reduce((a, b) => a + b) / lengths.length).toFixed(4),
  'max',
  Math.max(...lengths).toFixed(4)
);
