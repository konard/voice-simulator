/**
 * Heavy check (issue 59): the pitch and voicing tracker of the recognizer on
 * real speech with a laryngograph reference, GPE, VDE and FFE against the
 * reference f0 (target, not a gate: FFE at most 0.10). The candidate corpora
 * (PTDB-TUG, Keele, CSTR FDA) are all refused by the licence policy of
 * docs/CONTRIBUTING.md and listed in datasets/refused.json, so no corpus is
 * registered: the measurement is skipped with the reason and the report says
 * so. Run with `npm run test:heavy -- --suite recognition`.
 */

import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, it } from 'test-anywhere';
import { itUnless } from '../helpers/skip.js';
import { writeReport } from './helpers/report.js';

/** Registry ids of corpora with a laryngograph f0 reference. */
const PITCH_CORPORA = Object.freeze([]);

/** Corpora named by issue 59, by the URL of their refused.json entry. */
const CANDIDATES = Object.freeze([
  [
    'PTDB-TUG',
    'https://www.spsc.tugraz.at/databases-and-tools/ptdb-tug-pitch-tracking-database-from-graz-university-of-technology.html',
  ],
  ['Keele', 'https://zenodo.org/records/3920591'],
  ['CSTR FDA', 'https://www.cstr.ed.ac.uk/research/projects/fda'],
]);

const refused = JSON.parse(
  readFileSync(new URL('../../datasets/refused.json', import.meta.url), 'utf8')
);

const candidates = CANDIDATES.map(([name, url]) => {
  const entry = refused.find((item) => item.url === url);
  return {
    name,
    url,
    licence: entry?.licence ?? null,
    reason: entry?.reason ?? null,
  };
});

describe('recognition pitch on real speech', () => {
  itUnless(
    PITCH_CORPORA.length === 0 &&
      'no corpus with a laryngograph reference has a permitted licence'
  )('measures GPE, VDE and FFE against a laryngograph', () => {
    expect(PITCH_CORPORA.length).toBeGreaterThan(0);
  });

  it('writes the report', () => {
    const markdown = [
      '## Pitch and voicing tracker on real speech (issue 59)',
      '',
      'No corpus with a laryngograph reference and a permitted licence was',
      'found, so GPE, VDE and FFE on real speech are not measured (target:',
      'FFE at most 0.10). The candidates and why the licence policy of',
      'docs/CONTRIBUTING.md refuses them (datasets/refused.json):',
      '',
      '| Corpus | Licence | Reason |',
      '| ------ | ------- | ------ |',
      ...candidates.map(
        (item) =>
          `| [${item.name}](${item.url}) | ${item.licence} | ${item.reason} |`
      ),
      '',
      'The synthetic checks of tests/recognition-pitch.test.js measure the',
      'same errors against the planned f0 of the simulator.',
      '',
    ].join('\n');
    writeReport('recognition-pitch', markdown, {
      corpora: PITCH_CORPORA,
      candidates,
      measured: null,
    });
    for (const item of candidates) {
      expect(item.reason).not.toBe(null);
    }
  });
});
