/**
 * Frame classification of context-independent units on plan labels:
 * which unit scores best on the frames of each labelled unit.
 * node experiments/issue-75-hmm-confusion.mjs [tier] [preset] [lang] [from] [to]
 * Unlicense.
 */
import { synthesize } from '../src/index.js';
import { hmmFeatures } from '../src/recognition/hmm-features.js';
import { getHmmModel, stateScore } from '../src/recognition/hmm-model.js';
import { sentences } from '../tests/helpers/roundtrip.js';
import { frameLabels } from './issue-75-hmm-lib.mjs';

const [
  tier = 'telephone',
  preset = 'male',
  lang = 'en',
  from = '0',
  to = '20',
] = process.argv.slice(2);
const model = getHmmModel();
const watch = (process.env.UNITS ?? 'p,t,k,b,d,ɡ,m,n,f,s,v,z,w').split(',');
const units = model.units.filter((u) => !u.includes('_r'));
const confusion = new Map();
for (let i = Number(from); i < Number(to); i++) {
  const spoken = synthesize(sentences[lang][i], {
    lang,
    tier,
    head: 'random',
    preset,
    seed: 1,
  });
  const { feats, frames } = hmmFeatures(
    spoken.samples,
    spoken.sampleRate,
    model.lda
  );
  const { labels } = frameLabels(spoken.plan, frames);
  for (let t = 0; t < frames; t++) {
    if (!watch.includes(labels[t])) {
      continue;
    }
    let best = null;
    let bestScore = -Infinity;
    for (const u of units) {
      for (let s = 0; s < 3; s++) {
        const v = stateScore(
          model.ciIndex.get(`${u}#${s}`),
          feats,
          t * model.dims,
          model
        );
        if (v > bestScore) {
          bestScore = v;
          best = u;
        }
      }
    }
    const row = confusion.get(labels[t]) ?? new Map();
    row.set(best, (row.get(best) ?? 0) + 1);
    confusion.set(labels[t], row);
  }
}
for (const [label, row] of confusion) {
  const total = [...row.values()].reduce((a, b) => a + b, 0);
  const top = [...row].sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(
    label.padEnd(3),
    String(total).padStart(4),
    `right ${(((row.get(label) ?? 0) / total) * 100).toFixed(0)}%`,
    top.map(([u, n]) => `${u}:${n}`).join(' ')
  );
}
