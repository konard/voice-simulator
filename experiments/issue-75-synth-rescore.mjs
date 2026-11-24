/**
 * Does a render of each hypothesis with a generic voice tell the right
 * word from its confusion? DTW distance between normalised features of the
 * recording and renders of the reference and the confusion.
 * node experiments/issue-75-synth-rescore.mjs [tier] [preset] [voices]
 * Unlicense.
 */
import { synthesize } from '../src/index.js';
import { presetHeadConfig } from '../src/head-config.js';
import { hmmAudio, hmmStatics } from '../src/recognition/hmm-features.js';

const [tier = 'telephone', preset = 'male', voices = '4'] =
  process.argv.slice(2);
const pairs = [
  ['en', 'Is this your pen or mine?', 'Is this your ten or mine?'],
  ['en', 'Is this your pen or mine?', 'Is this your pen or nine?'],
  ['en', 'She sells sea shells.', 'She shells sea shells.'],
  ['en', 'The fox jumps over the dog.', 'The fox jumps sober the dog.'],
  ['en', 'Hello world.', 'Hollow world.'],
  ['en', 'Good morning.', 'Good warning.'],
];
const rows = (s) => hmmStatics(hmmAudio(s.samples, s.sampleRate)).statics;
function dtw(a, b) {
  const n = a.length;
  const m = b.length;
  let prev = new Float64Array(m + 1).fill(Infinity);
  let cur = new Float64Array(m + 1);
  prev[0] = 0;
  for (let i = 1; i <= n; i++) {
    cur.fill(Infinity);
    for (let j = 1; j <= m; j++) {
      let d = 0;
      for (let k = 0; k < 13; k++) {
        d += (a[i - 1][k] - b[j - 1][k]) ** 2;
      }
      cur[j] = Math.sqrt(d) + Math.min(prev[j], cur[j - 1], prev[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[m] / (n + m);
}
const heads = ['male', 'female', 'child'].flatMap((name) =>
  [0.25, 0.75].map((size) => ({
    name: `${name}${size}`,
    head: presetHeadConfig(name, size),
  }))
);
let right = 0;
let total = 0;
for (let seed = 1; seed <= Number(voices); seed++) {
  for (const [lang, ref, alt] of pairs) {
    const heard = rows(
      synthesize(ref, { lang, tier, preset, head: 'random', seed })
    );
    // Choose the voice that fits the (shared) hypothesis best: here the alternative.
    let best = null;
    for (const { name, head } of heads) {
      const d = dtw(heard, rows(synthesize(alt, { lang, tier, head })));
      if (!best || d < best.d) {
        best = { name, head, d };
      }
    }
    const a = dtw(
      heard,
      rows(synthesize(ref, { lang, tier, head: best.head }))
    );
    const b = best.d;
    total++;
    right += a < b ? 1 : 0;
    console.log(
      seed,
      a < b ? 'ok ' : 'BAD',
      best.name,
      a.toFixed(3),
      b.toFixed(3),
      ref,
      '|',
      alt
    );
  }
}
console.log(`right ${right}/${total}`);
