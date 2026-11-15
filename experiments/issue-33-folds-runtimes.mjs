/**
 * Compares the samples of one utterance between Node.js, Bun and Deno, for
 * the LF and the fold source (default tier, seed 1).
 *
 * Run, for each source and runtime:
 *   node experiments/issue-33-folds-runtimes.mjs dump folds /tmp/folds-node.bin
 *   bun experiments/issue-33-folds-runtimes.mjs dump folds /tmp/folds-bun.bin
 *   deno run -A experiments/issue-33-folds-runtimes.mjs dump folds /tmp/folds-deno.bin
 * then
 *   node experiments/issue-33-folds-runtimes.mjs compare /tmp/folds-node.bin /tmp/folds-bun.bin
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { synthesize } from '../src/index.js';

const [command, ...args] = process.argv.slice(2);

function load(path) {
  const bytes = readFileSync(path);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

if (command === 'dump') {
  const [source, path] = args;
  const { samples } = synthesize('Hello, world.', { source, seed: 1 });
  writeFileSync(
    path,
    new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
  );
} else if (command === 'compare') {
  const [a, b] = args.map(load);
  let largest = 0;
  let differing = 0;
  let first = -1;
  for (let index = 0; index < a.length; index++) {
    const difference = Math.abs(a[index] - b[index]);
    if (difference > 0) {
      differing++;
      first = first < 0 ? index : first;
    }
    largest = Math.max(largest, difference);
  }
  console.log(
    `${args[0]} vs ${args[1]}: ${a.length} and ${b.length} samples, ` +
      `${differing} differ (first ${first}), largest difference ${largest.toExponential(2)}`
  );
} else {
  console.log('Usage: dump <lf|folds> <file> | compare <file> <file>');
}
