// Experiment for issue 3: time the Changesets release fixture against a
// dependency tree. Pass the directory whose node_modules the fixture links,
// for example a copy installed with `deno install` to get Deno's layout.
// Usage: node experiments/issue-3-changeset-fixture-timing.mjs [deps-root]
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const repo = resolve(import.meta.dirname, '..');
const depsRoot = resolve(process.argv[2] ?? repo);
const cwd = mkdtempSync(join(tmpdir(), 'changeset-timing-'));
const dependencies = join(cwd, 'node_modules');
try {
  for (const file of [
    'package.json',
    'deno.json',
    'deno.lock',
    '.prettierrc',
  ]) {
    copyFileSync(join(repo, file), join(cwd, file));
  }
  mkdirSync(join(cwd, '.changeset'));
  copyFileSync(
    join(repo, '.changeset/config.json'),
    join(cwd, '.changeset/config.json')
  );
  const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
  writeFileSync(
    join(cwd, '.changeset/release-check.md'),
    `---\n"${pkg.name}": patch\n---\n\nCheck release versioning.\n`
  );
  writeFileSync(join(cwd, 'CHANGELOG.md'), `# ${pkg.name}\n`);
  mkdirSync(join(dependencies, '@changesets'), { recursive: true });
  for (const name of ['@changesets/cli', 'prettier']) {
    symlinkSync(
      join(depsRoot, 'node_modules', name),
      join(dependencies, name),
      'junction'
    );
  }
  const bin = join(dependencies, '.bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'prettier'),
    '#!/bin/sh\nexec node "$(dirname "$0")/../prettier/bin/prettier.cjs" "$@"\n',
    { mode: 0o755 }
  );
  const env = {
    ...process.env,
    DEBUG_CHANGESET_FIXTURE: '1',
    npm_config_offline: 'true',
    npm_config_yes: 'false',
    npm_config_loglevel: process.env.npm_config_loglevel ?? 'verbose',
  };
  const time = (label, file, args) => {
    const started = performance.now();
    try {
      execFileSync(
        'node',
        [
          '--require',
          join(repo, 'experiments/trace-changeset-fixture.cjs'),
          file,
          ...args,
        ],
        { cwd, env, stdio: ['ignore', 'inherit', 'inherit'] }
      );
    } finally {
      console.log(`${label}: ${Math.round(performance.now() - started)} ms`);
    }
  };
  time('changeset version', join(dependencies, '@changesets/cli/bin.js'), [
    'version',
  ]);
  const npx = performance.now();
  execFileSync('npx', ['prettier', '--version'], {
    cwd,
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  console.log(
    `npx prettier --version: ${Math.round(performance.now() - npx)} ms`
  );
} finally {
  if (process.env.KEEP_FIXTURE) {
    console.log(`kept ${cwd}`);
  } else {
    rmSync(cwd, { recursive: true, force: true });
  }
}
