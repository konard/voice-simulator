#!/usr/bin/env node
/** Measure five batch recognitions per level on deterministic synthetic speech. Unlicense. */
import { recognize, synthesize } from '../src/index.js';

const engine = globalThis.process.argv[2] ?? 'js';
const { samples, sampleRate } = synthesize(
  'The quick brown fox jumps over the lazy dog.',
  { tier: 'minimal', seed: 1, engine: 'js' }
);
const stages = [
  'Front end',
  'Pitch',
  'Formants',
  'Inverse filter',
  'Landmarks',
  'Inversion',
  'Audio to IPA',
  'Language identification',
  'IPA to text',
  'Other',
  'Total',
];
const median = (values) => values.sort((a, b) => a - b)[2];
const levels = ['low', 'medium', 'high'];
const report = [];
for (const level of levels) {
  const runs = [];
  for (let i = 0; i < 5; i++) {
    const times = new Map();
    const start = globalThis.performance.now();
    await recognize(samples, sampleRate, {
      engine,
      threads: 1,
      level,
      profile(stage, ms) {
        times.set(stage, (times.get(stage) ?? 0) + ms);
      },
    });
    const total = globalThis.performance.now() - start;
    const measured = [...times.values()].reduce((sum, ms) => sum + ms, 0);
    times.set('Other', total - measured);
    times.set('Total', total);
    runs.push(times);
  }
  report.push(
    stages.map((stage) => {
      const ms = median(runs.map((run) => run.get(stage) ?? 0));
      const percent = median(
        runs.map((run) => (100 * (run.get(stage) ?? 0)) / run.get('Total'))
      );
      return `${ms.toFixed(2)} (${percent.toFixed(1)}%)`;
    })
  );
}
console.log(`| ${engine} (ms, %) | ${levels.join(' | ')} |`);
console.log('| --- | ---: | ---: | ---: |');
for (const [i, stage] of stages.entries()) {
  console.log(`| ${stage} | ${report.map((level) => level[i]).join(' | ')} |`);
}
