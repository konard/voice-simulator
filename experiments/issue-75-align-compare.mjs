/**
 * Forced alignments of the blind decode and of the reference words side by
 * side: phone spans, and the acoustic score of each span (emission of the
 * aligned context state per frame), to show where a wrong decode wins.
 * node experiments/issue-75-align-compare.mjs <lang> <index> [tier] [preset]
 * Unlicense.
 */
import { synthesize } from '../src/index.js';
import { parseIpa } from '../src/ipa/parse.js';
import { hmmFeatures } from '../src/recognition/hmm-features.js';
import { getHmmModel, toneUnits } from '../src/recognition/hmm-model.js';
import { getNetwork } from '../src/recognition/hmm-network.js';
import { alignWords, decodeWords } from '../src/recognition/hmm-decode.js';
import { sentences } from '../tests/helpers/roundtrip.js';

const [lang = 'zh', index = '1', tier = 'telephone', preset = 'male'] =
  process.argv.slice(2);
const model = getHmmModel();
const spoken = synthesize(sentences[lang][Number(index)], {
  lang,
  tier,
  preset,
  head: 'random',
  seed: 1,
});
const { feats, frames, tone } = hmmFeatures(
  spoken.samples,
  spoken.sampleRate,
  model.lda
);
const network = getNetwork(model, [lang]);
const reference = spoken.ipa
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
// MERGE=2-3 aligns reference syllables 2 and 3 as one word, with
// word-internal context states across their boundary.
for (const range of (process.env.MERGE ?? '')
  .split(',')
  .filter(Boolean)
  .reverse()) {
  const [a, b] = range.split('-').map(Number);
  const merged = reference.slice(a, b + 1);
  reference.splice(a, b - a + 1, {
    word: '',
    tokens: merged.flatMap((w) => w.tokens),
    units: merged.flatMap((w) => w.units),
  });
}
const blind = decodeWords(network, feats, frames, { tone }).words;
for (const [name, words] of [
  ['blind', blind],
  ['reference', reference],
]) {
  let total = 0;
  const spans = alignWords(network, feats, frames, words, {
    tone,
    onScore: (s) => {
      total = s;
    },
  });
  console.log(`${name} ${total.toFixed(1)}`);
  let previous = -1;
  let i = 0;
  for (const a of spans) {
    i = a.word === previous ? i + 1 : 0;
    previous = a.word;
    const unit = words[a.word].units?.[i] ?? a.token.symbol;
    console.log(
      `  ${String(a.from).padStart(4)}-${String(a.to).padEnd(4)} ${unit}`
    );
  }
}
