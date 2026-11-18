/** Bounded scheduling fixtures: full coverage, ordering and failure propagation. */
import { describe, expect } from 'test-anywhere';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  HANG_GUARD_MS,
  removeFixture,
  runBounded,
} from './helpers/bounded-run.js';
import { itUnless, noPosixShell, sandboxed } from './helpers/skip.js';

// Bun matching completes before two ordinary shards; modes runs once, after
// whichever shard finishes first. Shard one here waits for modes, like the
// longer shard 1/2 measured in issue 63, so modes must follow shard two.
// Deno matching overlaps the bulk run. Node splits matching by test name and
// runs both halves and the fitting files alongside the bulk run.
const fixture = `#!/usr/bin/env bash
set -eu
runtime="$1"
root="$2"
failure="$3"
shift 3
role=bulk
lane=
for argument in "$@"; do
  case "$argument" in
    tests/voice-match.test.js) role=matching ;;
    tests/voice-fit.test.js) if [ "$runtime" = node ]; then role=fitting; fi ;;
    tests/recognition-modes.test.js) if [ "$runtime" = bun ]; then role=modes; fi ;;
    --test-skip-pattern=*) lane=rest ;;
    --shard=1/2) role=first ;;
    --shard=2/2) role=second ;;
  esac
done
role=\${lane:-$role}
if [ -f "$root/$role.started" ]; then exit 97; fi
printf '%s\\n' "$@" > "$root/$role.args"
touch "$root/$role.started"
for ((poll=0; poll<500; poll++)); do
  ready=false
  if [ "$runtime" = bun ]; then
    if [ "$role" = matching ]; then
      [ ! -f "$root/first.started" ] && [ ! -f "$root/second.started" ] || exit 98
      ready=true
    elif [ "$role" = modes ]; then
      [ -f "$root/first.started" ] && [ -f "$root/second.finished" ] && ready=true
    elif [ "$role" = first ]; then
      [ -f "$root/matching.finished" ] && [ -f "$root/modes.finished" ] && ready=true
    elif [ -f "$root/matching.finished" ] && [ -f "$root/first.started" ] && [ -f "$root/second.started" ]; then
      ready=true
    fi
  elif [ -f "$root/matching.started" ] && [ -f "$root/bulk.started" ] &&
    { [ "$runtime" != node ] || { [ -f "$root/rest.started" ] && [ -f "$root/fitting.started" ]; }; }; then
    ready=true
  fi
  if [ "$ready" = true ]; then
    touch "$root/$role.finished"
    if [ "$failure" = "$role" ]; then exit 7; fi
    exit 0
  fi
  sleep 0.01
done
exit 99
`;

// Flags each process receives after the runtime's own test flags.
const SCHEDULING = {
  first: ['--shard=1/2'],
  second: ['--shard=2/2'],
};
const NODE_SCHEDULING = {
  matching: ['--test-name-pattern=matches a'],
  rest: ['--test-skip-pattern=matches a'],
  fitting: ['--test-concurrency=1'],
};
const schedulingFlags = (runtime, role) =>
  SCHEDULING[role] ?? (runtime === 'node' ? NODE_SCHEDULING[role] : null) ?? [];

// Files of every process but the bulk one, which runs the remaining files.
const ROLE_FILES = {
  matching: ['tests/voice-match.test.js'],
  rest: ['tests/voice-match.test.js'],
  fitting: ['tests/recognition-modes.test.js', 'tests/voice-fit.test.js'],
  modes: ['tests/recognition-modes.test.js'],
};
const roleFiles = (role) => ROLE_FILES[role];

describe('Runtime suite scheduling', () => {
  for (const runtime of ['node', 'deno', 'bun']) {
    const roles =
      runtime === 'bun'
        ? ['matching', 'first', 'second', 'modes']
        : runtime === 'node'
          ? ['matching', 'rest', 'fitting', 'bulk']
          : ['matching', 'bulk'];
    const flags =
      runtime === 'node'
        ? ['--test', '--test-timeout=30000']
        : runtime === 'deno'
          ? ['test', '-A', '--parallel']
          : ['test', '--timeout', '30000'];
    for (const failing of ['none', ...roles]) {
      itUnless(sandboxed, noPosixShell)(
        `${runtime}: retains every file and reaps all phases (${failing} fails)`,
        async () => {
          const root = mkdtempSync(path.join(tmpdir(), 'runtime-shards-'));
          let failure;
          try {
            const command = path.join(root, 'fixture.sh');
            writeFileSync(command, fixture);
            const launcher =
              runtime === 'bun'
                ? ['scripts/run-bun-tests.sh']
                : ['scripts/run-runtime-tests.sh', runtime];
            let result = 0,
              stderr = '';
            try {
              await runBounded(
                'bash',
                [...launcher, 'bash', command, runtime, root, failing],
                { timeout: HANG_GUARD_MS }
              );
            } catch (error) {
              if (error.timedOut || !Number.isInteger(error.code)) {
                throw error;
              }
              stderr = error.stderr;
              result = error.code;
            }
            expect(result).toBe(failing === 'none' ? 0 : 7, stderr);
            const remaining = readdirSync('tests')
              .filter(
                (file) =>
                  file.endsWith('.test.js') &&
                  file !== 'voice-match.test.js' &&
                  !(runtime === 'node' && file === 'voice-fit.test.js') &&
                  !(runtime !== 'deno' && file === 'recognition-modes.test.js')
              )
              .map((file) => `tests/${file}`)
              .sort();
            for (const role of roles) {
              const args = readFileSync(path.join(root, `${role}.args`), 'utf8')
                .trim()
                .split('\n');
              const scheduling = schedulingFlags(runtime, role);
              expect(args.splice(0, flags.length + scheduling.length)).toEqual([
                ...flags,
                ...scheduling,
              ]);
              expect(args.sort()).toEqual(roleFiles(role) ?? remaining);
              expect(
                readFileSync(path.join(root, `${role}.finished`), 'utf8')
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
  }
});
