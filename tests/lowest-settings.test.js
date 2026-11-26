/**
 * Lowest settings (issue 81): 8 kHz synthesis and recognition, one row of
 * the certification matrix and the publication rules of
 * scripts/lowest-settings.mjs. The full matrix is a heavy suite
 * (tests/heavy/lowest-settings.test.js). Unlicense.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { promisify } from 'node:util';
import { recognize, synthesize } from '../src/index.js';
import {
  README_END,
  README_START,
  REPORT_PATH,
  replaceReadmeTable,
} from '../scripts/lowest-report.mjs';
import { checkBlockedGate } from './helpers/blocked-gate.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SCRIPT = path.join(ROOT, 'scripts/lowest-settings.mjs');
const run = promisify(execFile);
const text = 'Hello world.';
let spoken;
const speak = () =>
  (spoken ??= synthesize(text, { lang: 'en', tier: 'telephone', seed: 1 }));

// The row runs in its own process, alongside the recognition below.
const oneRow = run(
  process.execPath,
  [SCRIPT, '--row', 'synthesis', '--engine', 'js', '--limit', '1'],
  { cwd: ROOT, env: { ...process.env, UV_THREADPOOL_SIZE: '1' } }
);
oneRow.catch(() => {});

describe('lowest settings', () => {
  it('speaks at 8 kHz', () => {
    const { samples, sampleRate } = speak();
    assert.equal(sampleRate, 8000);
    assert.ok(samples.length > 0.3 * sampleRate);
    let peak = 0;
    for (const sample of samples) {
      assert.ok(Number.isFinite(sample));
      peak = Math.max(peak, Math.abs(sample));
    }
    assert.ok(peak >= 0.01 && peak <= 1, `peak ${peak}`);
  });

  it('understands its own 8 kHz speech', () => {
    const { samples, sampleRate } = speak();
    // One language: without it every lexicon is built (about 4x the CPU).
    const heard = recognize(samples, sampleRate, {
      languages: ['en'],
      level: 'low',
    });
    const said = heard.text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .trim();
    checkBlockedGate({
      criterion: 'understands its own 8 kHz speech (issue 81)',
      passed: said === 'hello world',
      measured: `"${text}" at the telephone tier is recognised at level low as "${heard.text}"`,
      action:
        'make the recogniser hear its own "Hello world." (https://github.com/konard/voice-simulator/issues/181) or choose another sentence in issue 81',
    });
  });

  it('runs one row', { timeout: 120_000 }, async () => {
    const { stdout } = await oneRow;
    const result = JSON.parse(stdout.trim().split('\n').at(-1));
    assert.equal(result.row, 'synthesis');
    assert.equal(result.engine, 'js');
    assert.ok(Number.isFinite(result.metrics.rtf), stdout);
    assert.ok(result.seconds > 0 && result.audioSeconds > 0, stdout);
    assert.ok(Number.isFinite(result.peakRssMb), stdout);
    checkBlockedGate({
      criterion: 'one synthesis row runs in under 256 MB (issue 81)',
      passed: result.peakRssMb < 256,
      measured: `peak resident memory ${result.peakRssMb} MB, most of it the recognition network that scores the speech`,
      action:
        'shrink the recognition network (https://github.com/konard/voice-simulator/issues/173) or raise the memory limit in issue 81',
    });
  });

  describe('publication', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lowest-settings-'));
    after(() => rmSync(dir, { recursive: true, force: true }));
    const cells = (status) => ({
      synthesis: {
        quality: { status: 'certified', metrics: {} },
        'js-1': { status, metrics: {} },
      },
    });
    const report = (status) => ({
      version: 1,
      measured: '2026-01-01T00:00:00.000Z',
      commit: '0123456789abcdef',
      command: 'node scripts/run-heavy.mjs --suite lowest',
      cpu: 'test CPU',
      node: 'v0.0.0',
      pinned: true,
      core: 0,
      limits: {},
      runs: {},
      cells: cells(status),
      regressions: [],
    });
    const reportJson = path.join(dir, REPORT_PATH.replace(/\.md$/u, '.json'));
    const files = () =>
      [path.join(dir, 'README.md'), path.join(dir, REPORT_PATH), reportJson]
        .map((file) => readFileSync(file, 'utf8'))
        .join('\n');
    mkdirSync(path.dirname(reportJson), { recursive: true });
    mkdirSync(path.join(dir, 'measured'));
    writeFileSync(
      path.join(dir, 'README.md'),
      `# Fixture\n\n${README_START}\nold table\n${README_END}\n`
    );
    writeFileSync(path.join(dir, REPORT_PATH), '# Old report\n');
    writeFileSync(reportJson, JSON.stringify(report('certified')));
    writeFileSync(
      path.join(dir, 'measured', 'lowest-settings.json'),
      JSON.stringify(report('failed'))
    );
    const publish = (...extra) =>
      run(
        process.execPath,
        [
          SCRIPT,
          '--publish',
          path.join(dir, 'measured'),
          '--root',
          dir,
          ...extra,
        ],
        { cwd: ROOT }
      );

    it('refuses a regression', async () => {
      const before = files();
      await assert.rejects(publish(), (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /synthesis\/js-1 \(failed\)/u);
        return true;
      });
      assert.equal(files(), before);
      await publish('--allow-regression', 'test');
      const written = files();
      assert.notEqual(written, before);
      assert.match(written, /## Regressions/u);
      assert.match(written, /synthesis \/ js-1 is failed.*Reason: test/u);
      const readme = readFileSync(path.join(dir, 'README.md'), 'utf8');
      assert.match(readme, /\| synthesis \| certified \| failed \|/u);
      assert.doesNotMatch(readme, /old table/u);
    });
  });

  it('keeps the README table current', () => {
    const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    const committed = JSON.parse(
      readFileSync(
        path.join(ROOT, REPORT_PATH.replace(/\.md$/u, '.json')),
        'utf8'
      )
    );
    assert.equal(
      replaceReadmeTable(readme, committed),
      readme,
      'run node scripts/lowest-settings.mjs --publish reports/heavy'
    );
  });
});
