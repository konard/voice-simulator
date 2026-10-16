import { describe, expect } from 'test-anywhere';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { itUnless, noPosixShell, sandboxed } from './helpers/skip.js';

const SCRIPT = 'scripts/check-dependency-graph.sh';
// PATH entries are directories, so the stub lives at
// tests/fixtures/dependency-graph-stub/gh and the directory goes on PATH.
const STUB_DIR = 'tests/fixtures/dependency-graph-stub';
const SETTINGS_URL = 'https://github.com/owner/repo/settings/security_analysis';

const itShell = itUnless(sandboxed, noPosixShell);

function runCheck({ compareStatus, mode, baseSha = 'base' }) {
  const dir = mkdtempSync(join(tmpdir(), 'dependency-graph-'));
  try {
    writeFileSync(join(dir, 'compare_status'), String(compareStatus));
    writeFileSync(join(dir, 'parent'), 'parent\n');
    const output = join(dir, 'output');
    const result = spawnSync('bash', [SCRIPT], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${STUB_DIR}:${process.env.PATH}`,
        DEPENDENCY_GRAPH_FIXTURE_DIR: dir,
        REPOSITORY: 'owner/repo',
        BASE_SHA: baseSha,
        HEAD_SHA: 'head',
        DEPENDENCY_GRAPH_MODE: mode,
        GITHUB_OUTPUT: output,
      },
    });
    return {
      status: result.status,
      stdout: result.stdout,
      output: existsSync(output) ? readFileSync(output, 'utf8') : '',
      requests: readFileSync(join(dir, 'requests'), 'utf8'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('check-dependency-graph.sh', () => {
  itShell('reports an enabled graph in both modes', () => {
    for (const mode of ['warn', 'require']) {
      const result = runCheck({ compareStatus: 200, mode });

      expect(result.status).toBe(0);
      expect(result.output).toBe('enabled=true\n');
      expect(result.requests).toContain(
        'api repos/owner/repo/dependency-graph/compare/base...head'
      );
    }
  });

  itShell('warns and lets pull requests pass while the graph is off', () => {
    const result = runCheck({ compareStatus: 403, mode: 'warn' });

    expect(result.status).toBe(0);
    expect(result.output).toBe('enabled=false\n');
    expect(result.stdout).toContain('::warning::Dependency graph is disabled');
    expect(result.stdout).toContain(SETTINGS_URL);
  });

  itShell('fails the default branch with the setting to enable', () => {
    const result = runCheck({ compareStatus: 403, mode: 'require' });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('::error::Dependency graph is disabled');
    expect(result.stdout).toContain('A maintainer must act');
    expect(result.stdout).toContain(SETTINGS_URL);
  });

  itShell('fails closed on any other API error', () => {
    for (const mode of ['warn', 'require']) {
      const result = runCheck({ compareStatus: 500, mode });

      expect(result.status).toBe(1);
      expect(result.output).toBe('');
      expect(result.stdout).toContain('::error::Could not query');
    }
  });

  itShell('compares with the parent commit when no base is given', () => {
    const result = runCheck({
      compareStatus: 200,
      mode: 'require',
      baseSha: '',
    });

    expect(result.status).toBe(0);
    expect(result.requests).toContain('api repos/owner/repo/commits/head');
    expect(result.requests).toContain('compare/parent...head');
  });
});
