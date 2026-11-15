#!/usr/bin/env node
/**
 * Baseline quality report (issue 19): synthesise every sentence of the
 * golden set (tests/fixtures/golden/) on some quality tiers, compare each
 * rendering with the recording by `compareRecordings` and write the
 * numbers per language and tier, next to two anchors that show what a
 * number means:
 *
 *   - lowpass: the recording resampled to 7000 Hz and back (a 3.5 kHz
 *     low-pass of the person's own voice);
 *   - noise: white noise from `createRandom(1)` with the length and the RMS
 *     of the recording (no speech at all).
 *
 * Usage:
 *   node scripts/quality-report.mjs [--manifest <file>] [--tiers <list>]
 *     [--lang <list>] [--limit <n>] [--out <dir>] [--baseline <json>]
 *     [--update-docs]
 *
 * Writes `<out>/baseline-quality.md` and `<out>/baseline-quality.json`,
 * appends the Summary table to `$GITHUB_STEP_SUMMARY` when it is set and,
 * with `--update-docs`, copies both files to docs/reports/.
 */

import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import {
  AUDIO_TIERS,
  compareRecordings,
  createRandom,
  decodeFlac,
  errorRate,
  presetHeadConfig,
  resample,
  synthesize,
} from '../src/index.js';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

export const DEFAULT_MANIFEST = 'tests/fixtures/golden/manifest.json';
export const DEFAULT_TIERS = Object.freeze(['minimal', 'low', 'medium']);
export const DEFAULT_LANGUAGES = Object.freeze(['en', 'ru', 'hi', 'zh']);
export const DEFAULT_OUT = 'reports/quality';
export const DOCS_DIR = 'docs/reports';
export const REPORT_NAME = 'baseline-quality';
/** Rate the `lowpass` anchor is resampled to and back (Nyquist 3.5 kHz). */
export const LOWPASS_RATE = 7000;
export const ANCHORS = Object.freeze(['lowpass', 'noise']);
export const SEED = 1;

/**
 * Columns of the tables: row field, heading, factor from the stored value
 * to the shown one. The `summary` also averages the fields that have no
 * column (f0MeanCents, ffe, renderSeconds).
 */
export const COLUMNS = Object.freeze([
  { key: 'mcd', label: 'MCD (dB)', scale: 1 },
  { key: 'lsd', label: 'LSD (dB)', scale: 1 },
  { key: 'f0RmseCents', label: 'f0 RMSE (cents)', scale: 1 },
  { key: 'gpe', label: 'GPE (%)', scale: 100 },
  { key: 'vde', label: 'VDE (%)', scale: 100 },
  { key: 'f1Percent', label: 'F1 error (%)', scale: 1 },
  { key: 'f2Percent', label: 'F2 error (%)', scale: 1 },
  { key: 'f3Percent', label: 'F3 error (%)', scale: 1 },
  { key: 'timingRms', label: 'timing (s)', scale: 1 },
  { key: 'durationRatio', label: 'duration ratio', scale: 1 },
  { key: 'rtf', label: 'RTF', scale: 1 },
]);

/** Every numeric field of a row, in the order of the issue. */
export const METRICS = Object.freeze([
  'lsd',
  'mcd',
  'f0RmseCents',
  'f0MeanCents',
  'gpe',
  'vde',
  'ffe',
  'f1Percent',
  'f2Percent',
  'f3Percent',
  'timingRms',
  'durationRatio',
  'renderSeconds',
  'rtf',
]);

/** `value` rounded to 4 significant digits; null for a missing value. */
export function round4(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Number(value.toPrecision(4))
    : null;
}

function rms(samples) {
  let sum = 0;
  for (let index = 0; index < samples.length; index++) {
    sum += samples[index] * samples[index];
  }
  return samples.length > 0 ? Math.sqrt(sum / samples.length) : 0;
}

/** The recording resampled to LOWPASS_RATE and back to its own rate. */
export function lowpassAnchor(reference) {
  const down = resample(reference.samples, reference.sampleRate, LOWPASS_RATE);
  return {
    samples: resample(down, LOWPASS_RATE, reference.sampleRate),
    sampleRate: reference.sampleRate,
  };
}

/** White noise (createRandom(SEED)) of the length and RMS of the recording. */
export function noiseAnchor(reference) {
  const random = createRandom(SEED);
  const noise = Float64Array.from(reference.samples, () => 2 * random() - 1);
  const level = rms(noise);
  const gain = level > 0 ? rms(reference.samples) / level : 0;
  for (let index = 0; index < noise.length; index++) {
    noise[index] *= gain;
  }
  return { samples: noise, sampleRate: reference.sampleRate };
}

/** The metrics of one comparison as a row (without the render time). */
export function metricRow(m) {
  const formant = (name) => m.formants?.[name]?.percent ?? null;
  return {
    lsd: m.lsd,
    mcd: m.mcd,
    f0RmseCents: m.f0.rmseCents,
    f0MeanCents: m.f0.meanCents,
    gpe: m.f0.gpe,
    vde: m.f0.vde,
    ffe: m.f0.ffe,
    f1Percent: formant('f1'),
    f2Percent: formant('f2'),
    f3Percent: formant('f3'),
    timingRms: m.timing.rmsSeconds,
    durationRatio: m.duration.ratio,
  };
}

function roundedRow(head, values) {
  const row = { ...head };
  for (const key of METRICS) {
    row[key] = round4(values[key]);
  }
  return row;
}

/** Mean and sample standard deviation of the finite values (null if none). */
export function meanAndSd(values) {
  const finite = values.filter(
    (value) => typeof value === 'number' && Number.isFinite(value)
  );
  if (finite.length === 0) {
    return { mean: null, sd: null };
  }
  const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  if (finite.length < 2) {
    return { mean, sd: null };
  }
  const square = finite.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  return { mean, sd: Math.sqrt(square / (finite.length - 1)) };
}

function summaryEntry(lang, tier, rows) {
  const entry = { lang, tier, n: rows.length, mean: {}, sd: {} };
  for (const key of METRICS) {
    const { mean, sd } = meanAndSd(rows.map((row) => row[key]));
    entry.mean[key] = round4(mean);
    entry.sd[key] = round4(sd);
  }
  return entry;
}

/**
 * One summary entry per (language, tier), per ('all', tier) and per anchor
 * (for each language and for 'all').
 */
export function summarize(rows, anchors, tiers, languages) {
  const summary = [];
  const groups = [
    ...tiers.map((tier) => [tier, rows]),
    ...ANCHORS.map((anchor) => [anchor, anchors]),
  ];
  for (const [tier, source] of groups) {
    const ofTier = source.filter((row) => row.tier === tier);
    for (const lang of languages) {
      const ofLang = ofTier.filter((row) => row.lang === lang);
      if (ofLang.length > 0) {
        summary.push(summaryEntry(lang, tier, ofLang));
      }
    }
    if (ofTier.length > 0) {
      summary.push(summaryEntry('all', tier, ofTier));
    }
  }
  return summary;
}

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function packageVersion() {
  const file = path.join(REPO_ROOT, 'package.json');
  return JSON.parse(readFileSync(file, 'utf8')).version;
}

function checkTiers(tiers) {
  const known = AUDIO_TIERS.map((tier) => tier.name);
  for (const tier of tiers) {
    if (!known.includes(tier)) {
      throw new RangeError(
        `quality report: unknown tier "${tier}" (known: ${known.join(', ')})`
      );
    }
  }
}

/** Utterances of the manifest in `languages`, the first `limit` of each. */
export function selectUtterances(manifest, languages, limit = null) {
  const chosen = [];
  for (const lang of languages) {
    const ofLang = manifest.utterances.filter((u) => u.lang === lang);
    chosen.push(...(limit ? ofLang.slice(0, limit) : ofLang));
  }
  return chosen;
}

/**
 * Rows of one utterance: one per tier (rendered with the preset head of the
 * speaker's sex, female when unknown) and one per anchor, and the phone
 * error rate of the first rendering against the reviewed IPA.
 */
function scoreUtterance(u, reference, tiers, anchorKinds, progress) {
  const head = presetHeadConfig(u.speaker?.sex === 'male' ? 'male' : 'female');
  const rows = [];
  const anchors = [];
  let per = null;
  for (const tier of tiers) {
    const start = performance.now();
    const voice = synthesize(u.text, { lang: u.lang, tier, seed: SEED, head });
    const renderSeconds = (performance.now() - start) / 1000;
    per ??= errorRate(u.ipa, voice.ipa, 'phone').rate;
    const m = compareRecordings(reference, voice);
    rows.push(
      roundedRow(
        { id: u.id, lang: u.lang, tier },
        { ...metricRow(m), renderSeconds, rtf: renderSeconds / voice.duration }
      )
    );
    progress(`${u.id} ${tier}: MCD ${round4(m.mcd)} dB`);
  }
  for (const anchor of anchorKinds) {
    const make = anchor === 'lowpass' ? lowpassAnchor : noiseAnchor;
    const m = compareRecordings(reference, make(reference));
    anchors.push(
      roundedRow(
        { id: u.id, lang: u.lang, tier: anchor },
        { ...metricRow(m), renderSeconds: null, rtf: null }
      )
    );
    progress(`${u.id} ${anchor}: MCD ${round4(m.mcd)} dB`);
  }
  return { rows, anchors, per };
}

/**
 * Synthesise, compare and summarise.
 * @param {{manifest?: string, tiers?: string[], lang?: string[],
 *   limit?: number|null, anchors?: boolean, notes?: string[],
 *   onProgress?: (message: string) => void}} [options]
 *   manifest: path of the golden manifest (relative paths from the
 *   repository root); lang: languages; limit: first n utterances of each
 *   language; anchors: false leaves the two anchors out (for parts that
 *   `mergeReports` joins); notes: sentences shown under the title.
 * @returns {object} The data object of the report (schema 1).
 */
export function qualityReport(options = {}) {
  const manifestPath = path.resolve(
    REPO_ROOT,
    options.manifest ?? DEFAULT_MANIFEST
  );
  const tiers = [...(options.tiers ?? DEFAULT_TIERS)];
  const languages = [...(options.lang ?? DEFAULT_LANGUAGES)];
  const limit = options.limit ?? null;
  const progress = options.onProgress ?? (() => {});
  const anchorKinds = options.anchors === false ? [] : ANCHORS;
  checkTiers(tiers);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const folder = path.dirname(manifestPath);
  const utterances = [];
  const rows = [];
  const anchors = [];
  for (const u of selectUtterances(manifest, languages, limit)) {
    const reference = decodeFlac(
      new Uint8Array(readFileSync(path.join(folder, u.file)))
    );
    const scored = scoreUtterance(u, reference, tiers, anchorKinds, progress);
    rows.push(...scored.rows);
    anchors.push(...scored.anchors);
    utterances.push({
      id: u.id,
      lang: u.lang,
      per: round4(scored.per),
      reviewed: u.review?.text === 'confirmed' && u.review?.ipa === 'confirmed',
    });
  }
  return {
    schema: 1,
    generated: {
      date: new Date().toISOString(),
      commit: gitCommit(),
      version: packageVersion(),
      node: process.version,
    },
    settings: { tiers, languages, seed: SEED, limit },
    notes: [...(options.notes ?? [])],
    utterances,
    rows,
    anchors,
    summary: summarize(rows, anchors, tiers, languages),
  };
}

/**
 * Join reports of the same utterances made with different tiers (one
 * `qualityReport` call per tier keeps each call short): the tiers, rows and
 * anchors of all parts, the `generated` block, utterances and notes of the
 * first part, a phone error rate from any part, and a new summary.
 * @param {object[]} parts
 * @returns {object}
 */
export function mergeReports(parts) {
  if (parts.length === 0) {
    throw new RangeError('mergeReports: no parts');
  }
  const [first] = parts;
  const tiers = parts.flatMap((part) => part.settings.tiers);
  const rows = parts.flatMap((part) => part.rows);
  const anchors = parts.flatMap((part) => part.anchors);
  const utterances = first.utterances.map((u) => ({
    ...u,
    per:
      parts
        .map((part) => part.utterances.find((v) => v.id === u.id)?.per)
        .find((per) => typeof per === 'number') ?? null,
  }));
  return {
    ...first,
    settings: { ...first.settings, tiers },
    notes: [...(first.notes ?? [])],
    utterances,
    rows,
    anchors,
    summary: summarize(rows, anchors, tiers, first.settings.languages),
  };
}

// ---------------------------------------------------------------- Markdown

const MINUS = '−';

/** A number with 3 significant digits (at most 3 decimals), "—" if null. */
export function formatNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—';
  }
  const size = Math.abs(value);
  let decimals = 3;
  if (size >= 100) {
    decimals = 0;
  } else if (size >= 10) {
    decimals = 1;
  } else if (size >= 1) {
    decimals = 2;
  }
  const text = value.toFixed(decimals);
  return text.startsWith('-') ? `${MINUS}${text.slice(1)}` : text;
}

function signed(value) {
  const text = formatNumber(value);
  return value > 0 || text === formatNumber(0) ? `+${text}` : text;
}

function findEntry(summary, lang, tier) {
  return (summary ?? []).find(
    (entry) => entry.lang === lang && entry.tier === tier
  );
}

function summaryCell(entry, column, before) {
  const scaled = (value) =>
    typeof value === 'number' ? value * column.scale : value;
  const mean = scaled(entry.mean[column.key]);
  const sd = scaled(entry.sd[column.key]);
  let cell = formatNumber(mean);
  if (typeof sd === 'number') {
    cell += ` ± ${formatNumber(sd)}`;
  }
  const old = before ? scaled(before.mean[column.key]) : null;
  if (typeof mean === 'number' && typeof old === 'number') {
    cell += ` (${signed(mean - old)})`;
  }
  return cell;
}

function table(header, lines) {
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...lines.map((cells) => `| ${cells.join(' | ')} |`),
  ].join('\n');
}

/**
 * Table of one language ('all' for every language): one row per tier and
 * anchor, each cell `mean ± sd`, and the difference to `baseline`.
 */
export function summaryTable(data, lang = 'all', baseline = null) {
  const lines = [];
  for (const tier of [...data.settings.tiers, ...ANCHORS]) {
    const entry = findEntry(data.summary, lang, tier);
    if (!entry) {
      continue;
    }
    const before = findEntry(baseline?.summary, lang, tier);
    lines.push([
      tier,
      String(entry.n),
      ...COLUMNS.map((column) => summaryCell(entry, column, before)),
    ]);
  }
  return table(['tier', 'n', ...COLUMNS.map((column) => column.label)], lines);
}

const LANGUAGE_NAMES = Object.freeze({
  en: 'English',
  ru: 'Russian',
  hi: 'Hindi',
  zh: 'Mandarin Chinese',
});

/** One sentence per metric: what it is and which direction is better. */
export const HOW_TO_READ = Object.freeze([
  '**MCD** (mel-cepstral distortion, Kubichek 1993): distance between the mel cepstra c1 to c13 of paired frames; lower is better. It is taken from the natural logarithm of the power with an orthonormal DCT, so its values are larger than those of tools that use the SPTK mel-generalised cepstrum, and they are comparable only inside this project.',
  '**LSD** (log-spectral distance): RMS difference of the log power spectra of paired frames in dB; lower is better.',
  '**f0 RMSE**: RMS difference of the pitch in cents (1200 per octave) over the frames voiced in both; lower is better.',
  '**GPE** (gross pitch error): share of the frames voiced in both whose pitch differs by more than 20 %; lower is better.',
  '**VDE** (voicing decision error): share of all frames voiced in only one of the two; lower is better.',
  '**F1, F2, F3 error**: mean relative difference of the first three formants over the voiced frames with formants in both; lower is better.',
  '**timing**: RMS distance of the alignment path from the straight line between the two starts and ends, in seconds; lower means the rhythm is closer.',
  '**duration ratio**: length of the rendering divided by the length of the recording after the silence at both ends is cut; 1 is best.',
  '**RTF** (real-time factor): render time divided by the length of the rendering on the machine that made the report; lower is faster, below 1 is faster than real time.',
  '**PER** (phone error rate): Levenshtein distance between the IPA of the golden set and the IPA of the text front end, as a share of the golden phones; lower is better.',
]);

function frontEndTable(data) {
  const lines = data.settings.languages
    .map((lang) => {
      const ofLang = data.utterances.filter((u) => u.lang === lang);
      if (ofLang.length === 0) {
        return null;
      }
      const { mean } = meanAndSd(ofLang.map((u) => u.per));
      return [lang, String(ofLang.length), formatNumber(mean * 100)];
    })
    .filter(Boolean);
  return table(['language', 'utterances', 'mean PER (%)'], lines);
}

function utteranceTable(data) {
  const byId = new Map(data.utterances.map((u) => [u.id, u]));
  const lines = [...data.rows, ...data.anchors]
    .map((row) => ({
      row,
      order: data.utterances.findIndex((u) => u.id === row.id),
    }))
    .sort((a, b) => a.order - b.order)
    .map(({ row }) => {
      const u = byId.get(row.id);
      return [
        u?.reviewed ? row.id : `${row.id}*`,
        row.tier,
        ...COLUMNS.map((column) =>
          formatNumber(
            typeof row[column.key] === 'number'
              ? row[column.key] * column.scale
              : null
          )
        ),
        formatNumber(typeof u?.per === 'number' ? u.per * 100 : null),
      ];
    });
  return table(
    ['id', 'tier', ...COLUMNS.map((column) => column.label), 'PER (%)'],
    lines
  );
}

/**
 * The report as Markdown.
 * @param {object} data Output of `qualityReport`.
 * @param {object|null} [baseline] An earlier data object: every Summary
 *   cell also shows the difference to the same cell of it.
 * @returns {string}
 */
export function renderMarkdown(data, baseline = null) {
  const { generated, settings } = data;
  const parts = [
    '# Baseline quality against real recordings',
    [
      `- date: ${generated.date}`,
      `- commit: ${generated.commit || 'unknown'}`,
      `- version: ${generated.version}`,
      `- node: ${generated.node}`,
      `- tiers: ${settings.tiers.join(', ')}`,
      `- languages: ${settings.languages.join(', ')}`,
      `- seed: ${settings.seed}`,
      `- limit: ${settings.limit ?? 'none'} utterances per language`,
    ].join('\n'),
  ];
  if (data.notes?.length) {
    parts.push(data.notes.join('\n\n'));
  }
  if (baseline) {
    parts.push(
      `Numbers in parentheses are the difference to the baseline of ${baseline.generated?.date ?? 'unknown date'} (commit ${baseline.generated?.commit || 'unknown'}).`
    );
  }
  parts.push(
    '## Summary',
    'All languages; every cell is the mean ± the sample standard deviation over the utterances. `lowpass` is the recording itself low-passed at 3.5 kHz, `noise` is white noise with the RMS of the recording; a useful tier lies between the two.',
    summaryTable(data, 'all', baseline)
  );
  for (const lang of settings.languages) {
    if (data.summary.some((entry) => entry.lang === lang)) {
      parts.push(
        `## ${LANGUAGE_NAMES[lang] ?? lang} (${lang})`,
        summaryTable(data, lang, baseline)
      );
    }
  }
  parts.push('## Text front end', frontEndTable(data));
  parts.push(
    '## Utterances',
    utteranceTable(data),
    '`*` The text and the IPA of this utterance are not yet confirmed by a person who knows the language (`review` in tests/fixtures/golden/manifest.json).'
  );
  parts.push(
    '## How to read this',
    'Each rendering uses the preset head of the speaker’s sex (the female head when the sex is unknown), so part of the spectral distance is the difference between two people and not an error of the simulation. A dash means the metric has no frames to compare (no voiced frames or no formants in both).',
    HOW_TO_READ.map((line) => `- ${line}`).join('\n')
  );
  return `${parts.join('\n\n')}\n`;
}

// --------------------------------------------------------------------- CLI

export const HELP = `Usage: node scripts/quality-report.mjs [options]

Synthesise the golden set on some quality tiers, compare every rendering
with its recording and write a report per language and tier.

Options:
  --manifest <file>  golden manifest (default ${DEFAULT_MANIFEST})
  --tiers <list>     comma-separated tiers (default ${DEFAULT_TIERS.join(',')})
  --lang <list>      comma-separated languages (default ${DEFAULT_LANGUAGES.join(',')})
  --limit <n>        first n utterances of each language (default all)
  --out <dir>        report folder (default ${DEFAULT_OUT})
  --baseline <json>  show differences to an earlier baseline-quality.json
  --update-docs      also copy both files to ${DOCS_DIR}/
  --help             show this help`;

const list = (value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

/** Parse the command line (throws RangeError on a bad option). */
export function parseArguments(argv) {
  const options = {
    manifest: DEFAULT_MANIFEST,
    tiers: [...DEFAULT_TIERS],
    lang: [...DEFAULT_LANGUAGES],
    limit: null,
    out: DEFAULT_OUT,
    baseline: null,
    updateDocs: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index];
    const value = () => {
      const next = argv[++index];
      if (next === undefined) {
        throw new RangeError(`${name} needs a value`);
      }
      return next;
    };
    if (name === '--manifest') {
      options.manifest = value();
    } else if (name === '--tiers') {
      options.tiers = list(value());
    } else if (name === '--lang') {
      options.lang = list(value());
    } else if (name === '--limit') {
      const limit = Number(value());
      if (!Number.isInteger(limit) || limit < 1) {
        throw new RangeError('--limit must be a positive integer');
      }
      options.limit = limit;
    } else if (name === '--out') {
      options.out = value();
    } else if (name === '--baseline') {
      options.baseline = value();
    } else if (name === '--update-docs') {
      options.updateDocs = true;
    } else if (name === '--help' || name === '-h') {
      options.help = true;
    } else {
      throw new RangeError(`unknown option ${name}`);
    }
  }
  return options;
}

/** Write `<out>/baseline-quality.md` and `.json`; returns both paths. */
export function writeReportFiles(out, markdown, data) {
  mkdirSync(out, { recursive: true });
  const markdownPath = path.join(out, `${REPORT_NAME}.md`);
  const jsonPath = path.join(out, `${REPORT_NAME}.json`);
  writeFileSync(markdownPath, markdown);
  writeFileSync(jsonPath, `${JSON.stringify(data, null, 2)}\n`);
  return { markdown: markdownPath, json: jsonPath };
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    console.log(HELP);
    return 0;
  }
  const baseline = options.baseline
    ? JSON.parse(readFileSync(options.baseline, 'utf8'))
    : null;
  const data = qualityReport({
    manifest: options.manifest,
    tiers: options.tiers,
    lang: options.lang,
    limit: options.limit,
    onProgress: (message) => console.error(message),
  });
  const markdown = renderMarkdown(data, baseline);
  const files = writeReportFiles(options.out, markdown, data);
  console.log(`wrote ${files.markdown} and ${files.json}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Quality against real recordings\n\n${summaryTable(data, 'all', baseline)}\n`
    );
  }
  if (options.updateDocs) {
    const docs = path.join(REPO_ROOT, DOCS_DIR);
    mkdirSync(docs, { recursive: true });
    copyFileSync(files.markdown, path.join(docs, `${REPORT_NAME}.md`));
    copyFileSync(files.json, path.join(docs, `${REPORT_NAME}.json`));
    console.log(`copied both files to ${DOCS_DIR}/`);
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof RangeError ? error.message : error);
    process.exitCode = 1;
  }
}
