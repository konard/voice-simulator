import { describe, expect } from 'test-anywhere';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import {
  HANG_GUARD_MS,
  removeFixture,
  runBounded,
} from './helpers/bounded-run.js';
import { itUnless, noPosixShell, sandboxed } from './helpers/skip.js';

const script = fileURLToPath(
  new URL('../scripts/run-bun-tests.sh', import.meta.url)
);

// Each child waits for its peer: a sequential launcher cannot pass. Keep
// the fixture finite even if an implementation forgets the second child.
const fixture = `#!/usr/bin/env bash
set -eu
root="$1"
failing="$2"
shift 2
case "$4" in
  --shard=1/2) shard=1 ;;
  --shard=2/2) shard=2 ;;
  *) exit 98 ;;
esac
printf '%s\\n' "$@" > "$root/$shard.args"
touch "$root/$shard.started"
other=$((3 - shard))
for ((attempt=0; attempt<500; attempt++)); do
  if [ -f "$root/$other.started" ]; then
    touch "$root/$shard.finished"
    if [ "$failing" = "$shard" ]; then exit 7; fi
    exit 0
  fi
  sleep 0.02
done
exit 99
`;

describe('Bun suite shards', () => {
  for (const failing of [0, 1, 2]) {
    itUnless(sandboxed, noPosixShell)(
      failing === 0
        ? 'runs both shards concurrently and waits for both'
        : `propagates failure from shard ${failing} and still reaps both`,
      async () => {
        const root = mkdtempSync(path.join(tmpdir(), 'bun-shards-'));
        let failure;
        try {
          const command = path.join(root, 'fixture.sh');
          writeFileSync(command, fixture);
          let result;
          try {
            await runBounded(
              'bash',
              [script, 'bash', command, root, String(failing)],
              { timeout: HANG_GUARD_MS }
            );
            result = 0;
          } catch (error) {
            if (error.timedOut || !Number.isInteger(error.code)) {
              throw error;
            }
            result = error.code;
          }
          expect(result).toBe(failing ? 7 : 0);
          for (const shard of [1, 2]) {
            expect(readFileSync(path.join(root, `${shard}.args`), 'utf8')).toBe(
              `test\n--timeout\n30000\n--shard=${shard}/2\n`
            );
            expect(
              readFileSync(path.join(root, `${shard}.finished`), 'utf8')
            ).toBe('');
          }
        } catch (error) {
          failure = error;
          throw error;
        } finally {
          removeFixture(root, failure);
        }
      }
    );
  }
});
