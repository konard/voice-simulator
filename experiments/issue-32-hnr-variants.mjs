// Issue 32: HNR of MATCH_TEXT (tier minimal, seed 1) at breathiness 0, 0.25,
// 0.5, 0.75 and 1 with four variants of the measure: the full band or above
// HNR_HIGHPASS, summed up by the median or the upper quartile of the frames.
// Each variant is a copy of src/analysis/voice-features.js with one or two
// edited lines, written next to it and deleted at the end.
// Run: node experiments/issue-32-hnr-variants.mjs > experiments/issue-32-hnr-variants.txt
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { URL } from 'node:url';
import { synthesize } from '../src/synthesize.js';
import { MATCH_TEXT } from '../src/analysis/voice-match.js';

const source = new URL('../src/analysis/voice-features.js', import.meta.url);
const text = readFileSync(source, 'utf8');
const FILTER = 'const upper = highpass(signal, HNR_HIGHPASS, rate);';
const QUARTILE = 'const HNR_PERCENTILE = 0.75;';
const variants = {
  'full band, median': [
    [FILTER, 'const upper = signal;'],
    [QUARTILE, 'const HNR_PERCENTILE = 0.5;'],
  ],
  'full band, upper quartile': [[FILTER, 'const upper = signal;']],
  'above 400 Hz, median': [[QUARTILE, 'const HNR_PERCENTILE = 0.5;']],
  'above 400 Hz, upper quartile (used)': [],
};

const renders = [0, 0.25, 0.5, 0.75, 1].map((breathiness) => ({
  breathiness,
  ...synthesize(MATCH_TEXT, {
    tier: 'minimal',
    seed: 1,
    head: { breathiness },
  }),
}));
let count = 0;
for (const [name, edits] of Object.entries(variants)) {
  let variant = text;
  for (const [from, to] of edits) {
    if (!variant.includes(from)) {
      throw new Error(`missing: ${from}`);
    }
    variant = variant.replace(from, to);
  }
  const file = new URL(
    `../src/analysis/.issue-32-variant-${count++}.js`,
    import.meta.url
  );
  writeFileSync(file, variant);
  try {
    const { analyzeVoice } = await import(file.href);
    const values = renders.map(
      ({ breathiness, samples, sampleRate }) =>
        `${breathiness}: ${analyzeVoice(samples, sampleRate).hnr.toFixed(2)}`
    );
    console.log(`${name}: ${values.join(', ')}`);
  } finally {
    rmSync(file);
  }
}
