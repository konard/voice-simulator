// Issue 181: per-token acoustic scores of the aligned readings of
// "Hello world." (sum of the best state's log likelihood per frame).
// node experiments/issue-181-frames.mjs [tier] Unlicense.
import { synthesize } from '../src/index.js';
import { resample } from '../src/audio/resample.js';
import {
  getHmmModel,
  stateIndex,
  stateScore,
} from '../src/recognition/hmm-model.js';
import { getNetwork } from '../src/recognition/hmm-network.js';
import { hmmFeatures } from '../src/recognition/hmm-features.js';
import { alignWords } from '../src/recognition/hmm-decode.js';

const model = getHmmModel();
const network = getNetwork(model, ['en'], {});
const word = (s) => {
  const tokens = s.split(' ').map((symbol) => ({ symbol, kind: 'x' }));
  return { word: s, tokens, units: tokens.map((t) => t.symbol) };
};
const tier = process.argv[2] ?? 'telephone';
const out = synthesize('Hello world.', {
  tier: tier === 'default' ? undefined : tier,
  lang: 'en',
  seed: 1,
});
const rate = Math.min(out.sampleRate, 8000);
const input =
  rate < out.sampleRate
    ? resample(out.samples, out.sampleRate, rate)
    : out.samples;
const { feats, frames, tone } = hmmFeatures(input, rate, model.lda);
for (const reading of [
  ['h ə l o ʊ', 'w ɝ l d'],
  ['h ɚ', 'n o ʊ', 'w ɝ l d'],
]) {
  const words = reading.map(word);
  const aligned = alignWords(network, feats, frames, words, { tone });
  const parts = aligned.map((a) => {
    const w = words[a.word];
    const k = w.tokens.indexOf(a.token);
    const left = k ? w.tokens[k - 1].symbol : null;
    const right = k + 1 < w.tokens.length ? w.tokens[k + 1].symbol : null;
    let sum = 0;
    for (let t = a.from; t < a.to; t++) {
      let best = -Infinity;
      for (let s = 0; s < 3; s++) {
        best = Math.max(
          best,
          stateScore(
            stateIndex(model, a.token.symbol, s, left, right),
            feats,
            t * model.dims,
            model
          )
        );
      }
      sum += best;
    }
    return `${a.token.symbol}[${a.from}-${a.to}] ${sum.toFixed(1)}`;
  });
  console.log(reading.join(' | '), '\n  ', parts.join('  '));
}
// Every unit's best state score on the frames of the l/n region.
const from = Number(process.argv[3] ?? 17);
const to = Number(process.argv[4] ?? 24);
const rows = model.units
  .map((u) => {
    let sum = 0;
    for (let t = from; t < to; t++) {
      let best = -Infinity;
      for (let s = 0; s < 3; s++) {
        best = Math.max(
          best,
          stateScore(
            model.ciIndex.get(`${u}#${s}`),
            feats,
            t * model.dims,
            model
          )
        );
      }
      sum += best;
    }
    return [u, sum];
  })
  .sort((a, b) => b[1] - a[1]);
console.log(
  `frames ${from}-${to}, top context-independent units:`,
  rows
    .slice(0, 12)
    .map(([u, s]) => `${u} ${s.toFixed(1)}`)
    .join(', ')
);
