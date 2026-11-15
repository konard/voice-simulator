#!/usr/bin/env node

/**
 * Lint entry point used by `npm run lint`.
 *
 * All files are linted for errors. Warnings are reported only in files that
 * the current branch changes relative to its base, the same files the
 * pre-commit hook lints, or in every file when the branch changes the lint
 * configuration. Every reported error or warning fails the run. Set
 * LINT_ALL_WARNINGS=1 to report every warning, as pushes to main do.
 */

import { execFileSync } from 'node:child_process';
import { ESLint } from 'eslint';
import {
  parseChangedLines,
  changesLintConfig,
  filterWarningsToChangedFiles,
  lintExitCode,
} from './lint-changed-lines.mjs';

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function resolveBaseRef() {
  const baseRef = process.env.LINT_BASE_REF || process.env.GITHUB_BASE_REF;
  const candidates = baseRef
    ? [baseRef, `origin/${baseRef}`]
    : ['origin/main', 'main', 'origin/master', 'master'];

  for (const candidate of candidates) {
    try {
      git(['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`]);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

function collectChangedFiles() {
  const base = resolveBaseRef();

  if (!base) {
    return null;
  }

  try {
    const mergeBase = git(['merge-base', 'HEAD', base]).trim();
    const committed = git(['diff', '-U0', mergeBase, '--']);
    const working = git(['diff', '-U0', 'HEAD', '--']);
    const untracked = git(['ls-files', '--others', '--exclude-standard'])
      .split('\n')
      .filter(Boolean);

    const changed = parseChangedLines(`${committed}\n${working}`);

    for (const file of untracked) {
      changed.set(file, true);
    }

    console.log(
      `Reporting warnings in ${changed.size} file(s) changed since ${base}.`
    );
    return changed;
  } catch {
    return null;
  }
}

function warningScope() {
  if (process.env.LINT_ALL_WARNINGS === '1') {
    return null;
  }

  const changed = collectChangedFiles();

  if (changed && changesLintConfig(changed)) {
    console.log(
      'The lint configuration or ESLint packages changed: reporting every warning.'
    );
    return null;
  }

  return changed;
}

async function main() {
  const eslint = new ESLint();
  const results = await eslint.lintFiles(['.']);
  const changedFiles = warningScope();

  const reported = changedFiles
    ? filterWarningsToChangedFiles(results, changedFiles, process.cwd())
    : results;

  const formatter = await eslint.loadFormatter('stylish');
  const output = await formatter.format(reported);

  if (output) {
    console.log(output);
  }

  const hiddenWarnings =
    results.reduce((total, result) => total + result.warningCount, 0) -
    reported.reduce((total, result) => total + result.warningCount, 0);

  if (hiddenWarnings > 0) {
    console.log(
      `${hiddenWarnings} warning(s) in unchanged files were not reported. Run LINT_ALL_WARNINGS=1 npm run lint to see them.`
    );
  }

  process.exit(lintExitCode(reported));
}

await main();
