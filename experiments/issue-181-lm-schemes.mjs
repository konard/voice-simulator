// Issue 181: language-model scores of the competing readings of "Hello
// world." under candidate unigram priors, added to the acoustic scores of
// experiments/issue-181-scores.txt. node experiments/issue-181-lm-schemes.mjs
// Unlicense.
import { readFileSync } from 'node:fs';
import { getLexicon } from '../src/recognition/lexicon.js';
import { HMM_DECODE_DEFAULTS } from '../src/recognition/hmm-decode.js';

const lex = getLexicon('en');
const spoken = new Map(
  readFileSync(
    new globalThis.URL('../data/lexicon/en-counts.txt', import.meta.url),
    'utf8'
  )
    .trim()
    .split('\n')
    .map((line) => line.split(' '))
    .map(([w, c]) => [w, Number(c)])
);
let spokenTotal = 0;
for (const c of spoken.values()) {
  spokenTotal += c;
}
const { lmw, wip, minCount } = HMM_DECODE_DEFAULTS;
const acoustic = {
  telephone: {
    'hello world': -6009.2,
    'her no world': -5995.9,
    'hollow world': -6040.8,
    'to know world': -6055.9,
  },
  wideband: {
    'hello world': -5606.5,
    'her no world': -5612.8,
    'hollow world': -5623.9,
    'to know world': -5665.5,
  },
};
const schemes = {
  current: (w) =>
    Math.log((0.4 * Math.max(lex.counts.get(w) ?? 1, minCount)) / lex.total),
  'unseen from spoken (scaled)': (w) => {
    const c = lex.counts.get(w) ?? 1;
    const s =
      c > 1
        ? c
        : Math.max(minCount, ((spoken.get(w) ?? 0) * lex.total) / spokenTotal);
    return Math.log((0.4 * s) / lex.total);
  },
  'mixture 1:1': (w) =>
    Math.log(
      0.4 *
        ((0.5 * Math.max(lex.counts.get(w) ?? 1, minCount)) / lex.total +
          (0.5 * (spoken.get(w) ?? 0)) / spokenTotal)
    ),
  'max of the two': (w) =>
    Math.log(
      0.4 *
        Math.max(
          Math.max(lex.counts.get(w) ?? 1, minCount) / lex.total,
          (spoken.get(w) ?? 0) / spokenTotal
        )
    ),
};
for (const [name, lnp] of Object.entries(schemes)) {
  console.log(name);
  for (const tier of Object.keys(acoustic)) {
    const rows = Object.entries(acoustic[tier])
      .map(([reading, a]) => {
        const lm = reading
          .split(' ')
          .reduce((sum, w) => sum + lmw * lnp(w) + wip, 0);
        return [reading, lm, a + lm];
      })
      .sort((x, y) => y[2] - x[2]);
    console.log(
      `  ${tier}: ${rows
        .map(([r, lm, t]) => `${r} ${lm.toFixed(1)}/${t.toFixed(1)}`)
        .join(', ')}`
    );
  }
}
