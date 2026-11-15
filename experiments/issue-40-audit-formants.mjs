#!/usr/bin/env node
// Issue 40: formants that issue-11-audit.mjs reads from "Hello world." on
// the minimal tier, for several seeds (the spread of the measure itself).
// Usage: node experiments/issue-40-audit-formants.mjs [root of a checkout]
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] ?? '.');
const { synthesize, analyzeVoice } = await import(
  pathToFileURL(`${root}/src/index.js`).href
);
for (const sampleRate of [8000, 11025, 16000]) {
  const rows = [];
  for (const seed of [1, 2, 3, 4, 5]) {
    const out = synthesize('Hello world.', {
      tier: 'minimal',
      sampleRate,
      seed,
    });
    rows.push(
      analyzeVoice(out.samples, out.sampleRate).formants.map(Math.round)
    );
  }
  console.log(
    `minimal@${sampleRate}`,
    rows.map((row) => row.join('/')).join('  ')
  );
}
