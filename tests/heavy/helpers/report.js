/**
 * Helpers for the heavy tests in tests/heavy/ (see tests/heavy/README.md).
 * scripts/run-heavy.mjs passes the item limit as HEAVY_LIMIT and the report
 * folder as HEAVY_OUT.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Report folder used when HEAVY_OUT is not set. */
export const DEFAULT_HEAVY_OUT = 'reports/heavy';

/**
 * The largest number of items (utterances, files) a test may process.
 * @param {number} fallback used when HEAVY_LIMIT is not a positive integer
 * @returns {number}
 */
export function heavyLimit(fallback) {
  const limit = Number(process.env.HEAVY_LIMIT);
  return Number.isInteger(limit) && limit > 0 ? limit : fallback;
}

/** @returns {string} the folder reports are written to */
export function heavyOut() {
  return process.env.HEAVY_OUT || DEFAULT_HEAVY_OUT;
}

/**
 * Write <HEAVY_OUT>/<name>.md and <HEAVY_OUT>/<name>.json.
 * @param {string} name report name, also the file name without extension
 * @param {string} markdown Markdown shown in the run summary
 * @param {unknown} data numbers behind the Markdown
 * @returns {{markdown: string, json: string}} paths of the written files
 */
export function writeReport(name, markdown, data) {
  const out = heavyOut();
  mkdirSync(out, { recursive: true });
  const markdownPath = path.join(out, `${name}.md`);
  const jsonPath = path.join(out, `${name}.json`);
  writeFileSync(
    markdownPath,
    markdown.endsWith('\n') ? markdown : `${markdown}\n`
  );
  writeFileSync(jsonPath, `${JSON.stringify(data, null, 2)}\n`);
  return { markdown: markdownPath, json: jsonPath };
}
