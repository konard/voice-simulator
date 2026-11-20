/** Generate public-domain phone templates from the physical renderer. */
import { writeFileSync } from 'node:fs';
import { URL } from 'node:url';
import { renderPlan } from '../src/acoustics/voice.js';
import { resample } from '../src/audio/resample.js';
import { parseIpa } from '../src/ipa/parse.js';
import { mfcc } from '../src/metrics/spectrum.js';
import { decoderUnit } from '../src/recognition/decode-model.js';
import { getLexicon } from '../src/recognition/lexicon.js';
import { prepareUtterance } from '../src/synthesize.js';

const rate = 16000;
const window = 0.025;
const hop = 0.01;
const points = [0.15, 0.35, 0.55, 0.75, 0.92];
const contexts = [
  ['ə', 'ə'],
  ['', 'ə'],
  ['l', 'd'],
];

function readUnits(node, units) {
  if (node.token) {
    units.add(decoderUnit(node.token));
  }
  for (const child of node.children.values()) {
    readUnits(child, units);
  }
}

function prototype(unit, before, after) {
  const vowel = parseIpa(unit).tokens[0].kind === 'vowel';
  const ipa = `${before}${vowel ? 'ˈ' : ''}${unit}${after}.`;
  const { plan, renderOptions } = prepareUtterance(ipa, {
    ipa: true,
    lang: 'en',
    tier: 'minimal',
    engine: 'js',
    seed: 1,
  });
  const phones = [
    ...new Set(
      plan.segments.map(({ token }) => token).filter((token) => token?.phoneme)
    ),
  ];
  const parts = plan.segments.filter(
    ({ token }) => token === phones[Number(Boolean(before))]
  );
  const { start } = parts[0];
  const { end } = parts.at(-1);
  const signal = renderPlan({ ...plan, duration: end + window }, renderOptions);
  const input = resample(signal, renderOptions.sampleRate, rate);
  const frames = mfcc(input, rate, { window, hop, coefficients: 12 });
  return points.map((point) => {
    const center = start + point * (end - start);
    const index = Math.round((center - window / 2) / hop);
    const frame = frames[Math.max(0, Math.min(index, frames.length - 1))];
    return Array.from(frame, (value) => Math.round(value * 1000) / 1000);
  });
}

const units = new Set();
readUnits(getLexicon('en').root, units);
const rows = [...units]
  .sort()
  .map((unit) =>
    JSON.stringify([
      unit,
      contexts.map(([before, after]) => prototype(unit, before, after)),
    ])
  );
const output = [
  '/** Generated from the physical English synthesizer by',
  ' * node experiments/issue-73-acoustic-templates.mjs. Unlicense. */',
  '// prettier-ignore',
  'export const SIMULATED_PHONES = new Map([',
  ...rows.map((row) => `  ${row},`),
  ']);',
  '',
].join('\n');
writeFileSync(
  new URL('../src/recognition/data/simulated-phones.js', import.meta.url),
  output
);
