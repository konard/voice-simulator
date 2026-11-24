/**
 * Candidate recall of word spotting: for each reference word, decode its
 * span (from the synthesis timeline, with a margin) with the word decoder
 * and rank the reference word among the word ends near the span's end.
 * node experiments/issue-75-hmm-spot-recall.mjs [tier] [lang] [from] [to] [preset]
 * Environment: MARGIN (frames, 5), LMW (2), BEAM (120). Unlicense.
 */
import { synthesize } from '../src/index.js';
import { hmmFeatures } from '../src/recognition/hmm-features.js';
import { getHmmModel } from '../src/recognition/hmm-model.js';
import { getNetwork } from '../src/recognition/hmm-network.js';
import { decodeWords } from '../src/recognition/hmm-decode.js';
import { sentences } from '../tests/helpers/roundtrip.js';

const [
  tier = 'telephone',
  lang = 'en',
  from = '0',
  to = '20',
  preset = 'male',
] = process.argv.slice(2);
const margin = Number(process.env.MARGIN ?? 5);
const lmw = Number(process.env.LMW ?? 2);
const model = getHmmModel();
const network = getNetwork(model, [lang]);
const frameOf = (time) => Math.round((time * 8000 - 60) / 80);

/** Best relative score per word over ends near `end` from starts near `start`. */
export function spot(feats, dims, a, b) {
  const lo = Math.max(0, a - margin);
  const hi = b + margin;
  const sub = feats.subarray(lo * dims, hi * dims);
  const best = new Map();
  decodeWords(network, sub, Math.min(hi, feats.length / dims) - lo, {
    lmw,
    beam: Number(process.env.BEAM ?? 120),
    maxActive: 20000,
    onWordEnd(id, score, start, end) {
      if (
        Math.abs(start - (a - lo)) <= margin &&
        Math.abs(end - (b - lo)) <= margin
      ) {
        const word = network.words[id].word;
        if (!best.has(word) || best.get(word) < score) {
          best.set(word, score);
        }
      }
    },
  });
  return [...best].sort((x, y) => y[1] - x[1]);
}

const ranks = [];
for (let i = Number(from); i < Number(to); i++) {
  const text = sentences[lang][i];
  const spoken = synthesize(text, {
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
  const dims = feats.length / frames;
  const line = [];
  for (const w of spoken.timeline.words) {
    const ranked = spot(feats, dims, frameOf(w.start), frameOf(w.end));
    const key = w.text.toLowerCase();
    const rank = ranked.findIndex(([word]) => word === key);
    ranks.push(rank);
    line.push(
      `${key}:${rank}${
        rank
          ? `(${ranked
              .slice(0, 3)
              .map(([x]) => x)
              .join('/')})`
          : ''
      }`
    );
  }
  console.log(i, line.join(' '));
}
const within = (k) =>
  ranks.filter((r) => r >= 0 && r < k).length / ranks.length;
console.log(
  `${lang} ${tier} ${preset} words ${ranks.length} top1 ${within(1).toFixed(2)} top5 ${within(5).toFixed(2)} top20 ${within(20).toFixed(2)} top100 ${within(100).toFixed(2)} missing ${ranks.filter((r) => r < 0).length}`
);
