#!/usr/bin/env node
// Issue 40: which change moves the nasal/vowel ratio of [ˈama] in the 3D
// solver (issue-11-audit-m2.mjs, "ama fdtd3d dx 1")? Audio RMS of the
// middle 30 ms of the nasal over that of the first vowel, with the source
// plane fixed at its rest place (glottisTravel 0, the time step stretches
// with the tract length) and with another vowel table.
//
// Usage: node experiments/issue-40-ama-3d.mjs [dx] [table.mjs]
//   table.mjs  a copy of an older src/articulation/vowel-calibration.js,
//              e.g. git show main:src/articulation/vowel-calibration.js
import { VoiceRenderer } from '../src/acoustics/voice.js';
import { planUtterance } from '../src/articulation/plan.js';
import { normalizeHeadConfig } from '../src/head-config.js';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const dx = Number(process.argv[2] ?? 1);
const tablePath = process.argv[3];
const other = tablePath
  ? (await import(pathToFileURL(resolve(tablePath)).href)).VOWEL_CORRECTIONS_3D
  : null;

function rms(values, from, to) {
  let sum = 0;
  for (let index = from; index < to; index++) {
    sum += values[index] ** 2;
  }
  return Math.sqrt(sum / Math.max(1, to - from));
}

function ratio({ fixed = false, table = null } = {}) {
  const plan = planUtterance('ˈama', { head: normalizeHeadConfig({}) });
  const renderer = new VoiceRenderer(plan, { seed: 1, solver: 'fdtd3d', dx });
  if (fixed) {
    renderer.solver.glottisTravel = 0;
  }
  if (table) {
    renderer.vowelCorrections = table;
  }
  const rises = new Set();
  const setShape = renderer.solver.setShape.bind(renderer.solver);
  renderer.solver.setShape = (...args) => {
    setShape(...args);
    rises.add(renderer.solver.rise);
  };
  const samples = new Float32Array(renderer.totalSamples);
  renderer.render(samples);
  const rate = renderer.sampleRate;
  const level = (kind) => {
    const segment = plan.segments.find((item) => item.kind === kind);
    const centre = (segment.start + segment.end) / 2;
    return rms(
      samples,
      Math.floor((centre - 0.015) * rate),
      Math.floor((centre + 0.015) * rate)
    );
  };
  const vowel = level('vowel');
  const nasal = level('consonant');
  return {
    vowel: Number(vowel.toFixed(4)),
    nasal: Number(nasal.toFixed(4)),
    ratio: Number((nasal / vowel).toFixed(3)),
    rises: [...rises].sort((a, b) => a - b),
  };
}

console.log(`dx ${dx}`);
console.log('source plane follows the length:', ratio());
console.log('source plane at rest:            ', ratio({ fixed: true }));
if (other) {
  console.log('follows, other table:            ', ratio({ table: other }));
  console.log(
    'at rest, other table:            ',
    ratio({ fixed: true, table: other })
  );
}
