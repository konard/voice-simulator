// Unlicense. Bounded native-worker check: isolation, overlap and failure draining.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { resolve, join } from 'node:path';

const root = resolve(mkdtempSync('experiments/issue-63/native-bun-queue-'));
try {
  for (const failure of [false, true]) {
    const events = join(root, `events-${failure}.txt`);
    writeFileSync(events, '');
    const files = ['a', 'b', 'c'].map((name) => {
      const file = join(root, `${name}.test.js`);
      writeFileSync(
        file,
        `import {test, expect} from 'bun:test';
import {appendFileSync, readFileSync} from 'node:fs';
test('${name}', async () => {
  expect(globalThis.queueFixture).toBeUndefined();
  globalThis.queueFixture = '${name}';
  const events = ${JSON.stringify(events)};
  appendFileSync(events, 'start ${name}\\n');
  for (let poll = 0; poll < 300; poll++) {
    if (readFileSync(events, 'utf8').split('start ').length >= 3) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  expect(readFileSync(events, 'utf8').split('start ').length >= 3).toBe(true);
  appendFileSync(events, 'finish ${name}\\n');
  expect(${failure && name === 'a'}).toBe(false);
});`
      );
      return file;
    });
    const result = spawnSync(
      'bun',
      ['test', '--timeout', '10000', '--parallel=2', ...files],
      { cwd: root, encoding: 'utf8' }
    );
    const lines = readFileSync(events, 'utf8').trim().split('\n');
    console.log(
      JSON.stringify({ failure, status: result.status, events: lines })
    );
    strictEqual(result.status, failure ? 1 : 0, result.stdout + result.stderr);
    deepStrictEqual(
      [...lines].sort(),
      ['a', 'b', 'c']
        .flatMap((name) => [`start ${name}`, `finish ${name}`])
        .sort()
    );
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
