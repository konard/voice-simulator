// Quick check of levels, offsets and peaks of the effort modes (issue 52).
// Usage: node experiments/issue-52-quick.mjs
import { synthesize } from '../src/index.js';
import { levelDb } from '../src/analysis/mode-features.js';

const text = 'Please call Stella.';
const cases = ['', 'soft', 'loud', 'shout', 'lombard'];
for (const tag of cases) {
  const input = tag ? `[${tag}]${text}[/${tag}]` : text;
  for (const headroom of [20, undefined]) {
    const r = synthesize(input, {
      tier: 'medium',
      seed: 1,
      markup: true,
      headroom,
    });
    let peak = 0;
    let over = 0;
    for (const v of r.samples) {
      peak = Math.max(peak, Math.abs(v));
      if (Math.abs(v) > 0.9) {
        over++;
      }
    }
    console.log(
      (tag || 'plain').padEnd(8),
      `headroom=${headroom}`,
      `level=${levelDb(r.samples, 0, r.samples.length).toFixed(2)}`,
      `offset=${r.levelOffsetDb}`,
      `peak=${peak.toFixed(3)}`,
      `over0.9=${over}`,
      `dur=${r.duration.toFixed(3)}`
    );
  }
}
