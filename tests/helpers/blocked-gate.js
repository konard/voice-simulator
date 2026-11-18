/**
 * Acceptance criteria that only a human decision can unblock.
 *
 * Some criteria of an issue cannot pass as the issue specifies them: the
 * specified formula and fixture give a value outside the specified gate,
 * and only the issue author can change the formula, the fixture or the
 * gate. Such a criterion is still measured on every run. Where it fails:
 *
 * - with `BLOCKED_GATES=warn` (set by CI for pull requests only) it prints
 *   a GitHub `::warning::` annotation naming the measurement and the human
 *   action, and the test passes, so pull requests stay reviewable;
 * - everywhere else (pushes to the default branch, local runs) it throws
 *   an error with the same text, so the default branch cannot report a
 *   blocked criterion as met.
 *
 * Once the author decides, the caller replaces this helper with a plain
 * assertion.
 */

import process from 'node:process';

/**
 * @param {{
 *   criterion: string,
 *   passed: boolean,
 *   measured: string,
 *   action: string,
 *   env?: Record<string, string|undefined>,
 *   log?: (message: string) => void,
 * }} gate
 * @returns {'passed'|'warned'} what happened; throws when blocked and not
 *   deferred
 */
export function checkBlockedGate({
  criterion,
  passed,
  measured,
  action,
  env = process.env,
  log = console.warn,
}) {
  if (passed) {
    return 'passed';
  }
  const message =
    `Blocked acceptance criterion "${criterion}": ${measured}. ` +
    `Human action required: ${action}`;
  if (env.BLOCKED_GATES === 'warn') {
    log(`::warning title=Blocked acceptance criterion::${message}`);
    return 'warned';
  }
  throw new Error(message);
}
