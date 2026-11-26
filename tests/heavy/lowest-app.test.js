/**
 * The example app at the lowest settings (issue 81): CPU throttled 6 times,
 * telephone tier. Writes <HEAVY_OUT>/lowest-app.json, the app row of the
 * lowest-settings report (tests/heavy/lowest-settings.test.js runs after).
 * Unlicense.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import {
  appFailures,
  checkAppLowest,
} from '../../scripts/check-app-lowest.mjs';
import { playwrightChromium } from '../../scripts/check-app-copy.mjs';
import {
  judge,
  regressions,
  REPORT_PATH,
} from '../../scripts/lowest-report.mjs';
import { heavyOut } from './helpers/report.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (file) =>
  existsSync(join(ROOT, file))
    ? JSON.parse(readFileSync(join(ROOT, file), 'utf8'))
    : null;

function save(result) {
  mkdirSync(heavyOut(), { recursive: true });
  writeFileSync(
    join(heavyOut(), 'lowest-app.json'),
    `${JSON.stringify({ result }, null, 2)}\n`
  );
}

test(
  'speaks and recognises in the app at 8 kHz with the CPU throttled 6 times',
  { timeout: 1_800_000 },
  async (t) => {
    if (!(await playwrightChromium())) {
      const reason = 'Playwright Chromium is not installed';
      save({ row: 'app', engine: 'js', unavailable: reason });
      t.skip(`${reason}: the app row is unavailable`);
      return;
    }
    let result;
    try {
      result = await checkAppLowest();
    } catch (error) {
      save({ row: 'app', engine: 'js', error: error.message });
      throw error;
    }
    save(result);
    console.log('lowest app', JSON.stringify(result));
    // A missed limit is reported (failed in the report, with an issue);
    // only an app cell certified in the committed report may not fail.
    for (const failure of appFailures(result)) {
      console.log(`lowest app: ${failure}`);
    }
    const { app } = read('tests/heavy/lowest-thresholds.json');
    const committed = read(REPORT_PATH.replace(/\.md$/u, '.json'));
    const now = { cells: judge({ app: { js: result } }, { app }) };
    const before = committed && { cells: { app: committed.cells.app } };
    assert.deepEqual(regressions(before, now, { failedOnly: true }), []);
  }
);
