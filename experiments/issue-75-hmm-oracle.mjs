/**
 * Model or search error? For each sentence, the forced-alignment acoustic
 * score of the decoded words against that of the words the synthesiser
 * spoke (its IPA). Reference better than the decode → search/LM error;
 * worse → the acoustic model prefers the wrong words.
 * node experiments/issue-75-hmm-oracle.mjs [tier] [lang] [from] [to] [preset]
 * Environment: BLIND=0, WORDS. Unlicense.
 */
import { synthesize } from '../src/index.js';
import { parseIpa } from '../src/ipa/parse.js';
import { hmmFeatures } from '../src/recognition/hmm-features.js';
import { getHmmModel } from '../src/recognition/hmm-model.js';
import { getNetwork } from '../src/recognition/hmm-network.js';
import { alignWords, decodeWords } from '../src/recognition/hmm-decode.js';
import { sentences } from '../tests/helpers/roundtrip.js';

const [
  tier = 'telephone',
  lang = 'en',
  from = '0',
  to = '20',
  preset = 'male',
] = process.argv.slice(2);
const env = process.env;
const model = getHmmModel();
const network = getNetwork(
  model,
  env.BLIND === '0' ? [lang] : ['en', 'ru', 'hi', 'zh'],
  { maxWords: env.WORDS ? Number(env.WORDS) : undefined, oov: env.OOV === '1' }
);
const score = (feats, frames, words) => {
  let s = -Infinity;
  alignWords(network, feats, frames, words, { onScore: (v) => (s = v) });
  return s;
};
let model_ = 0;
let search = 0;
let right = 0;
for (
  let i = Number(from);
  i < Math.min(Number(to), sentences[lang].length);
  i++
) {
  const spoken = synthesize(sentences[lang][i], {
    lang,
    tier,
    preset,
    head: 'random',
    seed: 1,
  });
  const { feats, frames } = hmmFeatures(
    spoken.samples,
    spoken.sampleRate,
    model.lda
  );
  const decoded = decodeWords(network, feats, frames);
  const ref = spoken.ipa
    .split(/[\s|.,?!]+/u)
    .filter(Boolean)
    .map((w) => {
      const tokens = parseIpa(w).tokens.filter(
        (t) => t.kind === 'vowel' || t.kind === 'consonant'
      );
      return { tokens, units: tokens.map((t) => t.symbol) };
    })
    .filter((w) => w.tokens.length);
  const missing = ref
    .flatMap((w) => w.units)
    .filter((u) => !model.ciIndex.has(`${u}#0`));
  const hypIpa = decoded.words.map((w) => w.units.join('')).join(' ');
  const refIpa = ref.map((w) => w.units.join('')).join(' ');
  const h = score(feats, frames, decoded.words);
  const r = missing.length ? NaN : score(feats, frames, ref);
  const kind = hypIpa === refIpa ? 'same' : r > h ? 'SEARCH' : 'MODEL';
  if (kind === 'same') {
    right++;
  } else if (kind === 'SEARCH') {
    search++;
  } else {
    model_++;
  }
  console.log(
    i,
    kind,
    (r - h).toFixed(1),
    `hyp ${hypIpa}`,
    '|',
    `ref ${refIpa}`,
    missing.length ? `missing ${missing}` : ''
  );
}
console.log(
  `${lang} ${tier} ${preset} same ${right} search ${search} model ${model_}`
);
