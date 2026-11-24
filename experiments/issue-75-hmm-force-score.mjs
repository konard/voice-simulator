/**
 * Acoustic score of the reference words against the decoded words: a
 * forced alignment of each sequence (no LM) shows whether an error is a
 * search error (reference scores higher) or a model error.
 * node experiments/issue-75-hmm-force-score.mjs [tier] [preset] [cases]
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
import { decodeWords } from '../src/recognition/hmm-decode.js';
import { sentences } from '../tests/helpers/roundtrip.js';

const [tier = 'telephone', preset = 'male', casesArg = 'en:17,ru:1,zh:1'] =
  process.argv.slice(2);
const model = getHmmModel();

function forcedScore(feats, frames, words) {
  const chain = [];
  const push = (unit, skippable, left = null, right = null) => {
    for (let s = 0; s < 3; s++) {
      const m = stateIndex(model, unit, s, left, right);
      chain.push({
        m,
        stay: model.stay[m],
        go: model.go[m],
        skip: skippable && s === 0,
      });
    }
  };
  push('sil', true);
  for (const w of words) {
    w.tokens.forEach((t, i) => {
      const left = i ? contextClass(w.tokens[i - 1].symbol) : null;
      const right =
        i + 1 < w.tokens.length ? contextClass(w.tokens[i + 1].symbol) : null;
      push(w.units[i], false, left, right);
      if (model.ciIndex.has(`${w.units[i]}_r#0`)) {
        push(`${w.units[i]}_r`, true, left, right);
      }
    });
    push('sil', true);
  }
  const N = chain.length;
  let prev = new Float64Array(N).fill(-Infinity);
  let cur = new Float64Array(N);
  for (let t = 0; t < frames; t++) {
    for (let n = 0; n < N; n++) {
      let s;
      if (t === 0) {
        s = n === 0 ? 0 : n === 3 ? 0 : -Infinity;
      } else {
        s = prev[n] + chain[n].stay;
        if (n > 0) {
          s = Math.max(s, prev[n - 1] + chain[n - 1].go);
        }
        if (n >= 4 && chain[n - 3].skip) {
          s = Math.max(s, prev[n - 4] + chain[n - 4].go);
        }
      }
      cur[n] =
        s > -Infinity
          ? s + stateScore(chain[n].m, feats, t * model.dims, model)
          : s;
    }
    [prev, cur] = [cur, prev];
  }
  return Math.max(prev[N - 1], prev[N - 4]);
}

for (const [lang, index] of casesArg.split(',').map((c) => c.split(':'))) {
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
  const network = getNetwork(model, [lang], {
    maxWords: Number(process.env.WORDS ?? 8000),
  });
  const d = decodeWords(network, feats, frames);
  const byWord = new Map();
  for (const w of network.words) {
    byWord.set(w.word, [...(byWord.get(w.word) ?? []), w]);
  }
  const bare = (ipa) => ipa.replace(/[ˈˌ]/gu, '');
  const refWords = spoken.timeline.words.map((w) => w.text ?? w.word);
  const ref = refWords.map((w, i) => {
    const all = byWord.get(String(w).toLowerCase()) ?? [];
    const planned = bare(spoken.timeline.words[i].ipa);
    return (
      all.find((v) => bare(v.tokens.map(tokenIpa).join('')) === planned) ??
      all[0]
    );
  });
  console.log(lang, index, text);
  console.log('  planned', spoken.timeline.words.map((w) => w.ipa).join(' '));
  console.log(
    '  hyp',
    d.words
      .map((w) => `${w.word}/${w.tokens.map(tokenIpa).join('')}`)
      .join(' '),
    forcedScore(feats, frames, d.words).toFixed(1)
  );
  if (ref.every(Boolean)) {
    console.log(
      '  ref',
      ref.map((w) => `${w.word}/${w.tokens.map(tokenIpa).join('')}`).join(' '),
      forcedScore(feats, frames, ref).toFixed(1)
    );
  } else {
    console.log(
      '  ref words missing from the network:',
      refWords.filter((w, i) => !ref[i])
    );
  }
}
