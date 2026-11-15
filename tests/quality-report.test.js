/**
 * Baseline quality report against the golden recordings (issue 19):
 * scripts/quality-report.mjs on one English utterance, its Markdown and the
 * committed baseline in docs/reports/.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'test-anywhere';

import {
  METRICS,
  mergeReports,
  parseArguments,
  qualityReport,
  renderMarkdown,
} from '../scripts/quality-report.mjs';
import { loadManifest } from '../scripts/golden.mjs';

const OPTIONS = { lang: ['en'], tiers: ['minimal'], limit: 1 };
const first = qualityReport(OPTIONS);

const isFiniteNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value);

describe('quality report', () => {
  it('reports one utterance', () => {
    expect(first.schema).toBe(1);
    expect(first.utterances.length).toBe(1);
    expect(first.rows.length).toBe(1);
    expect(first.anchors.length).toBe(2);
    const [row] = first.rows;
    for (const key of METRICS) {
      expect(isFiniteNumber(row[key])).toBe(true);
    }
    expect(row.rtf > 0).toBe(true);
    expect(isFiniteNumber(first.utterances[0].per)).toBe(true);
    expect(first.settings).toEqual({
      tiers: ['minimal'],
      languages: ['en'],
      seed: 1,
      limit: 1,
    });
  });

  it('anchors bracket the scale', () => {
    const lowpass = first.anchors.find((row) => row.tier === 'lowpass');
    const noise = first.anchors.find((row) => row.tier === 'noise');
    expect(lowpass.mcd < noise.mcd).toBe(true);
    expect(lowpass.lsd < noise.lsd).toBe(true);
  });

  it('is deterministic', () => {
    const second = qualityReport(OPTIONS);
    const strip = (rows) =>
      rows.map((row) => ({ ...row, renderSeconds: 0, rtf: 0 }));
    expect(strip(second.rows)).toEqual(strip(first.rows));
    expect(second.anchors).toEqual(first.anchors);
    expect(second.utterances).toEqual(first.utterances);
  });

  it('renders markdown', () => {
    const markdown = renderMarkdown(first);
    expect(markdown.includes('## Summary')).toBe(true);
    expect(
      markdown.split('\n').some((line) => line.startsWith('| minimal'))
    ).toBe(true);
    expect(markdown.includes('| en-01* |')).toBe(true);
    expect(markdown.includes('## How to read this')).toBe(true);
  });

  it('shows differences to a baseline', () => {
    const baseline = JSON.parse(JSON.stringify(first));
    for (const entry of baseline.summary) {
      entry.mean.mcd += 1;
    }
    const line = renderMarkdown(first, baseline)
      .split('\n')
      .find((text) => text.startsWith('| minimal'));
    expect(line.includes('(−1')).toBe(true);
  });

  it('merges reports of different tiers', () => {
    const other = {
      ...JSON.parse(JSON.stringify(first)),
      settings: { ...first.settings, tiers: ['other'] },
      rows: first.rows.map((row) => ({ ...row, tier: 'other', mcd: 1 })),
      anchors: [],
    };
    other.utterances[0].per = null;
    const merged = mergeReports([first, other]);
    expect(merged.settings.tiers).toEqual(['minimal', 'other']);
    expect(merged.rows.length).toBe(2);
    expect(merged.anchors).toEqual(first.anchors);
    expect(merged.utterances).toEqual(first.utterances);
    const entry = merged.summary.find(
      (item) => item.lang === 'en' && item.tier === 'other'
    );
    expect(entry.mean.mcd).toBe(1);
    expect(merged.summary.some((item) => item.tier === 'noise')).toBe(true);
    expect(() => mergeReports([])).toThrow(RangeError);
  });

  it('parses the command line', () => {
    const options = parseArguments([
      '--lang',
      'en,ru',
      '--limit',
      '2',
      '--update-docs',
    ]);
    expect(options.lang).toEqual(['en', 'ru']);
    expect(options.limit).toBe(2);
    expect(options.tiers).toEqual(['minimal', 'low', 'medium']);
    expect(options.updateDocs).toBe(true);
    expect(() => parseArguments(['--limit', '0'])).toThrow(RangeError);
    expect(() => parseArguments(['--nope'])).toThrow(RangeError);
  });

  const committed = fileURLToPath(
    import.meta.resolve('../docs/reports/baseline-quality.json')
  );
  it('committed baseline is consistent', () => {
    expect(existsSync(committed)).toBe(true);
    const data = JSON.parse(readFileSync(committed, 'utf8'));
    expect(data.schema).toBe(1);
    const ids = loadManifest().utterances.map((u) => u.id);
    for (const tier of data.settings.tiers) {
      const covered = data.rows
        .filter((row) => row.tier === tier)
        .map((row) => row.id);
      expect([...covered].sort()).toEqual([...ids].sort());
    }
    for (const entry of data.summary) {
      for (const key of ['mcd', 'lsd', 'timingRms', 'durationRatio']) {
        expect(isFiniteNumber(entry.mean[key])).toBe(true);
      }
    }
  });
});
