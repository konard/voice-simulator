/**
 * Forced-alignment scores of one sentence with one reference word swapped
 * for variant pronunciations, to tell which phone or tone loses.
 * node experiments/issue-75-word-variants.mjs <lang> <index> <word#> <units;units...>
 * e.g. zh 1 3 "k w o@2;k w o@1;t w o@1;t w o@2;x w o@3". Unlicense.
 */
import { synthesize } from '../src/index.js';
import { parseIpa } from '../src/ipa/parse.js';
import { hmmFeatures } from '../src/recognition/hmm-features.js';
import { getHmmModel, toneUnits } from '../src/recognition/hmm-model.js';
import { getNetwork } from '../src/recognition/hmm-network.js';
import { alignWords } from '../src/recognition/hmm-decode.js';
import { sentences } from '../tests/helpers/roundtrip.js';

const [lang, index, at, variants] = process.argv.slice(2);
const model = getHmmModel();
const spoken = synthesize(sentences[lang][Number(index)], {
  lang,
  tier: process.env.TIER ?? 'telephone',
  preset: process.env.PRESET ?? 'male',
  head: 'random',
  seed: 1,
});
const { feats, frames } = hmmFeatures(
  spoken.samples,
  spoken.sampleRate,
  model.lda
);
const words = spoken.ipa
  .split(/[\s|.,?!]+/u)
  .filter(Boolean)
  .map((w) => {
    const tokens = parseIpa(w).tokens.filter(
      (t) => t.kind === 'vowel' || t.kind === 'consonant'
    );
    const units =
      lang === 'zh' ? toneUnits(tokens) : tokens.map((t) => t.symbol);
    return { word: '', tokens, units };
  })
  .filter((w) => w.tokens.length);
const network = getNetwork(model, [lang]);
const score = (list) => {
  let s = -Infinity;
  const aligned = alignWords(network, feats, frames, list, {
    onScore: (v) => {
      s = v;
    },
  });
  return { s, aligned };
};
const base = score(words);
console.log(
  `reference ${words.map((w) => w.units.join(' ')).join(' | ')}: ${base.s.toFixed(1)}`
);
for (const variant of variants.split(';')) {
  const units = variant.trim().split(/\s+/u);
  const symbols = units.map((u) => u.replace(/@\d$/u, ''));
  const tokens = symbols.map((symbol) => ({
    symbol,
    kind: /[aeiouəɛɔʊɪɤɨyæɑɒʌɜøœɐ]/u.test(symbol) ? 'vowel' : 'consonant',
  }));
  const list = words.map((w, i) =>
    i === Number(at) ? { word: '', tokens, units } : w
  );
  const { s, aligned } = score(list);
  const spans = aligned
    .filter((a) => a.word === Number(at))
    .map((a) => `${a.token.symbol}:${a.from}-${a.to}`)
    .join(' ');
  console.log(
    `${variant.padEnd(14)} ${s.toFixed(1)} (${(s - base.s).toFixed(1)}) ${spans}`
  );
}
