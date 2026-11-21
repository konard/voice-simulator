#!/usr/bin/env node
/** Measure copy synthesis against public-domain recordings. Unlicense. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { copyRecording, measureCopyMetrics } from '../src/session/copy.js';
import { renderScore } from '../src/session/score.js';
import { createEngine } from '../src/engine/index.js';
import { errorRate } from '../src/metrics/text.js';
import { DEFAULT_AUDIO_TIER } from '../src/perf/lod.js';
import { isReviewed, loadGolden } from '../tests/helpers/golden.js';

export const COPY_TIERS = ['medium', DEFAULT_AUDIO_TIER];

function rowFor(item, tier, recognition, metrics) {
  return {
    id: item.id,
    tier,
    reviewed: isReviewed(item),
    text: recognition.text,
    ipa: recognition.ipa,
    phonemes: errorRate(item.ipa, recognition.ipa, 'phone'),
    ...metrics,
  };
}

export function* measureTiers(item, tiers, options) {
  const [first, ...others] = tiers;
  const { samples, sampleRate } = item;
  const { metrics, recognition, score } = copyRecording(samples, sampleRate, {
    ...options,
    tier: first,
  });
  yield rowFor(item, first, recognition, metrics);
  // Warnings from analysis are shared. Recompute recognition diagnostics for each render.
  const warnings = metrics.warnings.filter(
    ({ message }) => !message?.startsWith('Copy timing could not be measured:')
  );
  for (const tier of others) {
    const output = renderScore(score, { ...options, tier });
    yield rowFor(
      item,
      tier,
      recognition,
      measureCopyMetrics(samples, sampleRate, output, score, options, warnings)
    );
  }
}

function number(value) {
  return value === null ? '—' : value.toFixed(3);
}

function expandTree(value, prefix = '') {
  return Object.entries(value).flatMap(([key, item]) => {
    const name = prefix ? `${prefix}.${key}` : key;
    return item && typeof item === 'object' && !Array.isArray(item)
      ? expandTree(item, name)
      : [[name, item]];
  });
}

function formatRow({ id, tier, reviewed, text, ipa, warnings, ...metrics }) {
  const { lsd, mcd, f0, timingError, ...other } = metrics;
  const { rmseCents, vde, ...remainingF0 } = f0;
  const details = expandTree({ ...other, f0: remainingF0 }).map(
    ([name, value]) => `${name} ${number(value)}`
  );
  const escape = (value) => value.replaceAll('|', '\\|').replaceAll('\n', ' ');
  return `| ${id}${reviewed ? '' : '*'} | ${tier} | ${number(lsd)} | ${number(mcd)} | ${number(rmseCents)} | ${number(vde)} | ${number(timingError)} | ${escape(details.join('; '))} | ${escape(text)} | ${escape(ipa)} | ${escape(JSON.stringify(warnings))} |`;
}

export function formatCopyReport(rows, { commit, command, engine }) {
  const mean = rows.reduce((sum, { mcd }) => sum + mcd, 0) / rows.length;
  return [
    '# Copy synthesis',
    '',
    `Commit \`${commit}\`. Renderer \`${engine}\`. Command \`${command}\`.`,
    '',
    'An asterisk marks recordings whose reference text or IPA has yet to be reviewed. A dash means a metric has no observations.',
    '',
    `Mean mel cepstral distortion is ${number(mean)} dB. Its 5% margin is ${number(mean * 1.05)} dB.`,
    '',
    '| Recording | Tier | LSD (dB) | MCD (dB) | F0 RMSE (cents) | Voicing error | Syllable start error (ms) | Other metrics | Recognized text | IPA | Warnings |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- |',
    ...rows.map(formatRow),
    '',
  ].join('\n');
}

export function copyReportContext(command, engine) {
  return {
    command,
    engine,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
  };
}

function main() {
  const { values } = parseArgs({
    options: {
      out: { type: 'string', default: 'docs/reports/copy-synthesis.md' },
      tier: { type: 'string', multiple: true },
      id: { type: 'string', multiple: true },
      engine: { type: 'string', default: 'auto' },
    },
  });
  return run(values);
}

async function run(values) {
  const engine = await createEngine({ engine: values.engine, threads: 1 });
  const context = copyReportContext(
    ['node', 'scripts/copy-report.mjs', ...process.argv.slice(2)].join(' '),
    engine.name
  );
  const items = loadGolden().filter(
    ({ id }) => !values.id || values.id.includes(id)
  );
  if (!items.length) {
    throw new Error('No matching golden recordings');
  }
  const tiers = values.tier ?? COPY_TIERS;
  const rows = [];
  for (const item of items) {
    for (const row of measureTiers(item, tiers, { engine })) {
      rows.push(row);
      console.log(JSON.stringify(row));
    }
  }
  mkdirSync(dirname(values.out), { recursive: true });
  writeFileSync(values.out, formatCopyReport(rows, context));
  writeFileSync(
    `${values.out.replace(/\.md$/u, '')}.json`,
    `${JSON.stringify({ ...context, rows }, null, 2)}\n`
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
