/**
 * Heavy check (issue 19): the baseline quality report of every audio tier
 * against the golden recordings, written as reports/heavy/baseline-quality.md
 * and .json. Run with `npm run test:heavy -- --suite quality`; HEAVY_LIMIT
 * limits the utterances per language (default 6, the whole golden set).
 *
 * Each tier is a separate test (one `qualityReport` call), so no test comes
 * near the one-hour limit of scripts/run-heavy.mjs; the anchors are
 * computed once, with the first tier, and `mergeReports` joins the parts.
 */

import { describe, it, expect } from 'test-anywhere';
import {
  METRICS,
  mergeReports,
  qualityReport,
  renderMarkdown,
} from '../../scripts/quality-report.mjs';
import { heavyLimit, writeReport } from './helpers/report.js';

const TIERS = Object.freeze([
  'minimal',
  'low',
  'medium',
  'high',
  'ultra',
  'studio',
]);
const limit = heavyLimit(6);
const parts = [];

const isFiniteNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value);

describe('baseline quality against the golden recordings', () => {
  TIERS.forEach((tier, index) => {
    it(`scores tier ${tier}`, () => {
      const part = qualityReport({
        tiers: [tier],
        limit,
        anchors: index === 0,
        onProgress: (message) => console.error(message),
      });
      expect(part.rows.length).toBe(part.utterances.length);
      parts.push(part);
    });
  });

  it('writes the report', () => {
    expect(parts.length).toBe(TIERS.length);
    const data = mergeReports(parts);
    for (const row of [...data.rows, ...data.anchors]) {
      for (const key of ['lsd', 'mcd', 'timingRms', 'durationRatio']) {
        expect(isFiniteNumber(row[key])).toBe(true);
      }
      for (const key of METRICS) {
        expect(row[key] === null || isFiniteNumber(row[key])).toBe(true);
      }
    }
    writeReport('baseline-quality', renderMarkdown(data), data);

    for (const lang of data.settings.languages) {
      const noise = data.summary.find(
        (entry) => entry.lang === lang && entry.tier === 'noise'
      );
      for (const tier of TIERS) {
        const entry = data.summary.find(
          (item) => item.lang === lang && item.tier === tier
        );
        expect(entry.mean.mcd < noise.mean.mcd).toBe(true);
      }
    }
  });
});
