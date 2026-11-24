/**
 * Per-frame emission scores of chosen units around a span of a round-trip
 * sentence: the best context-independent state and the best context state
 * of each unit, plus the tone-stream score of the unit, to see which
 * frames a wrong phone wins.
 * node experiments/issue-75-frame-scores.mjs <lang> <index> <from> <to> <unit,...>
 * Environment: TIER (telephone), PRESET (male).
 * Unlicense.
 */
import { synthesize } from '../src/index.js';
import { hmmFeatures } from '../src/recognition/hmm-features.js';
import { getHmmModel, stateScore } from '../src/recognition/hmm-model.js';
import { sentences } from '../tests/helpers/roundtrip.js';

const [lang, index, from, to, list] = process.argv.slice(2);
const model = getHmmModel();
const spoken = synthesize(sentences[lang][Number(index)], {
  lang,
  tier: process.env.TIER ?? 'telephone',
  preset: process.env.PRESET ?? 'male',
  head: 'random',
  seed: 1,
});
const { feats, tone } = hmmFeatures(
  spoken.samples,
  spoken.sampleRate,
  model.lda
);
const units = list.split(',');
const contexts = new Map(units.map((u) => [u, []]));
for (const [key, m] of model.contextIndex) {
  const unit = key.split('#')[0];
  if (contexts.has(unit)) {
    contexts.get(unit).push([key, m]);
  }
}
console.log(
  `frame ${units.map((u) => `${u}:ci ctx(best key) tone`.padEnd(34)).join('')}`
);
for (let t = Number(from); t < Number(to); t++) {
  const cells = units.map((u) => {
    const i = model.units.indexOf(u);
    const ci = Math.max(
      ...[0, 1, 2].map((s) =>
        stateScore(3 * i + s, feats, t * model.dims, model)
      )
    );
    let best = [-Infinity, ''];
    for (const [key, m] of contexts.get(u)) {
      const s = stateScore(m, feats, t * model.dims, model);
      if (s > best[0]) {
        best = [s, key];
      }
    }
    const toneScore = stateScore(
      model.tone.ofState[3 * i + 1],
      tone,
      t * model.tone.dims,
      model.tone
    );
    return `${ci.toFixed(1)} ${best[0].toFixed(1)}(${best[1]}) ${toneScore.toFixed(1)}`.padEnd(
      34
    );
  });
  console.log(`${String(t).padStart(5)} ${cells.join('')}`);
}
