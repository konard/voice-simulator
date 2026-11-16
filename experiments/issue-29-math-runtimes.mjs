// Which Math functions give different last bits between runtimes: a hash
// of each over 200000 arguments from the shared generator.
// node|bun|deno run -A experiments/issue-29-math-runtimes.mjs
import { createHash } from 'node:crypto';

import { createRandom } from '../src/random.js';

const random = createRandom(1);
const args = Float64Array.from({ length: 200000 }, () => (random() - 0.5) * 40);
const unary = [
  'sin',
  'cos',
  'tan',
  'exp',
  'expm1',
  'log',
  'log1p',
  'log10',
  'log2',
  'sqrt',
  'cbrt',
  'atan',
  'asin',
  'acos',
  'sinh',
  'cosh',
  'tanh',
  'atanh',
];
const line = [];
for (const name of unary) {
  const out = args.map((x) =>
    Math[name](name.startsWith('a') && name !== 'atan' ? x / 40 : x)
  );
  line.push(
    `${name}:${createHash('sha256').update(new Uint8Array(out.buffer)).digest('hex').slice(0, 8)}`
  );
}
for (const name of ['pow', 'atan2', 'hypot']) {
  const out = args.map((x, i) =>
    Math[name](Math.abs(x), args[(i + 1) % args.length] / 8)
  );
  line.push(
    `${name}:${createHash('sha256').update(new Uint8Array(out.buffer)).digest('hex').slice(0, 8)}`
  );
}
console.log(line.join(' '));
