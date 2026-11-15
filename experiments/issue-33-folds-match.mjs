/**
 * Acceptance check of issue 33: "Hello." with the fold source and with the
 * LF source through the CLI, then `match` on both files; the f0 that
 * `match` reports must differ by less than 8 %.
 *
 *   node experiments/issue-33-folds-match.mjs [directory]
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../bin/voice-simulator.js';

const directory =
  process.argv[2] ?? mkdtempSync(join(tmpdir(), 'voice-folds-'));

async function run(argv) {
  const lines = [];
  const code = await runCli(argv, {
    stdout: (line) => lines.push(String(line)),
    stderr: (line) => lines.push(String(line)),
  });
  if (code !== 0) {
    throw new Error(`${argv.join(' ')}: exit ${code}\n${lines.join('\n')}`);
  }
  return lines;
}

const pitches = {};
for (const source of ['lf', 'folds']) {
  const file = join(directory, `${source}.wav`);
  const argv = ['say', 'Hello.', '--source', source, '--out', file];
  await run(argv);
  const report = await run(['match', file]);
  const f0 = Number(/f0 (\d+(?:\.\d+)?) Hz/.exec(report[0])[1]);
  pitches[source] = f0;
  console.log(
    `voice-simulator ${argv.slice(0, 4).join(' ')} --out ${source}.wav`
  );
  console.log(`  match: ${report[0]}`);
}
const difference = Math.abs(pitches.folds - pitches.lf) / pitches.lf;
console.log(`f0 difference ${(difference * 100).toFixed(1)} % (limit 8 %)`);
