/**
 * Per-frame emission scores of the three states of two competing units in
 * the same left/right context (the context states the network uses), for
 * a span of a round-trip sentence, to see which frames decide between them.
 * node experiments/issue-75-frame-states.mjs <lang> <index|text> <from> <to>
 *   <unitA> <unitB> <left> <right>
 * Environment: TIER (telephone), PRESET (male).
 * Unlicense.
 */
import { synthesize } from '../src/index.js';
import { hmmFeatures } from '../src/recognition/hmm-features.js';
import {
  getHmmModel,
  stateIndex,
  stateScore,
} from '../src/recognition/hmm-model.js';
import { sentences } from '../tests/helpers/roundtrip.js';
import { frameLabels } from './issue-75-hmm-lib.mjs';

const [lang, index, from, to, a, b, left, right] = process.argv.slice(2);
const text = /^\d+$/u.test(index) ? sentences[lang][Number(index)] : index;
const spoken = synthesize(text, {
  lang,
  tier: process.env.TIER ?? 'telephone',
  preset: process.env.PRESET ?? 'male',
  head: 'random',
  seed: 1,
});
const model = getHmmModel();
const { feats, frames } = hmmFeatures(
  spoken.samples,
  spoken.sampleRate,
  model.lda
);
const { labels } = frameLabels(spoken.plan, frames);
const states = (unit) =>
  [0, 1, 2].map((s) => stateIndex(model, unit, s, left, right));
const sa = states(a);
const sb = states(b);
console.log(`${a}: states ${sa.join(',')}  ${b}: states ${sb.join(',')}`);
const fmt = (v) => v.toFixed(1).padStart(7);
for (let t = Number(from); t <= Number(to); t++) {
  const o = t * model.dims;
  const va = sa.map((m) => stateScore(m, feats, o, model));
  const vb = sb.map((m) => stateScore(m, feats, o, model));
  console.log(
    String(t).padStart(4),
    (labels[t] ?? '').padEnd(4),
    `${a}`,
    va.map(fmt).join(''),
    `  ${b}`,
    vb.map(fmt).join(''),
    `  best ${fmt(Math.max(...va) - Math.max(...vb))}`
  );
}
