/** Manual benchmark of batch recognition on the first rows of public corpora. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { DatasetError, EXIT, fetchDataset } from '../../scripts/datasets.mjs';
import { parseAishellLine } from '../../scripts/lexicon-metrics.mjs';
import { textToIpa } from '../../src/g2p/index.js';
import { pinyinSyllableToIpa, TONE_CONTOURS } from '../../src/g2p/pinyin.js';
import {
  recognize,
  RecognitionError,
} from '../../src/recognition/recognizer.js';
import { datasetSkipReason } from '../helpers/datasets.js';
import {
  BENCHMARK,
  checkBaseline,
  compareSyllableTones,
  loadBenchmark,
  prepareReference,
  scoreUtterance,
  toneSyllables,
} from './helpers/benchmark.js';
import {
  baselineRegressions,
  checkFloors,
  ERROR_METRICS,
  fleursLanguageAccuracy,
  readBaseline,
  saveBaseline,
} from './helpers/benchmark-baseline.js';
import { formatBenchmarkReport } from './helpers/benchmark-report.js';
import { heavyLimit, writeReport } from './helpers/report.js';

const LEVELS = ['low', 'medium', 'high'];
const AISHELL = 'aishell3-test-index';
const TONE_NUMBERS = new Map(
  Object.entries(TONE_CONTOURS).map(([number, contour]) => [
    contour,
    number === 'halfThird' ? 3 : Number(number),
  ])
);
const ratio = (sum, length) => (length ? sum / length : null);

function measureRecognition(row, options) {
  const started = performance.now();
  try {
    const result = recognize(row.samples, row.sampleRate, options);
    return {
      result,
      seconds: (performance.now() - started) / 1000,
      rejected: 0,
    };
  } catch (error) {
    if (
      !(error instanceof RecognitionError) ||
      !['empty', 'too-noisy'].includes(error.code)
    ) {
      throw error;
    }
    // A recognizer rejection has an empty hypothesis and misses the language.
    return {
      result: {},
      seconds: (performance.now() - started) / 1000,
      rejected: 1,
    };
  }
}

function measureLevel(rows, set, options, onConfusion) {
  const { language, id } = set;
  const totals = {
    utterances: 0,
    skipped: 0,
    rejected: 0,
    audioSeconds: 0,
    recognitionSeconds: 0,
    languageRight: 0,
    ...Object.fromEntries(
      ERROR_METRICS.map((key) => [key, { errors: 0, length: 0 }])
    ),
  };
  const utterances = [];
  for (const { row, reference } of rows) {
    if (reference === null) {
      totals.skipped++;
      continue;
    }
    const { result, seconds, rejected } = measureRecognition(row, options);
    const score = scoreUtterance(row, result, language, {
      reference,
      onConfusion,
    });
    totals.utterances++;
    totals.rejected += rejected;
    totals.audioSeconds += row.samples.length / row.sampleRate;
    totals.recognitionSeconds += seconds;
    totals.languageRight += Number(score.languageRight);
    for (const key of ERROR_METRICS) {
      totals[key].errors += score[key]?.errors ?? 0;
      totals[key].length += score[key]?.length ?? 0;
    }
    utterances.push({
      id: row.id,
      ...score,
      languageRight: Number(score.languageRight),
      rejected,
    });
  }
  const rates = Object.fromEntries(
    ERROR_METRICS.map((key) => {
      const { errors, length } = totals[key];
      return [key, ratio(errors, length)];
    })
  );
  rates.languageRight = ratio(totals.languageRight, totals.utterances);
  rates.rtf = ratio(totals.recognitionSeconds, totals.audioSeconds);
  rates.utterances = totals.utterances;
  console.log(
    `${id} ${options.level}${options.languages ? ' (known language)' : ''}: ${totals.utterances} utterances, ${totals.recognitionSeconds.toFixed(1)} s, PER ${rates.per}, class errors ${rates.classErr}, language right ${rates.languageRight}`
  );
  return { totals, rates, utterances };
}

async function datasetForReport(id, skipped, load) {
  const skip = await datasetSkipReason(id);
  if (skip) {
    skipped.push(`${id}: ${skip}`);
    return null;
  }
  try {
    return await load();
  } catch (error) {
    if (!(error instanceof DatasetError) || error.code !== EXIT.network) {
      throw error;
    }
    skipped.push(`${id}: download failed after retries`);
    return null;
  }
}

async function auditAishell(skipped) {
  const source = await datasetForReport(AISHELL, skipped, () =>
    fetchDataset(AISHELL)
  );
  if (!source) {
    return null;
  }
  const lines = readFileSync(path.join(source.dir, 'content.txt'), 'utf8')
    .split(/\r?\n/u)
    .slice(0, 500);
  const audit = { lines: 0, labelled: 0, errors: 0, length: 0 };
  for (const line of lines) {
    const parsed = parseAishellLine(line);
    if (!parsed) {
      continue;
    }
    const reference = parsed.pinyin.map(pinyinSyllableToIpa).filter(Boolean);
    const { ipa } = textToIpa(parsed.chars.join(''), { lang: 'zh' });
    const hypothesis = toneSyllables(ipa).map(({ base, tone }) => ({
      base,
      tone: TONE_NUMBERS.get(tone),
    }));
    const score = compareSyllableTones(
      reference.map(({ ipa: base, tone }) => ({ base, tone })),
      hypothesis
    );
    audit.lines++;
    audit.labelled += reference.length;
    audit.errors += score.errors;
    audit.length += score.length;
  }
  return audit;
}

test(
  'recognition benchmark on public recordings',
  { skip: process.env.HEAVY !== '1' },
  async (t) => {
    const started = performance.now();
    const maxRows = Math.max(...BENCHMARK.sets.map(({ rows }) => rows));
    const limit = Math.min(heavyLimit(maxRows), maxRows);
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    const sets = {};
    const confusions = {};
    const skipped = [];
    const known = new Set();
    for (const set of BENCHMARK.sets) {
      const rows = await datasetForReport(set.id, skipped, () =>
        loadBenchmark({ set, limit })
      );
      if (!rows) {
        continue;
      }
      const scored = rows.map((row) => ({
        row,
        reference: prepareReference(row, set.language),
      }));
      const counts = (confusions[set.language] ??= new Map());
      const countConfusion = (ref, hyp) => {
        const pair = `${ref} → ${hyp}`;
        counts.set(pair, (counts.get(pair) ?? 0) + 1);
      };
      const levels = {};
      for (const level of LEVELS) {
        levels[level] = measureLevel(scored, set, { level }, countConfusion);
      }
      if (!known.has(set.language) && levels.medium.rates.utterances) {
        const options = { level: 'medium', languages: [set.language] };
        levels.mediumKnown = measureLevel(scored, set, options);
        known.add(set.language);
      }
      sets[set.id] = levels;
    }

    const aishell = await auditAishell(skipped);
    const minutes = (performance.now() - started) / 60_000;
    const fleursLanguage = fleursLanguageAccuracy(sets);
    const data = {
      schema: 1,
      commit,
      limit,
      sets,
      fleursLanguage,
      minutes,
      aishell,
    };
    const measured = {
      schema: data.schema,
      commit,
      limit,
      sets: Object.fromEntries(
        Object.entries(sets).map(([id, levels]) => [
          id,
          Object.fromEntries(
            Object.entries(levels).map(([level, { rates }]) => [level, rates])
          ),
        ])
      ),
    };
    const baseline = readBaseline();
    const notices = [];
    const notice = (message) => {
      t.diagnostic(message);
      notices.push(message);
    };
    const update = process.env.HEAVY_UPDATE_BASELINE === '1';
    const notes = process.env.HEAVY_BASELINE_REASON?.trim();
    const ratchet = checkBaseline(measured, baseline, { notice });
    const failures = checkFloors(measured.sets, fleursLanguage);
    if (update) {
      if (!notes) {
        failures.push(...baselineRegressions(measured, baseline));
      }
    } else {
      failures.push(...ratchet);
    }
    const limitFlag = limit < maxRows ? ` --limit ${limit}` : '';
    const command = `node scripts/run-heavy.mjs --suite recognition${limitFlag}`;
    const markdown = formatBenchmarkReport(data, {
      command,
      confusions,
      skipped,
      notices,
      failures,
    });
    writeReport('recognition-benchmark', markdown, data);
    assert.ok(failures.length === 0, failures.join('\n'));
    if (update) {
      saveBaseline(measured, markdown, notes);
    }
  }
);
