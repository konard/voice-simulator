// Compare the offline renders of origin/main and of the working tree on this
// machine (issue 29). `offline output is unchanged` in
// tests/adaptive-stream.test.js keeps one SHA-256 per runtime and platform,
// because the last bits of `Math` functions differ between them. This script
// renders both trees in the same process and prints whether they agree.
// It ran as a temporary test on the CI matrix (node/bun/deno × Linux, macOS,
// Windows) to record the macOS and Windows hashes.
// Usage: node experiments/issue-29-main-probe.mjs   (also bun / deno run -A)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { synthesize } from '../src/synthesize.js';

const runtime = globalThis.Deno
  ? 'deno'
  : globalThis.process?.versions?.bun
    ? 'bun'
    : 'node';
const platform = globalThis.process?.platform ?? globalThis.Deno?.build?.os;
const hash = (samples) =>
  createHash('sha256')
    .update(
      new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
    )
    .digest('hex');

const dir = mkdtempSync(join(tmpdir(), 'main-'));
execFileSync('git', ['worktree', 'add', '--detach', dir, 'origin/main'], {
  stdio: 'ignore',
});
try {
  const main = await import(
    pathToFileURL(join(dir, 'src', 'synthesize.js')).href
  );
  for (const tier of ['minimal', 'high']) {
    const options = { seed: 1, tier, engine: 'js' };
    const a = hash(main.synthesize('Hello world.', options).samples);
    const b = hash(synthesize('Hello world.', options).samples);
    console.log(
      `${runtime} ${platform} ${tier} main=${a} branch=${b} same=${a === b}`
    );
  }
} finally {
  execFileSync('git', ['worktree', 'remove', '--force', dir], {
    stdio: 'ignore',
  });
  rmSync(dir, { recursive: true, force: true });
}
