/**
 * Heavy check (issue 47): how much of real text the pronunciation lexicons
 * read. English and Hindi: the share of running words of the FLEURS
 * validation text (`fleurs-en`, `fleurs-hi`) whose source is not `rules`.
 * Chinese: the share of syllables of every tenth line of AISHELL-3
 * train/content.txt (`aishell3-train-index`; the build mines the other
 * nine) that `hanziToPinyin` reads as the transcript does. Writes
 * `lexicon-coverage.md` / `.json`. Fetch the data with
 * `node scripts/datasets.mjs fetch <id>`; a test whose data is missing is
 * skipped with the reason. Run with
 * `npm run test:heavy -- --suite lexicon`; HEAVY_LIMIT limits the lines
 * per text.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect } from 'test-anywhere';
import { DEFAULT_CACHE, readDataset } from '../../scripts/datasets.mjs';
import {
  aishellAccuracy,
  coverage,
  heldOut,
} from '../../scripts/lexicon-metrics.mjs';
import { itUnless } from '../helpers/skip.js';
import { heavyLimit, writeReport } from './helpers/report.js';

const limit = heavyLimit(Infinity);
const AISHELL = path.join(DEFAULT_CACHE, 'aishell3-train-index', 'content.txt');

/**
 * Lower bounds: English is the acceptance criterion of issue 47; Hindi and
 * Chinese are the values measured when the lexicons were built, so that a
 * change that reads less fails here. Issue 47 asks for at most half of the
 * 3050 Chinese errors of before (1525); the lexicon reaches 2437 (see the
 * pull request of issue 47 and experiments/issue-47-zh-errors.mjs).
 */
const LEXICON_FLOORS = Object.freeze({
  'fleurs-en': 0.98,
  'fleurs-hi': 0.018,
  'aishell3-train-index': 0.966,
});

const rows = [];
const fleursText = (id) =>
  readDataset(id)
    .map((row) => row.text)
    .filter(Boolean)
    .slice(0, limit);

const FLEURS = [
  ['en', 'fleurs-en', fleursText('fleurs-en')],
  ['hi', 'fleurs-hi', fleursText('fleurs-hi')],
];
const anyData =
  existsSync(AISHELL) || FLEURS.some(([, , lines]) => lines.length > 0);

describe('lexicon coverage of real text', () => {
  for (const [lang, id, lines] of FLEURS) {
    const it = itUnless(lines.length === 0 && `${id} is not fetched`);
    it(`reads ${id} from the lexicons`, () => {
      const result = coverage(lang, lines, { missing: 20 });
      rows.push({ id, lines: lines.length, units: result.words, ...result });
      expect(result.share).toBeGreaterThanOrEqual(LEXICON_FLOORS[id]);
    });
  }

  const it = itUnless(
    !existsSync(AISHELL) && 'aishell3-train-index is not fetched'
  );
  it('reads the held-out AISHELL-3 lines as written', () => {
    const lines = heldOut(
      readFileSync(AISHELL, 'utf8').split('\n').filter(Boolean)
    ).slice(0, limit);
    const result = aishellAccuracy(lines, { errors: 20 });
    rows.push({
      id: 'aishell3-train-index',
      lines: lines.length,
      units: result.syllables,
      ...result,
      missing: result.misread,
    });
    expect(result.share).toBeGreaterThanOrEqual(
      LEXICON_FLOORS['aishell3-train-index']
    );
  });

  itUnless(!anyData && 'none of the texts is fetched')(
    'writes the report',
    () => {
      const table = rows.map(
        (row) =>
          `| ${row.id} | ${row.lines} | ${row.units} | ${(100 * row.share).toFixed(2)} % | ${row.missing.map(([w, n]) => `${w} ${n}`).join(', ')} |`
      );
      const markdown = [
        '## Lexicon coverage (issue 47)',
        '',
        'Words (FLEURS) or syllables (AISHELL-3) read from the lexicons.',
        '',
        '| Text | Lines | Words or syllables | Read | Most frequent misses |',
        '| ---- | ----: | -----------------: | ---: | -------------------- |',
        ...table,
        '',
      ].join('\n');
      writeReport('lexicon-coverage', markdown, rows);
      expect(rows.length).toBeGreaterThan(0);
    }
  );
});
