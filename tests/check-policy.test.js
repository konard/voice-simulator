/**
 * Tests for scripts/check-policy.mjs (issue 15): no neural networks,
 * permissive licences only.
 *
 * Denied names are built by concatenation so that this file would not trip
 * the check even if it were not on the skip list.
 */

import { describe, expect, it } from 'test-anywhere';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import {
  applyExceptions,
  cargoLicenceFindings,
  cargoTomlDependencies,
  checkPolicy,
  deniedDependencies,
  deniedFiles,
  dependencyEntries,
  deniedImports,
  evaluateLicence,
  licenceFindings,
  loadList,
  pyprojectDependencies,
  urlPackageNames,
} from '../scripts/check-policy.mjs';
import { itUnless, noPosixShell, sandboxed } from './helpers/skip.js';

const scriptPath = fileURLToPath(
  new URL('../scripts/check-policy.mjs', import.meta.url)
);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
// Read on first use: a sandboxed Deno run then reports skipped tests, not an
// import error.
let cachedList;
const policyList = () => (cachedList ??= loadList(repoRoot));
const run = itUnless(sandboxed, noPosixShell);

const ONNX_NODE = 'onnx' + 'runtime-node';
const TFJS_CORE = '@tensor' + 'flow/tfjs-core';
const CANDLE = 'candle' + '-core';
const TCH = 't' + 'ch';
const TORCH = 'to' + 'rch';

/** Builds a git repository with `files` staged and returns its path. */
function fixture(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'check-policy-'));
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
    }
  };
  git('init', '-q');
  git('add', '-A');
  return root;
}

function withFixture(files, fn) {
  const root = fixture(files);
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runCli(args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
  });
}

const lockFile = (packages) =>
  `${JSON.stringify(
    {
      name: 'fixture',
      lockfileVersion: 3,
      requires: true,
      packages: { '': { name: 'fixture', license: 'Unlicense' }, ...packages },
    },
    null,
    2
  )}\n`;

describe('check-policy: packages and imports', () => {
  run('passes on this repository', () => {
    const result = runCli(['--root', repoRoot]);
    expect(result.stderr).toBe('');
    expect(result.stdout).toMatch(/^policy: ok \(\d+ packages, \d+ files\)/);
    expect(result.status).toBe(0);
  });

  run('finds a denied npm dependency', () => {
    withFixture(
      {
        'package.json': JSON.stringify(
          { name: 'x', dependencies: { [ONNX_NODE]: '1.0.0' } },
          null,
          2
        ),
      },
      (root) => {
        const findings = deniedDependencies(root, policyList());
        expect(findings.length).toBe(1);
        expect(findings[0].rule).toBe('package');
        expect(findings[0].name).toBe(ONNX_NODE);
        expect(findings[0].file).toBe('package.json');
        expect(findings[0].line).toBe(4);

        // The command line names the file and the package and exits with 1.
        const result = runCli(['--root', root]);
        expect(result.status).toBe(1);
        expect(result.stdout).toContain(`package.json:4 package ${ONNX_NODE}:`);
      }
    );
  });

  run('finds a denied package deep in a lock file', () => {
    const key = `node_modules/a/node_modules/${TFJS_CORE}`;
    withFixture(
      {
        'package-lock.json': lockFile({
          'node_modules/a': { version: '1.0.0', license: 'MIT' },
          [key]: { version: '4.0.0', license: 'Apache-2.0' },
        }),
      },
      (root) => {
        const findings = deniedDependencies(root, policyList());
        expect(findings.map((item) => item.name)).toEqual([TFJS_CORE]);
        expect(findings[0].rule).toBe('package');
        expect(findings[0].file).toBe('package-lock.json');
      }
    );
  });

  run('finds a denied crate', () => {
    withFixture(
      {
        'Cargo.toml': `[package]\nname = "x"\n\n[dependencies]\n${CANDLE} = "0.8"\nrand = "0.8"\n`,
      },
      (root) => {
        const findings = deniedDependencies(root, policyList());
        expect(findings.length).toBe(1);
        const { rule, file, line, name, message } = findings[0];
        expect({ rule, file, line, name }).toEqual({
          rule: 'package',
          file: 'Cargo.toml',
          line: 5,
          name: CANDLE,
        });
        expect(message).toContain('cargo');
      }
    );
  });

  run('finds a denied import', () => {
    withFixture(
      {
        'a.mjs': `const ok = await import('three');\nconst m = await import('${ONNX_NODE}');\n`,
        'b.rs': `use std::fs;\nuse ${TCH}::Tensor;\n`,
      },
      (root) => {
        const findings = deniedImports(root, policyList());
        expect(
          findings.map(({ file, line, name, rule }) => ({
            file,
            line,
            name,
            rule,
          }))
        ).toEqual([
          { file: 'a.mjs', line: 2, name: ONNX_NODE, rule: 'package' },
          { file: 'b.rs', line: 2, name: TCH, rule: 'package' },
        ]);
      }
    );
  });
});

describe('check-policy: files, licences and exceptions', () => {
  run('finds a model file', () => {
    withFixture({ 'voice.ONNX': '' }, (root) => {
      const findings = deniedFiles(root, policyList());
      expect(findings.length).toBe(1);
      expect(findings[0].rule).toBe('file');
      expect(findings[0].file).toBe('voice.ONNX');
    });
  });

  run('evaluates licence expressions', () => {
    const allowed = policyList().allowedLicences;
    expect(evaluateLicence('(MIT OR GPL-3.0-only)', allowed).ok).toBe(true);
    expect(evaluateLicence('MIT AND GPL-3.0-only', allowed).ok).toBe(false);
    expect(evaluateLicence('GPL-3.0-only', allowed).ok).toBe(false);
    expect(evaluateLicence(undefined, allowed).ok).toBe(false);
    // The expressions this repository's lock files hold today.
    for (const expression of ['WTFPL OR ISC', '(MIT OR CC0-1.0)', 'MIT']) {
      expect(evaluateLicence(expression, allowed).ok).toBe(true);
    }
    // AND binds tighter than OR.
    expect(evaluateLicence('GPL-3.0-only OR MIT AND ISC', allowed).ok).toBe(
      true
    );
    expect(
      evaluateLicence('(GPL-3.0-only OR MIT) AND GPL-2.0', allowed).ok
    ).toBe(false);
    expect(evaluateLicence('SEE LICENSE IN x', allowed).ok).toBe(false);

    withFixture(
      {
        'package-lock.json': lockFile({
          'node_modules/a': { license: '(MIT OR GPL-3.0-only)' },
          'node_modules/b': { license: 'MIT AND GPL-3.0-only' },
          'node_modules/c': { license: 'GPL-3.0-only' },
          'node_modules/d': {},
        }),
      },
      (root) => {
        const findings = licenceFindings(root, policyList());
        expect(findings.map((item) => item.name)).toEqual(['b', 'c', 'd']);
        expect(findings.every((item) => item.rule === 'licence')).toBe(true);
        expect(findings[2].message).toContain('no licence');
      }
    );
  });

  run('honours and polices exceptions', () => {
    withFixture({ 'voice.onnx': '', 'package.json': '{}' }, (root) => {
      const reason = 'A fixture for the exception rule.';
      const excepted = {
        ...policyList(),
        exceptions: [{ rule: 'file', match: 'voice.onnx', reason }],
      };
      expect(checkPolicy(root, excepted).findings).toEqual([]);

      const stale = {
        ...policyList(),
        exceptions: [
          { rule: 'file', match: 'voice.onnx', reason },
          { rule: 'package', match: 'nothing-uses-this', reason },
        ],
      };
      const findings = checkPolicy(root, stale).findings;
      expect(findings.length).toBe(1);
      expect(findings[0].rule).toBe('exception');
      expect(findings[0].name).toBe('nothing-uses-this');
    });
    // An exception without a reason does not count.
    const findings = applyExceptions(
      [{ rule: 'file', file: 'a.onnx', name: 'a.onnx', line: 1 }],
      [{ rule: 'file', match: 'a.onnx', reason: ' ' }]
    );
    expect(findings.map((item) => item.rule)).toEqual(['file', 'exception']);
  });

  run('ignores prose', () => {
    withFixture(
      {
        'docs/a.md': `Do not use ${ONNX_NODE} or ${TORCH}; npm install ${ONNX_NODE}.\n`,
        'docs/b.mjs': `import x from '${ONNX_NODE}';\n`,
        'notes.md': `We never import ${TORCH}.\n`,
      },
      (root) => {
        expect(checkPolicy(root, policyList()).findings).toEqual([]);
      }
    );
  });

  run('finds install commands, URLs and Python requirements', () => {
    withFixture(
      {
        '.github/workflows/a.yml': `steps:\n  - run: npm ci && npx --yes ${ONNX_NODE}@1 --help\n`,
        'index.html': `<script src="https://cdn.jsdelivr.net/npm/${TFJS_CORE}@4/dist/x.js"></script>\n`,
        'tools/a.py': `import os, ${TORCH}.nn as nn\n`,
        'requirements-dev.txt': `numpy>=1\n${TORCH.toUpperCase()}==2.1 ; python_version > "3"\n`,
        'pyproject.toml': `[project]\ndependencies = [\n  "scipy",\n  "${TORCH}audio>=2",\n]\n`,
      },
      (root) => {
        const findings = checkPolicy(root, policyList()).findings.map(
          ({ file, line, name }) => `${file}:${line} ${name}`
        );
        expect(findings.sort()).toEqual(
          [
            `.github/workflows/a.yml:2 ${ONNX_NODE}`,
            `index.html:1 ${TFJS_CORE}`,
            `tools/a.py:1 ${TORCH}`,
            `requirements-dev.txt:2 ${TORCH.toUpperCase()}`,
            `pyproject.toml:4 ${TORCH}audio`,
          ].sort()
        );
      }
    );
  });

  run('reports a Cargo.toml when cargo is not installed', () => {
    withFixture({ 'Cargo.toml': '[package]\nname = "x"\n' }, (root) => {
      const findings = licenceFindings(root, policyList(), undefined, {
        cargo: path.join(root, 'no-such-cargo'),
      });
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain('cargo is not installed');
    });
  });
});

describe('check-policy parsers', () => {
  it('reads Cargo tables with target prefixes and renames', () => {
    const toml = [
      "[target.'cfg(unix)'.dependencies]",
      'libc = "0.2"',
      '[dev-dependencies.criterion]',
      'version = "0.5"',
      '[build-dependencies]',
      `x = { package = "${TCH}", version = "1" } # renamed`,
      '[workspace.dependencies]',
      'serde.workspace = true',
    ].join('\n');
    expect(cargoTomlDependencies(toml).map((entry) => entry.name)).toEqual([
      'libc',
      'criterion',
      'x',
      TCH,
      'serde',
    ]);
  });

  run('applies the licence rule to cargo metadata', () => {
    const findings = cargoLicenceFindings(
      {
        packages: [
          { name: 'a', license: 'MIT/Apache-2.0' },
          { name: 'b', license: 'MIT OR Apache-2.0' },
          { name: 'c', license: 'GPL-3.0/LGPL-2.1' },
          { name: 'd', license: null },
          { name: 'e', license: 'Unicode-3.0 AND (MIT OR Apache-2.0)' },
        ],
      },
      policyList()
    );
    expect(findings.map((item) => item.name)).toEqual(['c', 'd']);
  });

  it('reads optional dependency groups of pyproject.toml', () => {
    const toml = [
      '[project.optional-dependencies]',
      `ml = ["${TORCH}>=2", 'numpy']`,
      '[tool.poetry.dependencies]',
      'python = "^3.11"',
      'scipy = "^1"',
    ].join('\n');
    expect(pyprojectDependencies(toml).map((entry) => entry.name)).toEqual([
      TORCH,
      'numpy',
      'scipy',
    ]);
  });

  it('reads package names from CDN URLs', () => {
    expect(
      urlPackageNames(`https://cdn.jsdelivr.net/npm/${TFJS_CORE}@4/x.js`)
    ).toEqual([TFJS_CORE]);
    expect(urlPackageNames(`https://unpkg.com/${ONNX_NODE}`)).toEqual([
      ONNX_NODE,
    ]);
    expect(
      urlPackageNames('https://github.com/konard/voice-simulator')
    ).toEqual([]);
  });

  it('reads the import map of deno.json', () => {
    const json = JSON.stringify(
      {
        imports: { a: `npm:${ONNX_NODE}@1`, b: 'jsr:@std/assert@1' },
        scopes: { '/x/': { c: `https://esm.sh/${TFJS_CORE}@4` } },
      },
      null,
      2
    );
    const entries = dependencyEntries('deno.json', json);
    expect(entries.map((entry) => entry.name)).toEqual([
      ONNX_NODE,
      '@std/assert',
      TFJS_CORE,
    ]);
    expect(entries.map((entry) => entry.line)).toEqual([3, 4, 8]);
  });
});
