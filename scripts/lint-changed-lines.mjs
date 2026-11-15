/**
 * Helpers for reporting ESLint warnings only in changed files.
 *
 * Errors are always reported, everywhere. Warnings are reported for every
 * file the branch changes, the same scope the pre-commit hook lints
 * (`eslint --max-warnings 0` on each staged file), and for every file when the
 * lint configuration or the ESLint packages change.
 *
 * The scope is a whole file, not the changed lines: `complexity`,
 * `max-statements`, `max-lines-per-function` and similar rules report on the
 * first line of a function, which an edit to its body leaves unchanged
 * (docs: dev/log/issues/115/pulls/116/README.md).
 */

import path from 'node:path';

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * Files whose change can alter the warnings of any other file: the ESLint
 * configuration, local rules, and the manifests that pin ESLint and its
 * plugins.
 */
const LINT_CONFIG_FILE =
  /^(?:eslint\.config\.[cm]?js|eslint-rules\/.+|package(?:-lock)?\.json)$/;

/**
 * Parse a unified diff into a map of file path -> Set of changed line numbers
 * (line numbers of the new file revision).
 *
 * @param {string} diff unified diff text (`git diff -U0`)
 * @returns {Map<string, Set<number>>}
 */
export function parseChangedLines(diff) {
  const changed = new Map();
  let currentFile = null;
  let lineNumber = 0;

  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).trim();
      currentFile = target === '/dev/null' ? null : target.replace(/^b\//, '');
      if (currentFile && !changed.has(currentFile)) {
        changed.set(currentFile, new Set());
      }
      continue;
    }

    const hunk = HUNK_HEADER.exec(line);
    if (hunk) {
      lineNumber = Number(hunk[1]);
      continue;
    }

    if (!currentFile) {
      continue;
    }

    if (line.startsWith('+')) {
      changed.get(currentFile).add(lineNumber);
      lineNumber += 1;
    } else if (line.startsWith(' ')) {
      lineNumber += 1;
    }
  }

  return changed;
}

/**
 * Whether a change set touches the lint configuration, so that every file
 * must be checked again.
 *
 * @param {Map<string, unknown>} changedFiles keys are repository paths
 * @returns {boolean}
 */
export function changesLintConfig(changedFiles) {
  return [...changedFiles.keys()].some((file) => LINT_CONFIG_FILE.test(file));
}

function relativePath(filePath, cwd) {
  return path.relative(cwd, filePath).split(path.sep).join('/');
}

/**
 * Keep every error, and keep warnings only in files the change set touches.
 *
 * @param {Array<object>} results ESLint result objects
 * @param {Map<string, Set<number>|true>} changedFiles from
 *   {@link parseChangedLines}; a `true` value marks an untracked file
 * @param {string} cwd directory the result paths are relative to
 * @returns {Array<object>} filtered ESLint results
 */
export function filterWarningsToChangedFiles(results, changedFiles, cwd) {
  return results.map((result) => {
    const changed = changedFiles.has(relativePath(result.filePath, cwd));
    const messages = result.messages.filter(
      (message) => message.severity !== 1 || changed
    );

    return {
      ...result,
      messages,
      warningCount: messages.filter((message) => message.severity === 1).length,
      fixableWarningCount: messages.filter(
        (message) => message.severity === 1 && message.fix
      ).length,
    };
  });
}

/**
 * Exit code for the reported results: any error or any reported warning
 * fails. The pre-commit hook runs ESLint with --max-warnings 0 on every
 * staged file, so CI rejects what a skipped hook would have rejected.
 *
 * @param {Array<object>} reported ESLint results after filtering
 * @returns {0 | 1}
 */
export function lintExitCode(reported) {
  return reported.some((result) => result.errorCount + result.warningCount > 0)
    ? 1
    : 0;
}
