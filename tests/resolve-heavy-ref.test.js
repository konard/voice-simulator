/**
 * scripts/resolve-heavy-ref.sh (issue 14): the `ref` input of the Heavy
 * checks workflow may only name code of this repository, because a run
 * started on the default branch writes to its cache scope. Runs the script
 * against the offline `gh` stub in tests/fixtures/heavy-ref-stub.
 */

import { describe, expect } from 'test-anywhere';
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
import { join } from 'node:path';
import { itUnless, noPosixShell, sandboxed } from './helpers/skip.js';

const SCRIPT = 'scripts/resolve-heavy-ref.sh';
const STUB_DIR = 'tests/fixtures/heavy-ref-stub';
const FALLBACK = 'f'.repeat(40);
const RESOLVED = 'a'.repeat(40);

const itShell = itUnless(sandboxed, noPosixShell);

function resolve(wanted, fixture = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'heavy-ref-'));
  try {
    writeFileSync(join(dir, 'heads'), 'main\nfeature/x\n');
    writeFileSync(join(dir, 'tags'), 'v1.0.0\n');
    writeFileSync(join(dir, 'sha'), `${fixture.sha ?? RESOLVED}\n`);
    // fixture.compare maps the head of `compare/<sha>...<head>` to a status.
    mkdirSync(join(dir, 'compare'));
    for (const [head, status] of Object.entries(fixture.compare ?? {})) {
      writeFileSync(join(dir, 'compare', head), `${status}\n`);
    }
    const output = join(dir, 'output');
    const result = spawnSync('bash', [SCRIPT], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${STUB_DIR}:${process.env.PATH}`,
        HEAVY_REF_FIXTURE_DIR: dir,
        REPOSITORY: 'owner/repo',
        DEFAULT_BRANCH: 'main',
        FALLBACK_SHA: FALLBACK,
        WANTED: wanted,
        GITHUB_OUTPUT: output,
      },
    });
    const requestsPath = join(dir, 'requests');
    return {
      status: result.status,
      stdout: result.stdout,
      output: existsSync(output) ? readFileSync(output, 'utf8') : '',
      requests: existsSync(requestsPath)
        ? readFileSync(requestsPath, 'utf8')
        : '',
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('resolve-heavy-ref.sh', () => {
  itShell('tests the chosen branch when ref is empty', () => {
    const result = resolve('');

    expect(result.status).toBe(0);
    expect(result.output).toBe(`revision=${FALLBACK}\n`);
    expect(result.requests).toBe('');
  });

  itShell('resolves a branch and a tag of the repository', () => {
    const branch = resolve('feature/x');
    expect(branch.status).toBe(0);
    expect(branch.output).toBe(`revision=${RESOLVED}\n`);
    expect(branch.requests).toContain(
      'api repos/owner/repo/commits/refs/heads/feature/x'
    );

    const tag = resolve('v1.0.0');
    expect(tag.status).toBe(0);
    expect(tag.output).toBe(`revision=${RESOLVED}\n`);
    expect(tag.requests).toContain(
      'api repos/owner/repo/commits/refs/tags/v1.0.0'
    );
  });

  itShell('accepts a commit that is on the default branch', () => {
    for (const status of ['ahead', 'identical']) {
      const result = resolve('abc1234', { compare: { main: status } });

      expect(result.status).toBe(0);
      expect(result.output).toBe(`revision=${RESOLVED}\n`);
      expect(result.requests).toContain(
        'api repos/owner/repo/compare/abc1234...main --jq .status'
      );
      expect(result.requests).not.toContain(`...${FALLBACK}`);
    }
  });

  itShell('accepts a commit that is only on the chosen branch', () => {
    for (const status of ['ahead', 'identical']) {
      const result = resolve('abc1234', {
        compare: { main: 'diverged', [FALLBACK]: status },
      });

      expect(result.status).toBe(0);
      expect(result.output).toBe(`revision=${RESOLVED}\n`);
      expect(result.requests).toContain(
        `api repos/owner/repo/compare/abc1234...${FALLBACK} --jq .status`
      );
    }
  });

  itShell(
    'rejects a commit on neither the default nor the chosen branch',
    () => {
      for (const compare of [
        { main: 'diverged', [FALLBACK]: 'diverged' },
        { main: 'behind', [FALLBACK]: 'behind' },
        {},
      ]) {
        const result = resolve('abc1234', { compare });

        expect(result.status).toBe(1);
        expect(result.output).toBe('');
        expect(result.stdout).toContain(
          "::error::ref 'abc1234' is neither a branch or tag"
        );
        expect(result.requests).toContain('/compare/abc1234...main ');
        expect(result.requests).toContain(`/compare/abc1234...${FALLBACK} `);
        expect(result.requests).not.toContain('/commits/');
      }
    }
  );

  itShell('rejects an unknown name without a commit lookup', () => {
    const result = resolve('missing-branch');

    expect(result.status).toBe(1);
    expect(result.output).toBe('');
    expect(result.requests).not.toContain('/compare/');
    expect(result.requests).not.toContain('/commits/');
  });

  itShell('rejects names that are not refs without calling gh', () => {
    for (const wanted of ['../main', 'a b', 'main;id', '-x']) {
      const result = resolve(wanted);

      expect(result.status).toBe(1);
      expect(result.output).toBe('');
      expect(result.requests).toBe('');
    }
  });

  itShell('rejects an answer that is not a full SHA', () => {
    const result = resolve('main', { sha: 'oops' });

    expect(result.status).toBe(1);
    expect(result.output).toBe('');
    expect(result.stdout).toContain("could not resolve 'main'");
  });
});
