// Unlicense. Finite probe: Node sorts explicit CLI paths before scheduling.
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { deepStrictEqual } from 'node:assert';
const root = mkdtempSync('experiments/issue-63/test-order-');
try {
  const files = ['z', 'a', 'm'].map((name) => {
    const file = join(root, `${name}.test.mjs`);
    writeFileSync(
      file,
      `import {test} from 'node:test';test('${name}',()=>console.log('starts ${name}'));`
    );
    return file;
  });
  const result = spawnSync(
    process.execPath,
    ['--test', '--test-concurrency=1', ...files],
    { encoding: 'utf8' }
  );
  console.log(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}

// Explicit paths must retain Bun's native disjoint shard selection.
const selection = [
  'tests/voice-file.test.js',
  'tests/voice-fit-numerics.test.js',
  'tests/ci-timeouts.test.js',
];
const observed = [];
for (const shard of ['', '--shard=1/2', '--shard=2/2']) {
  const result = spawnSync(
    'bun',
    ['test', '--timeout', '30000', ...(shard ? [shard] : []), ...selection],
    { encoding: 'utf8' }
  );
  const output = result.stdout + result.stderr;
  const files = [...output.matchAll(/^tests\/[^\r\n]+\.test\.js:$/gm)]
    .map(([line]) => line.slice(0, -1))
    .sort();
  console.log(JSON.stringify({ shard, status: result.status, files }));
  if (result.status !== 0) {
    throw new Error(output);
  }
  observed.push(files);
}
deepStrictEqual(observed[0], [...selection].sort());
deepStrictEqual([...observed[1], ...observed[2]].sort(), observed[0]);

// Run the same bounded ordering regression against the previous launcher
// and this draft in a disposable fixture, without editing the worktree.
const fixtureRoot = mkdtempSync('experiments/issue-63/scheduling-regression-');
try {
  mkdirSync(join(fixtureRoot, 'scripts'));
  mkdirSync(join(fixtureRoot, 'tests'));
  for (const name of ['voice-match', 'other']) {
    writeFileSync(join(fixtureRoot, `tests/${name}.test.js`), '');
  }
  const old = execFileSync('git', [
    'show',
    'ab5449363a21042644aa9357e07b441f05dd0167:scripts/run-bun-tests.sh',
  ]);
  for (const version of ['previous', 'draft']) {
    writeFileSync(
      join(fixtureRoot, 'scripts/run-bun-tests.sh'),
      version === 'previous' ? old : readFileSync('scripts/run-bun-tests.sh')
    );
    writeFileSync(
      join(fixtureRoot, 'scripts/run-runtime-tests.sh'),
      readFileSync('scripts/run-runtime-tests.sh')
    );
    const result = spawnSync(
      process.execPath,
      [
        '--test',
        '--test-name-pattern=bun:.*none fails',
        resolve('tests/bun-shards.test.js'),
      ],
      { cwd: fixtureRoot, encoding: 'utf8' }
    );
    console.log(JSON.stringify({ version, status: result.status }));
    deepStrictEqual(result.status, version === 'previous' ? 1 : 0);
  }
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}
