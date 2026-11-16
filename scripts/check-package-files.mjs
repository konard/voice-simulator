#!/usr/bin/env node

/**
 * Fails when the npm package would ship without the Rust engine.
 *
 * `src/engine/*.wasm` is git-ignored: the publishing jobs download the file
 * the rust job built into `src/engine/` before `npm publish`. This check runs
 * `npm pack --dry-run --json` and fails unless the listed files contain
 * every path of REQUIRED_FILES: a missing download stops the release, so
 * no package goes out whose `engine: 'auto'` is always JavaScript. It
 * prints the engine files with their sizes.
 *
 * Usage: node scripts/check-package-files.mjs
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Files the published package must contain. */
export const REQUIRED_FILES = Object.freeze([
  'src/engine/voice-simulator.wasm',
  'src/engine/worker.js',
  'src/engine/worker-protocol.js',
]);

/**
 * The required paths missing from a `npm pack --dry-run --json` listing.
 * @param {{files: {path: string}[]}[]} listing
 * @param {readonly string[]} [required]
 * @returns {string[]}
 */
export function missingFiles(listing, required = REQUIRED_FILES) {
  const paths = new Set(
    listing.flatMap((entry) => entry.files.map((file) => file.path))
  );
  return required.filter((path) => !paths.has(path));
}

function main() {
  const output = execFileSync(
    'npm',
    ['pack', '--dry-run', '--json', '--ignore-scripts'],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    }
  );
  const listing = JSON.parse(output);
  for (const file of listing.flatMap((entry) => entry.files)) {
    if (file.path.startsWith('src/engine/')) {
      console.log(`${file.path} ${file.size}`);
    }
  }
  const missing = missingFiles(listing);
  if (missing.length > 0) {
    console.error(
      `::error::npm pack does not list ${missing.join(', ')}; download the voice-simulator-wasm artifact into src/engine/ first (npm run build:wasm locally)`
    );
    process.exit(1);
  }
  console.log(`package: ok (${REQUIRED_FILES.length} required engine files)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
