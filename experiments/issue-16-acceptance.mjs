// Issue 16: run the acceptance checks of the speech dataset registry and print
// each command with its exit code and output. The committed registry is never
// changed: the broken variants are written to a temporary folder and passed
// with --registry. Needs the network for the fetches that are not cached.
// Usage: node experiments/issue-16-acceptance.mjs
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadList, datasetFindings } from '../scripts/check-policy.mjs';
import { REPO_ROOT, formatJson, loadRegistry } from '../scripts/datasets.mjs';

const script = path.join(REPO_ROOT, 'scripts', 'datasets.mjs');
const tmp = mkdtempSync(path.join(tmpdir(), 'issue-16-'));

function run(command, args) {
  const result = spawnSync(command, args, { cwd: REPO_ROOT, encoding: 'utf8' });
  const shown = [command === process.execPath ? 'node' : command, ...args]
    .join(' ')
    .replace(REPO_ROOT + path.sep, '')
    .replaceAll(tmp, '$TMP');
  console.log(`$ ${shown}\nexit ${result.status}`);
  const output = `${result.stdout}${result.stderr}`.trim();
  if (output) {
    console.log(output.replaceAll(tmp, '$TMP'));
  }
  console.log('');
  return result.status;
}

function variant(name, change) {
  const registry = loadRegistry();
  change(registry);
  const file = path.join(tmp, `${name}.json`);
  writeFileSync(file, `${formatJson(registry)}\n`);
  return { file, registry };
}

try {
  const registry = loadRegistry();
  const nulls = JSON.stringify(registry).match(
    /"(sha256|size|textSha256)":null/g
  );
  console.log(
    `null checksums in datasets/registry.json: ${nulls?.length ?? 0}\n`
  );
  run(process.execPath, [script, 'verify']);
  // A fresh cache: the first run downloads, the second finds all cached.
  const fresh = ['--cache', path.join(tmp, 'fresh')];
  run(process.execPath, [
    script,
    'fetch',
    'fleurs-ru',
    '--limit',
    '3',
    ...fresh,
  ]);
  run(process.execPath, [
    script,
    'fetch',
    'fleurs-ru',
    '--limit',
    '3',
    ...fresh,
  ]);

  const wrongSha = variant('wrong-sha', (data) => {
    const file = data.datasets.find(
      (item) => item.id === 'librivox-aesop-en-22'
    ).source.files[0];
    file.sha256 = `${file.sha256[0] === '0' ? '1' : '0'}${file.sha256.slice(1)}`;
  });
  // A separate cache, so that the real cached copy is not deleted.
  run(process.execPath, [
    script,
    'fetch',
    'librivox-aesop-en-22',
    '--registry',
    wrongSha.file,
    '--cache',
    path.join(tmp, 'cache'),
  ]);

  const nc = variant('non-commercial', (data) => {
    data.datasets.push({
      ...data.datasets.find((item) => item.id === 'librivox-aesop-en-22'),
      id: 'nc-sample',
      licence: 'CC-BY-NC-4.0',
      redistribution: false,
    });
  });
  run(process.execPath, [script, 'verify', '--registry', nc.file]);
  const root = path.join(tmp, 'repo');
  mkdirSync(path.join(root, 'datasets'), { recursive: true });
  writeFileSync(
    path.join(root, 'datasets', 'registry.json'),
    `${formatJson(nc.registry)}\n`
  );
  const findings = datasetFindings(root, loadList(REPO_ROOT), []);
  console.log('datasetFindings for the non-commercial variant:');
  for (const item of findings) {
    console.log(
      `${item.file}:${item.line} ${item.rule} ${item.name}: ${item.message}`
    );
  }
  console.log('');
  run('git', ['status', '--short', '.datasets']);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
