// Issue 181: acoustic (forced alignment) and language-model scores of
// competing readings of the synthesised "Hello world.". Unlicense.
import { synthesize } from '../src/index.js';
import { resample } from '../src/audio/resample.js';
import { getHmmModel } from '../src/recognition/hmm-model.js';
import { getNetwork } from '../src/recognition/hmm-network.js';
import { hmmFeatures } from '../src/recognition/hmm-features.js';
import {
  alignWords,
  decodeWords,
  HMM_DECODE_DEFAULTS,
} from '../src/recognition/hmm-decode.js';
import { getLexicon } from '../src/recognition/lexicon.js';

const model = getHmmModel();
const network = getNetwork(model, ['en'], {});
const lex = getLexicon('en');
const lnP = (cost) => -(cost - 0.5) / 0.3;
function lmScore(seq) {
  const { lmw, wip, minCount } = HMM_DECODE_DEFAULTS;
  let total = 0;
  let prev = null;
  for (const word of seq) {
    const row = prev ? lex.transitionRow(word) : undefined;
    // The decoder's unigram: the spoken prior; BOOKS=1 for the book counts.
    const count = process.env.BOOKS
      ? (lex.counts.get(word) ?? 1)
      : (network.words.find((w) => w.word === word && !w.oov)?.count ?? 1);
    const cost = row?.has(prev)
      ? row.get(prev)
      : -0.3 * Math.log((0.4 * Math.max(count, minCount)) / lex.total) + 0.5;
    total += lmw * lnP(cost) + wip;
    prev = word;
  }
  return total;
}
const readings = (
  process.argv[3] ?? 'hello world|her no world|hollow world|to know world'
).split('|');
for (const tier of (process.argv[2] ?? 'telephone,wideband,default').split(
  ','
)) {
  const out = synthesize('Hello world.', {
    tier: tier === 'default' ? undefined : tier,
    lang: 'en',
  });
  const rate = Math.min(out.sampleRate, 8000);
  const input =
    rate < out.sampleRate
      ? resample(out.samples, out.sampleRate, rate)
      : out.samples;
  const { feats, frames, tone } = hmmFeatures(input, rate, model.lda);
  const decoded = decodeWords(network, feats, frames, { tone });
  console.log(
    `${tier}: decoded "${decoded.words.map((w) => w.word || '?').join(' ')}" score ${decoded.score.toFixed(1)}`
  );
  for (const reading of readings) {
    // Every pronunciation combination: keep the best acoustic one.
    const choices = reading
      .split(' ')
      .map((word) => network.words.filter((w) => w.word === word && !w.oov));
    let best = null;
    const walk = (i, picked) => {
      if (i === choices.length) {
        let acoustic = -Infinity;
        const aligned = alignWords(network, feats, frames, picked, {
          tone,
          onScore: (s) => {
            acoustic = s;
          },
        });
        if (!best || acoustic > best.acoustic) {
          best = { acoustic, picked, aligned };
        }
        return;
      }
      for (const w of choices[i]) {
        walk(i + 1, [...picked, w]);
      }
    };
    walk(0, []);
    if (!best) {
      console.log('  missing', reading);
      continue;
    }
    const lm = lmScore(reading.split(' '));
    console.log(
      `  ${reading.padEnd(16)} acoustic ${best.acoustic.toFixed(1)} lm ${lm.toFixed(1)} total ${(best.acoustic + lm).toFixed(1)}  [${best.picked.map((w) => w.tokens.map((t) => t.symbol).join('')).join(' ')}]`
    );
  }
}
