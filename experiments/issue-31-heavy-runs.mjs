/**
 * Issue 31: start Heavy checks (suite performance) `count` times, one after
 * the other (the concurrency group of the workflow cancels a run in
 * progress), and download each run's reports into `<out>/<run id>`.
 *
 *   node experiments/issue-31-heavy-runs.mjs <branch> <count> <out>
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const REPO = 'konard/voice-simulator';
const [branch, count = '5', out = 'heavy-runs'] = process.argv.slice(2);

function gh(...args) {
  return execFileSync('gh', args, { encoding: 'utf8' }).trim();
}

function latestRun() {
  return gh(
    'run',
    'list',
    '--repo',
    REPO,
    '--workflow',
    'heavy.yml',
    '--branch',
    branch,
    '--limit',
    '1',
    '--json',
    'databaseId',
    '--jq',
    '.[0].databaseId // 0'
  );
}

function runField(run, field) {
  return gh(
    'run',
    'view',
    run,
    '--repo',
    REPO,
    '--json',
    field,
    '--jq',
    `.${field}`
  );
}

const wait = (seconds) =>
  new Promise((resolve) => setTimeout(resolve, seconds * 1000));

mkdirSync(out, { recursive: true });
for (let index = 1; index <= Number(count); index++) {
  const before = latestRun();
  gh(
    'workflow',
    'run',
    'heavy.yml',
    '--repo',
    REPO,
    '--ref',
    branch,
    '-f',
    'suite=performance'
  );
  let run = before;
  while (run === before) {
    await wait(10);
    run = latestRun();
  }
  while (runField(run, 'status') !== 'completed') {
    await wait(30);
  }
  console.log(`run ${index}: ${run} ${runField(run, 'conclusion')}`);
  try {
    gh('run', 'download', run, '--repo', REPO, '-D', path.join(out, run));
  } catch {
    console.log(`run ${index}: no artifact`);
  }
}
