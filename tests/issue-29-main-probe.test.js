/**
 * Temporary probe (issue 29): print the SHA-256 of the offline renders of
 * origin/main and of this branch on the CI platform, to record the hashes
 * of `offline output is unchanged` per platform. Removed after one CI run.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'test-anywhere';

import { synthesize } from '../src/synthesize.js';

const runtime = globalThis.Deno
  ? 'deno'
  : globalThis.process?.versions?.bun
    ? 'bun'
    : 'node';
const hash = (samples) =>
  createHash('sha256')
    .update(
      new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
    )
    .digest('hex');

describe('issue 29 main probe', () => {
  it('prints the offline hashes of main and of this branch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'main-'));
    execFileSync('git', ['worktree', 'add', '--detach', dir, 'origin/main'], {
      stdio: 'ignore',
    });
    const main = await import(
      pathToFileURL(join(dir, 'src', 'synthesize.js')).href
    );
    for (const tier of ['minimal', 'high']) {
      const options = { seed: 1, tier, engine: 'js' };
      const a = hash(main.synthesize('Hello world.', options).samples);
      const b = hash(synthesize('Hello world.', options).samples);
      console.log(
        `ISSUE29-PROBE ${runtime} ${globalThis.process?.platform ?? globalThis.Deno?.build?.os} ${tier} main=${a} branch=${b} same=${a === b}`
      );
      expect(a.length).toBe(64);
    }
  });
});
