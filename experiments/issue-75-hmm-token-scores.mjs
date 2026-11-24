/**
 * Per-token acoustic scores of two forced alignments (reference and
 * decoded), to find the frames that decide an error.
 * node experiments/issue-75-hmm-token-scores.mjs <lang> <index> [tier] [preset]
 * Unlicense.
 */
import { synthesize } from '../src/index.js';
import { hmmFeatures } from '../src/recognition/hmm-features.js';
import {
  contextClass,
  getHmmModel,
  stateIndex,
  stateScore,
} from '../src/recognition/hmm-model.js';
import { getNetwork, tokenIpa } from '../src/recognition/hmm-network.js';
import { alignWords, decodeWords } from '../src/recognition/hmm-decode.js';
import { sentences } from '../tests/helpers/roundtrip.js';

const [lang = 'en', index = '17', tier = 'telephone', preset = 'male'] =
  process.argv.slice(2);
const model = getHmmModel();
const text = sentences[lang][Number(index)];
const spoken = synthesize(text, {
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
const network = getNetwork(model, [lang], { maxWords: 20000 });
const d = decodeWords(network, feats, frames);
const byWord = new Map();
for (const w of network.words) {
  byWord.set(w.word, [...(byWord.get(w.word) ?? []), w]);
}
const bare = (ipa) => ipa.replace(/[ˈˌ]/gu, '');
const ref = spoken.timeline.words.map((w) => {
  const all = byWord.get(String(w.text ?? w.word).toLowerCase()) ?? [];
  return (
    all.find((v) => bare(v.tokens.map(tokenIpa).join('')) === bare(w.ipa)) ??
    all[0]
  );
});
function report(name, words) {
  const aligned = alignWords(network, feats, frames, words);
  const rows = aligned.map((a) => {
    const w = words[a.word];
    const i = w.tokens.indexOf(a.token);
    const left = i > 0 ? contextClass(w.tokens[i - 1].symbol) : null;
    const right =
      i + 1 < w.tokens.length ? contextClass(w.tokens[i + 1].symbol) : null;
    let sum = 0;
    for (let t = a.from; t < a.to; t++) {
      let best = -Infinity;
      for (const u of [w.units[i], `${w.units[i]}_r`]) {
        if (!model.ciIndex.has(`${u}#0`)) {
          continue;
        }
        for (let s = 0; s < 3; s++) {
          best = Math.max(
            best,
            stateScore(
              stateIndex(model, u, s, left, right),
              feats,
              t * model.dims,
              model
            )
          );
        }
      }
      sum += best;
    }
    return `${tokenIpa(a.token)}[${a.from}-${a.to}]${sum.toFixed(0)}`;
  });
  console.log(name, rows.join(' '));
}
console.log(text, 'frames', frames);
report('ref', ref);
report('hyp', d.words);
const plan = spoken.timeline.words.flatMap((w) => w.syllables ?? []);
console.log(
  'plan syllables',
  plan
    .map((s) => `${s.ipa}@${s.start?.toFixed?.(2)}-${s.end?.toFixed?.(2)}`)
    .join(' ')
);
