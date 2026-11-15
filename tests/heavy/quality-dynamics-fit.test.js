/**
 * Heavy check (issue 38, P26 of issue 11): the fit of the articulator
 * dynamics to the golden recordings, experiments/issue-11-fit-dynamics.mjs,
 * written as reports/heavy/dynamics-fit.md and .json. Run with
 * `npm run test:heavy -- --suite quality`; HEAVY_LIMIT limits the
 * recordings per language (default 6, the whole golden set).
 *
 * The committed result is experiments/issue-11-fit-dynamics.txt; this test
 * repeats the fit so that a change of the synthesis that moves it shows up.
 * That fit took 37 minutes on 5 workers for 6 rounds; a hosted runner has
 * 4 cores, so the test stops after `ROUNDS` rounds to stay inside the
 * one-hour limit per test of scripts/run-heavy.mjs. The first 3 rounds
 * gave 0.52 of the 0.56 percentage points of the whole fit.
 */

import { describe, it, expect } from 'test-anywhere';
import { fitDynamics } from '../../experiments/issue-11-fit-dynamics.mjs';
import { heavyLimit, writeReport } from './helpers/report.js';

const ROUNDS = 3;

const isFiniteNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value);

describe('articulator dynamics against the golden recordings', () => {
  it('fits time constants, leads and resistance', async () => {
    const { text, data } = await fitDynamics({
      limit: heavyLimit(6),
      rounds: ROUNDS,
      log: (line) => console.error(line),
    });
    expect(data.recordings.length > 0).toBe(true);
    expect(data.channels.length > 0).toBe(true);
    for (const row of [...data.before, ...data.after]) {
      expect(row.mean === null || isFiniteNumber(row.mean)).toBe(true);
    }
    // Coordinate descent never accepts a step that raises the train error.
    const [before] = data.before;
    const [after] = data.after;
    expect(after.mean <= before.mean + 1e-6).toBe(true);
    writeReport('dynamics-fit', `\`\`\`text\n${text}\`\`\`\n`, data);
  });
});
