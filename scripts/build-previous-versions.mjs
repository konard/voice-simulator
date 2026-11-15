#!/usr/bin/env node
/**
 * Build the example app of earlier commits into sub-folders of the current
 * build, so GitHub Pages keeps serving them (e.g. /voice-simulator/v1/).
 *
 * Versions are listed in examples/universal-app/previous-versions.json as
 * {path, commit}. Each commit is checked out into a temporary git worktree
 * (fetched first when the clone is shallow), its web build dependencies
 * installed with `npm ci` (the desktop packagers are pruned from its
 * lockfile first) and built with a relative base path, then copied into
 * examples/universal-app/dist/<path>. The current app is built once more
 * with a relative base into the next free path (e.g. /v3/), so every
 * release keeps a permanent URL. Run it after `npm run example:web:build`,
 * which empties dist.
 *
 * Usage: node scripts/build-previous-versions.mjs [--dist <dir>]
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentVersionPath } from '../examples/universal-app/src/versions.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'examples/universal-app');

export function readVersions(file = path.join(app, 'previous-versions.json')) {
  const versions = JSON.parse(readFileSync(file, 'utf8'));
  for (const [index, version] of versions.entries()) {
    if (version.path !== `v${index + 1}`) {
      throw new Error(
        `Invalid version path: ${version.path} (expected v${index + 1})`
      );
    }
    if (!/^[0-9a-f]{40}$/.test(version.commit)) {
      throw new Error(`Use a full commit SHA for ${version.path}`);
    }
  }
  return versions;
}

function run(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(' ')}`);
  execFileSync(command, args, { stdio: 'inherit', cwd: root, ...options });
}

function hasCommit(commit) {
  try {
    execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], {
      cwd: root,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Packages of an old app that only the desktop packaging needs. `vite build`
 * never loads them, but `npm ci` installed them (and downloaded Electron) for
 * every previous version, and their trees held every deprecated package the
 * Example app log warned about: inflight, glob 7, rimraf 2 and boolean
 * (issue 115).
 */
export const DESKTOP_ONLY_PACKAGES = ['electron', 'electron-builder'];

/**
 * The desktop-only packages an old app's package.json declares. Removing
 * them with `npm uninstall --package-lock-only` keeps every other locked
 * version; the web build is byte-identical
 * (experiments/issue-115-previous-version-prune.sh).
 * @param {{dependencies?: object, devDependencies?: object}} manifest
 * @returns {string[]}
 */
export function desktopOnlyPackages(manifest) {
  return DESKTOP_ONLY_PACKAGES.filter(
    (name) =>
      Object.hasOwn(manifest.devDependencies ?? {}, name) ||
      Object.hasOwn(manifest.dependencies ?? {}, name)
  );
}

const NPM_QUIET = ['--no-audit', '--no-fund'];

/** Install the web build dependencies of an old app, from its lockfile. */
function installWebDependencies(oldApp) {
  const manifest = JSON.parse(
    readFileSync(path.join(oldApp, 'package.json'), 'utf8')
  );
  const desktop = desktopOnlyPackages(manifest);
  if (desktop.length) {
    run('npm', ['uninstall', ...desktop, '--package-lock-only', ...NPM_QUIET], {
      cwd: oldApp,
    });
  }
  run('npm', ['ci', ...NPM_QUIET], { cwd: oldApp });
}

export function buildVersion(version, dist) {
  if (!hasCommit(version.commit)) {
    run('git', ['fetch', '--no-tags', '--depth=1', 'origin', version.commit]);
  }
  const worktree = mkdtempSync(path.join(tmpdir(), `voice-${version.path}-`));
  rmSync(worktree, { recursive: true, force: true });
  run('git', ['worktree', 'add', '--detach', worktree, version.commit]);
  try {
    const oldApp = path.join(worktree, 'examples/universal-app');
    installWebDependencies(oldApp);
    // A relative base works under any sub-path.
    const env = { ...process.env, GITHUB_PAGES: 'false' };
    run('npm', ['run', 'build'], { cwd: oldApp, env });
    const target = path.join(dist, version.path);
    rmSync(target, { recursive: true, force: true });
    cpSync(path.join(oldApp, 'dist'), target, { recursive: true });
    console.log(`Built ${version.path} (${version.commit}) into ${target}`);
  } finally {
    run('git', ['worktree', 'remove', '--force', worktree]);
  }
}

/** Build the current app with a relative base into its own version path. */
export function buildCurrentVersion(versions, dist) {
  const target = path.join(dist, currentVersionPath(versions));
  const env = { ...process.env, GITHUB_PAGES: 'false' };
  run('npm', ['run', 'build', '--', '--outDir', target, '--emptyOutDir'], {
    cwd: app,
    env,
  });
  console.log(`Built the current version into ${target}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const flag = process.argv.indexOf('--dist');
  const dist =
    flag === -1 ? path.join(app, 'dist') : path.resolve(process.argv[flag + 1]);
  if (!existsSync(dist)) {
    throw new Error(`Build the current app first: ${dist} is missing`);
  }
  const versions = readVersions();
  for (const version of versions) {
    buildVersion(version, dist);
  }
  buildCurrentVersion(versions, dist);
}
