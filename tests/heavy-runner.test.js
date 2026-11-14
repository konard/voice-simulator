/**
 * scripts/run-heavy.mjs and the helpers of tests/heavy/ (issue 14). The
 * heavy tests themselves run only in the manually started `Heavy checks`
 * workflow; these checks are fast and part of `npm test`.
 */

import { describe, it, expect } from 'test-anywhere';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { heavyLimit, writeReport } from './heavy/helpers/report.js';
import { itUnless, sandboxed } from './helpers/skip.js';

const scriptPath = fileURLToPath(
  new URL('../scripts/run-heavy.mjs', import.meta.url)
);

const PASSING_TEST = `import test from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
test('a passes', () => {
  mkdirSync(process.env.HEAVY_OUT, { recursive: true });
  writeFileSync(process.env.HEAVY_OUT + '/quality-a.md', '## Report of a, limit ' + process.env.HEAVY_LIMIT + '\\n');
});
`;
const FAILING_TEST = `import test from 'node:test';
import assert from 'node:assert';
test('b fails', () => {
  assert.equal(1, 2);
});
`;

function runHeavy(args) {
  // A run inside GitHub Actions must not append to the real step summary;
  // blank values count as unset.
  const env = { ...process.env, GITHUB_STEP_SUMMARY: '', HEAVY_LIMIT: '' };
  const result = spawnSync('node', [scriptPath, ...args], {
    encoding: 'utf8',
    env,
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

function summaryRows(out) {
  return readFileSync(path.join(out, 'summary.md'), 'utf8')
    .split('\n')
    .filter((line) => /^\| \S+\.test\.js \|/.test(line));
}

function withTemporaryDir(callback) {
  const dir = mkdtempSync(path.join(tmpdir(), 'heavy-runner-'));
  try {
    return callback(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function withHeavyEnv(values, callback) {
  const saved = {};
  for (const [name, value] of Object.entries(values)) {
    saved[name] = process.env[name];
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  try {
    return callback();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

describe('run-heavy.mjs', () => {
  itUnless(sandboxed)('rejects an unknown suite', () => {
    const result = runHeavy(['--suite', 'nope']);

    expect(result.status).toBe(2);
    expect(result.output).toContain('Unknown suite: nope');
    expect(result.output).toContain(
      'all, quality, recognition, roundtrip, copy, performance, gpu'
    );
  });

  itUnless(sandboxed)('rejects a limit that is not a positive integer', () => {
    expect(runHeavy(['--limit', '0']).status).toBe(2);
    expect(runHeavy(['--limit', 'many']).status).toBe(2);
  });

  itUnless(sandboxed)('reports an empty suite', () => {
    withTemporaryDir((dir) => {
      const result = runHeavy(['--suite', 'copy', '--dir', dir]);

      expect(result.status).toBe(0);
      expect(result.output).toContain('suite copy: no test files');
    });
  });

  itUnless(sandboxed)('runs only the chosen suite and writes a summary', () => {
    withTemporaryDir((root) => {
      const dir = path.join(root, 'heavy');
      mkdirSync(dir);
      writeFileSync(path.join(dir, 'quality-a.test.js'), PASSING_TEST);
      writeFileSync(path.join(dir, 'copy-b.test.js'), FAILING_TEST);

      const qualityOut = path.join(root, 'out-quality');
      const quality = runHeavy([
        '--suite',
        'quality',
        '--limit',
        '4',
        '--dir',
        dir,
        '--out',
        qualityOut,
      ]);

      expect(quality.status).toBe(0);
      const qualityRows = summaryRows(qualityOut);
      expect(qualityRows.length).toBe(1);
      expect(qualityRows[0]).toContain('| quality-a.test.js | pass |');
      const qualitySummary = readFileSync(
        path.join(qualityOut, 'summary.md'),
        'utf8'
      );
      expect(qualitySummary).toContain('## Report of a, limit 4');

      const allOut = path.join(root, 'out-all');
      const all = runHeavy(['--suite', 'all', '--dir', dir, '--out', allOut]);

      expect(all.status).toBe(1);
      const allRows = summaryRows(allOut);
      expect(allRows.length).toBe(2);
      expect(allRows[0]).toContain('| copy-b.test.js | fail |');
      expect(allRows[1]).toContain('| quality-a.test.js | pass |');
      expect(readFileSync(path.join(allOut, 'summary.md'), 'utf8')).toContain(
        '## Report of a, limit undefined'
      );
    });
  });
});

describe('heavy test helpers', () => {
  it('heavyLimit falls back', () => {
    withHeavyEnv({ HEAVY_LIMIT: undefined }, () => {
      expect(heavyLimit(7)).toBe(7);
    });
    withHeavyEnv({ HEAVY_LIMIT: '3' }, () => {
      expect(heavyLimit(7)).toBe(3);
    });
    for (const value of ['', '0', '-2', '1.5', 'many']) {
      withHeavyEnv({ HEAVY_LIMIT: value }, () => {
        expect(heavyLimit(7)).toBe(7);
      });
    }
  });

  itUnless(sandboxed)('writeReport writes Markdown and JSON', () => {
    withTemporaryDir((dir) => {
      const out = path.join(dir, 'reports');
      withHeavyEnv({ HEAVY_OUT: out }, () => {
        writeReport('demo', '## Demo', { value: 1 });
      });

      expect(readFileSync(path.join(out, 'demo.md'), 'utf8')).toBe('## Demo\n');
      expect(
        JSON.parse(readFileSync(path.join(out, 'demo.json'), 'utf8'))
      ).toEqual({ value: 1 });
    });
  });
});

describe('heavy test isolation', () => {
  it('keeps heavy tests out of the regular runs', () => {
    expect(readFileSync('bunfig.toml', 'utf8')).toContain('tests/heavy/**');
    const deno = JSON.parse(readFileSync('deno.json', 'utf8'));
    expect(deno.test.exclude).toContain('tests/heavy/');
    expect(
      JSON.parse(readFileSync('package.json', 'utf8')).scripts.test
    ).toContain('tests/*.test.js');
    expect(existsSync('tests/heavy/README.md')).toBe(true);
  });

  it('starts the heavy workflow only by hand', () => {
    const workflow = readFileSync('.github/workflows/heavy.yml', 'utf8');
    const triggers = workflow.slice(
      workflow.indexOf('\non:\n'),
      workflow.indexOf('\npermissions:\n')
    );

    expect(workflow).toContain('name: Heavy checks');
    expect(triggers).toContain('workflow_dispatch:');
    expect(triggers).not.toMatch(/^\s{2}(push|pull_request|schedule):/m);
    expect(workflow).toContain('npm run test:heavy -- --suite "$SUITE"');
  });

  // The step budget owns the deadline (docs/CI-TIMEOUT-BUDGETS.md): it must
  // expire with room for checkout, install and upload before the job cap.
  it('lets the heavy step budget expire before the job backstop', () => {
    const workflow = readFileSync('.github/workflows/heavy.yml', 'utf8');
    const budget = Number(
      workflow.match(/run-with-budget-warning\.sh (\d+) "Heavy checks"/)[1]
    );
    const heavyJob = workflow.slice(
      workflow.indexOf('\n  heavy:\n'),
      workflow.indexOf('\n  pipeline-status:\n')
    );
    const backstop = Number(heavyJob.match(/timeout-minutes: (\d+)/)[1]);

    expect(backstop).toBeLessThanOrEqual(360);
    expect(backstop * 60 - budget).toBeGreaterThanOrEqual(20 * 60);
  });
});
