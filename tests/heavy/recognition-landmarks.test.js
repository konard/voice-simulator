/** Golden-set syllable counts and the complete threshold recalibration.
 * Run with npm run test:heavy -- --suite recognition. */
import { describe, it, expect } from 'test-anywhere';
import { analyzeFrames, findLandmarks, syllabifyIpa } from '../../src/index.js';
import { loadGolden, isReviewed } from '../helpers/golden.js';
import { heavyLimit, writeReport } from './helpers/report.js';
import { calibrationMaterial } from '../../scripts/landmark-material.mjs';
import {
  calibrate,
  SEARCH_RANGES,
} from '../../scripts/calibrate-landmarks.mjs';
import { LANDMARK_THRESHOLDS } from '../../src/recognition/landmark-thresholds.js';

describe('recognition landmarks: golden set', () => {
  it('counts syllables per utterance and writes the report', () => {
    const rows = loadGolden()
      .slice(0, heavyLimit(Infinity))
      .map((item) => {
        const truth = syllabifyIpa(item.ipa, { language: item.lang }).flat()
          .length;
        const found = findLandmarks(
          analyzeFrames(item.samples, item.sampleRate)
        ).nuclei.length;
        return {
          id: item.id,
          reviewed: isReviewed(item),
          true: truth,
          found,
          relativeError: Math.abs(found - truth) / truth,
        };
      });
    const meanAbsoluteRelativeError =
      rows.reduce((sum, row) => sum + row.relativeError, 0) / rows.length;
    writeReport(
      'recognition-landmarks',
      [
        '# Syllable nuclei on the golden set (issue 62)',
        '',
        'Command: `node --test tests/heavy/recognition-landmarks.test.js`.',
        'Truth: syllabifyIpa of the committed IPA, by language. An asterisk',
        'marks an utterance whose text and IPA have not both been reviewed by a person.',
        '',
        '| Utterance | True syllables | Found nuclei | Absolute relative error |',
        '| --- | ---: | ---: | ---: |',
        ...rows.map(
          (r) =>
            `| ${r.id}${r.reviewed ? '' : '*'} | ${r.true} | ${r.found} | ${(100 * r.relativeError).toFixed(2)}% |`
        ),
        '',
        `Mean absolute relative error: **${(100 * meanAbsoluteRelativeError).toFixed(2)}%**.`,
        'The 15% target is measured, not a gate.',
        '',
      ].join('\n'),
      { rows, meanAbsoluteRelativeError }
    );
    expect(rows.length > 0).toBe(true);
  });
  it('thresholds are up to date', () => {
    const result = calibrate(calibrationMaterial(0.1));
    for (const [key, [low, high]] of Object.entries(SEARCH_RANGES)) {
      const difference = Math.abs(
        result.thresholds[key] - LANDMARK_THRESHOLDS[key]
      );
      console.log(
        `threshold ${key}: tenth ${result.thresholds[key]}, committed ${LANDMARK_THRESHOLDS[key]}, difference ${difference}`
      );
      expect(difference <= (high - low) / 20 + 1e-8).toBe(true);
    }
  });
});
