/**
 * The speed rules and the trend of scripts/performance.mjs (issue 31), on
 * made-up reports.
 */

import { describe, it, expect } from 'test-anywhere';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  calibrate,
  comparePerformance,
  main,
  measureRows,
  trendMarkdown,
} from '../scripts/performance.mjs';

const SOLVERS = {
  telephone: 'waveguide',
  minimal: 'waveguide',
  medium: 'waveguide',
  high: 'fdtd3d',
};
const RTF = {
  js: { telephone: 0.05, minimal: 0.1, medium: 0.15, high: 1.4 },
  rust: { telephone: 0.02, minimal: 0.05, medium: 0.08, high: 1 },
};

function makeReport(options = {}) {
  const rows = [];
  for (const engine of ['js', 'rust']) {
    for (const [tier, solver] of Object.entries(SOLVERS)) {
      rows.push({
        task: 'synthesis',
        engine,
        tier,
        solver,
        sampleRate: 22050,
        duration: 3.5,
        runs: solver === 'waveguide' ? 5 : 2,
        seconds: RTF[engine][tier] * 3.5,
        median: RTF[engine][tier] * 3.5,
        rtf: RTF[engine][tier],
      });
    }
  }
  return {
    schema: 1,
    date: '2026-11-16T10:00:00.000Z',
    commit: 'abcdef0123456789',
    version: '0.11.31',
    machine: {
      cpu: 'Test CPU',
      cores: 4,
      platform: 'linux',
      arch: 'x64',
      runtime: 'node 24.0.0',
    },
    text: 'The quick brown fox jumps over the dog.',
    calibration: 0.02,
    rows,
    ...options,
  };
}

function rowOf(report, engine, tier) {
  return report.rows.find((row) => row.engine === engine && row.tier === tier);
}

// The rules of the issue are stated with a tolerance of 1.5.
const OPTIONS = { tolerance: 1.5 };

describe('comparePerformance (issue 31)', () => {
  it('equal reports pass', () => {
    const result = comparePerformance(makeReport(), makeReport(), OPTIONS);
    expect(result.ok).toBe(true);
    expect(result.scale).toBe(1);
    expect(result.failures).toEqual([]);
    expect(result.rows.every((row) => row.status === 'ok')).toBe(true);
    expect(result.rows.length).toBe(8);
  });

  it('a slow tier fails', () => {
    const slow = makeReport();
    rowOf(slow, 'js', 'medium').rtf *= 1.6;
    const result = comparePerformance(slow, makeReport(), OPTIONS);
    expect(result.ok).toBe(false);
    expect(result.failures.length).toBe(1);
    expect(result.failures[0]).toContain('medium');
    expect(result.failures[0]).toContain('js');
    expect(rowOf(result, 'js', 'medium').status).toBe('slower');

    const slightly = makeReport();
    rowOf(slightly, 'js', 'medium').rtf *= 1.4;
    expect(comparePerformance(slightly, makeReport(), OPTIONS).ok).toBe(true);
  });

  it('a slower machine is forgiven', () => {
    const slow = makeReport({ calibration: 0.06 });
    for (const row of slow.rows) {
      row.rtf *= 3;
    }
    const result = comparePerformance(slow, makeReport(), OPTIONS);
    expect(Math.abs(result.scale - 3) < 1e-9).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('rust must not be slower', () => {
    const report = makeReport();
    rowOf(report, 'rust', 'minimal').rtf =
      rowOf(report, 'js', 'minimal').rtf * 1.2;
    const result = comparePerformance(report, report, OPTIONS);
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(['rust is slower than js at minimal']);
  });

  it('waveguide tiers must be real time', () => {
    const report = makeReport();
    rowOf(report, 'js', 'telephone').rtf = 0.6;
    rowOf(report, 'rust', 'telephone').rtf = 0.3;
    const result = comparePerformance(report, report, OPTIONS);
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(['telephone is not real time on js']);

    const threeD = makeReport();
    rowOf(threeD, 'js', 'high').rtf = 0.6;
    rowOf(threeD, 'rust', 'high').rtf = 0.6;
    expect(comparePerformance(threeD, threeD, OPTIONS).ok).toBe(true);
  });

  it('missing and new rows', () => {
    const report = makeReport();
    report.rows = report.rows.filter(
      (row) => !(row.engine === 'rust' && row.tier === 'high')
    );
    const missing = comparePerformance(report, makeReport(), OPTIONS);
    expect(missing.ok).toBe(false);
    expect(missing.failures).toEqual(['synthesis/rust/high is missing']);
    expect(rowOf(missing, 'rust', 'high').status).toBe('missing');
    expect(
      comparePerformance(report, makeReport(), { ...OPTIONS, partial: true }).ok
    ).toBe(true);

    const extra = makeReport();
    extra.rows.push({ ...rowOf(extra, 'rust', 'high'), engine: 'rust-mt' });
    const result = comparePerformance(extra, makeReport(), OPTIONS);
    expect(rowOf(result, 'rust-mt', 'high').status).toBe('new');
    expect(result.ok).toBe(true);
  });

  it('faster is reported', () => {
    const fast = makeReport();
    rowOf(fast, 'js', 'high').rtf /= 2;
    rowOf(fast, 'rust', 'high').rtf /= 2;
    const result = comparePerformance(fast, makeReport(), OPTIONS);
    expect(rowOf(result, 'js', 'high').status).toBe('faster');
    expect(result.ok).toBe(true);
  });
});

describe('trend (issue 31)', () => {
  it('trend keeps one row per commit', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'performance-trend-'));
    try {
      const file = path.join(dir, 'report.json');
      writeFileSync(file, JSON.stringify(makeReport()));
      const quiet = { log: () => {}, error: () => {} };
      expect(main(['trend', file, '--dir', dir], quiet)).toBe(0);
      writeFileSync(
        file,
        JSON.stringify(makeReport({ date: '2026-11-17T10:00:00.000Z' }))
      );
      expect(main(['trend', file, '--dir', dir], quiet)).toBe(0);

      const history = JSON.parse(
        readFileSync(path.join(dir, 'performance-history.json'), 'utf8')
      );
      expect(history.schema).toBe(1);
      expect(history.runs.length).toBe(1);
      expect(history.runs[0].date).toBe('2026-11-17T10:00:00.000Z');
      const markdown = readFileSync(path.join(dir, 'performance.md'), 'utf8');
      const rows = markdown
        .split('\n')
        .filter((line) => line.startsWith('| 2026'));
      expect(rows.length).toBe(1);
      expect(rows[0]).toContain('0.05 / 0.02');
      expect(rows[0]).toContain('abcdef0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('trendMarkdown writes "-" where a row is missing', () => {
    const report = makeReport();
    report.rows = report.rows.filter((row) => row.engine === 'js');
    const markdown = trendMarkdown({ runs: [report] }, ['telephone', 'ultra']);
    expect(markdown).toContain('| 0.05 / - | - / - |');
  });

  it('unreadable files and another schema exit with 2', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'performance-files-'));
    try {
      const quiet = { log: () => {}, error: () => {} };
      const file = path.join(dir, 'report.json');
      expect(main(['compare', file], quiet)).toBe(2);
      writeFileSync(file, JSON.stringify(makeReport({ schema: 2 })));
      expect(main(['trend', file, '--dir', dir], quiet)).toBe(2);
      writeFileSync(file, '{');
      expect(main(['baseline', file, '--dir', dir], quiet)).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('compare exits with 1 and names the row that is slower', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'performance-compare-'));
    try {
      const lines = [];
      const io = { log: (line) => lines.push(line), error: () => {} };
      const baseline = path.join(dir, 'baseline.json');
      const file = path.join(dir, 'report.json');
      writeFileSync(baseline, JSON.stringify(makeReport()));
      writeFileSync(file, JSON.stringify(makeReport()));
      expect(main(['compare', file, '--baseline', baseline], io)).toBe(0);
      const slow = makeReport();
      rowOf(slow, 'rust', 'high').rtf *= 2;
      writeFileSync(file, JSON.stringify(slow));
      expect(main(['compare', file, '--baseline', baseline], io)).toBe(1);
      expect(lines.join('\n')).toContain('synthesis/rust/high is slower');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('measuring (issue 31)', () => {
  it('calibrate returns a positive time below 1 s', () => {
    const seconds = calibrate();
    expect(seconds > 0).toBe(true);
    expect(seconds < 1).toBe(true);
  });

  it('measureRows warms up, then keeps the fastest run', () => {
    let clock = 0;
    const calls = [];
    const synthesize = (text, options) => {
      calls.push([text, options.engine, options.threads]);
      clock += text === 'Hi.' ? 1000 : 100 * calls.length;
      return { sampleRate: 8000, duration: 2, samples: new Float32Array(1) };
    };
    const rows = measureRows({
      tiers: [
        { name: 'telephone', solver: 'waveguide' },
        { name: 'high', solver: 'fdtd3d' },
      ],
      engines: ['js'],
      text: 'Hello.',
      synthesize,
      now: () => clock,
    });
    expect(calls.length).toBe(1 + 5 + 1 + 2);
    expect(calls[0]).toEqual(['Hi.', 'js', 1]);
    expect(rows.map((row) => row.runs)).toEqual([5, 2]);
    // The first timed call of telephone is call 2: 200 ms.
    const near = (value, expected) => Math.abs(value - expected) < 1e-9;
    expect(near(rows[0].seconds, 0.2)).toBe(true);
    expect(near(rows[0].rtf, 0.1)).toBe(true);
    expect(near(rows[0].median, 0.4)).toBe(true);
    const { task, engine, tier, solver, sampleRate, duration } = rows[1];
    expect({ task, engine, tier, solver, sampleRate, duration }).toEqual({
      task: 'synthesis',
      engine: 'js',
      tier: 'high',
      solver: 'fdtd3d',
      sampleRate: 8000,
      duration: 2,
    });
  });
});
