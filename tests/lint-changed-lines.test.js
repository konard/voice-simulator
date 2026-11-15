import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'test-anywhere';
import {
  parseChangedLines,
  changesLintConfig,
  filterWarningsToChangedFiles,
  lintExitCode,
} from '../scripts/lint-changed-lines.mjs';

const DIFF = [
  'diff --git a/scripts/example.mjs b/scripts/example.mjs',
  '--- a/scripts/example.mjs',
  '+++ b/scripts/example.mjs',
  '@@ -10,0 +11,2 @@',
  '+// this line is new',
  '+const value = 1;',
  '',
].join('\n');

function warning(line) {
  return {
    severity: 1,
    line,
    ruleId: 'local/no-changelog-comments',
    message: 'history',
  };
}

describe('parseChangedLines', () => {
  it('collects added line numbers per file', () => {
    const changed = parseChangedLines(DIFF);

    expect(Array.from(changed.get('scripts/example.mjs'))).toEqual([11, 12]);
  });
});

describe('filterWarningsToChangedFiles', () => {
  const cwd = '/repo';
  const changed = parseChangedLines(DIFF);
  const filter = (filePath, messages, changes = changed) =>
    filterWarningsToChangedFiles(
      [
        {
          filePath,
          messages,
          errorCount: messages.filter((m) => m.severity === 2).length,
          warningCount: messages.filter((m) => m.severity === 1).length,
        },
      ],
      changes,
      cwd
    )[0];

  it('keeps warnings on changed lines', () => {
    const result = filter('/repo/scripts/example.mjs', [warning(11)]);

    expect(result.messages.length).toBe(1);
    expect(result.warningCount).toBe(1);
  });

  it('keeps warnings on unchanged lines of a changed file, as the pre-commit hook does', () => {
    const result = filter('/repo/scripts/example.mjs', [warning(3)]);

    expect(result.messages.length).toBe(1);
    expect(result.warningCount).toBe(1);
  });

  // Issue 115: a pull request edited the body of the WaveguideTract
  // constructor (src/acoustics/waveguide.js) and raised its complexity to 16.
  // ESLint reports `complexity` on the constructor's first line, 157, which
  // the pull request did not change, so a line filter hid the warning until
  // the push to main failed.
  it('keeps a complexity warning reported on the unchanged first line of an edited function', () => {
    const bodyEdit = parseChangedLines(
      [
        '--- a/src/acoustics/waveguide.js',
        '+++ b/src/acoustics/waveguide.js',
        '@@ -201,0 +202,3 @@',
        '+    this.wallLoss = options.wallLoss ?? 0;',
        '+    this.baffle = options.baffle ?? true;',
        '+    this.lossy = this.wallLoss > 0 || this.baffle;',
        '',
      ].join('\n')
    );
    const complexity = {
      severity: 1,
      line: 157,
      endLine: 157,
      ruleId: 'complexity',
      message: 'Constructor has a complexity of 16. Maximum allowed is 15.',
    };

    const result = filter(
      '/repo/src/acoustics/waveguide.js',
      [complexity],
      bodyEdit
    );

    expect(result.warningCount).toBe(1);
    expect(lintExitCode([result])).toBe(1);
  });

  it('drops warnings from files that were not touched at all', () => {
    const result = filter('/repo/scripts/other.mjs', [warning(1)]);

    expect(result.messages.length).toBe(0);
    expect(result.warningCount).toBe(0);
  });

  it('keeps every warning of an untracked file', () => {
    const untracked = new Map([['scripts/new.mjs', true]]);
    const result = filter('/repo/scripts/new.mjs', [warning(42)], untracked);

    expect(result.messages.length).toBe(1);
  });

  it('always keeps errors regardless of the diff', () => {
    const result = filter('/repo/scripts/other.mjs', [
      { severity: 2, line: 5, ruleId: 'no-var' },
    ]);

    expect(result.messages.length).toBe(1);
    expect(result.errorCount).toBe(1);
  });
});

describe('changesLintConfig', () => {
  const files = (...paths) => new Map(paths.map((p) => [p, new Set([1])]));

  it('reports every warning when the ESLint configuration or packages change', () => {
    expect(changesLintConfig(files('eslint.config.js'))).toBe(true);
    expect(
      changesLintConfig(files('eslint-rules/no-changelog-comments.js'))
    ).toBe(true);
    expect(changesLintConfig(files('package.json'))).toBe(true);
    expect(changesLintConfig(files('package-lock.json'))).toBe(true);
  });

  it('keeps the changed-file scope for ordinary source changes', () => {
    expect(changesLintConfig(files('src/acoustics/waveguide.js'))).toBe(false);
    expect(
      changesLintConfig(files('examples/universal-app/package.json'))
    ).toBe(false);
  });
});

describe('lintExitCode', () => {
  const result = (errorCount, warningCount) => ({ errorCount, warningCount });

  it('passes only when nothing is reported', () => {
    expect(lintExitCode([result(0, 0), result(0, 0)])).toBe(0);
    expect(lintExitCode([])).toBe(0);
  });

  it('fails on a reported warning, as the pre-commit hook does', () => {
    expect(lintExitCode([result(0, 0), result(0, 1)])).toBe(1);
  });

  it('fails on an error', () => {
    expect(lintExitCode([result(1, 0)])).toBe(1);
  });

  it('reports every warning on pushes to main', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
    const step = workflow.split('- name: Run ESLint')[1].split('- name:')[0];
    expect(step).toContain(
      "LINT_ALL_WARNINGS: ${{ github.event_name != 'pull_request' && '1' || '0' }}"
    );
    expect(step).toContain('run: npm run lint');
  });
});

describe('eslint.config.js', () => {
  it('imports only packages that package.json declares', () => {
    // ESLint 9 hoisted @eslint/js, so an undeclared import still resolved;
    // ESLint 10 no longer depends on it.
    const config = readFileSync('eslint.config.js', 'utf8');
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const declared = { ...pkg.dependencies, ...pkg.devDependencies };
    const imported = [...config.matchAll(/from '([^.][^']*)'/g)].map(
      ([, spec]) =>
        spec
          .split('/')
          .slice(0, spec.startsWith('@') ? 2 : 1)
          .join('/')
    );

    expect(imported).toContain('@eslint/js');
    for (const name of imported) {
      expect(`${name} ${typeof declared[name]}`).toBe(`${name} string`);
    }
  });
});
