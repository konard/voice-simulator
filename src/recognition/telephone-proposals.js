/** Local word proposals for resynthesis of intact telephone WAVs. Unlicense. */
import { decodeWords } from './hmm-decode.js';
import { HMM_RATE, hmmFeatures } from './hmm-features.js';
import { getHmmModel } from './hmm-model.js';
import { getNetwork } from './hmm-network.js';

const MAX_ALTERNATIVES = 6;
const MAX_WORDS = 40;
const MAX_ENDINGS_PER_FRAME = 32;
const END_DRIFT = 13;
const START_DRIFT = 15;

function keepEnding(row, id, score, start, end) {
  const item = { id, score, start, end };
  if (row.length < MAX_ENDINGS_PER_FRAME) {
    row.push(item);
    return;
  }
  let weakest = 0;
  for (let i = 1; i < row.length; i++) {
    if (row[i].score < row[weakest].score) {
      weakest = i;
    }
  }
  if (score > row[weakest].score) {
    row[weakest] = item;
  }
}

function nearbyWords(path, network, endings) {
  const candidates = new Map();
  for (
    let frame = Math.max(0, path.end - END_DRIFT);
    frame <= Math.min(endings.length - 1, path.end + END_DRIFT);
    frame++
  ) {
    for (const { id, score, start } of endings[frame] ?? []) {
      const { word } = network.words[id];
      const drift = Math.abs(start - path.start);
      if (word && drift <= START_DRIFT) {
        const rank = score - 1.5 * (drift + Math.abs(frame - path.end));
        candidates.set(word, Math.max(candidates.get(word) ?? -Infinity, rank));
      }
    }
  }
  const alternatives = [...candidates]
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word);
  return {
    ...path,
    alternatives: [...new Set([path.word, ...alternatives])].slice(
      0,
      MAX_ALTERNATIVES
    ),
  };
}

export function proposeTelephoneWords(samples) {
  const model = getHmmModel();
  const network = getNetwork(model, ['en']);
  const { feats, frames } = hmmFeatures(samples, HMM_RATE, model.lda);
  const endings = Array(frames + 1);
  const { words } = decodeWords(network, feats, frames, {
    maxActive: 3500,
    onWordEnd(id, score, start, end) {
      if (end - start >= 3 && network.words[id].word) {
        keepEnding((endings[end] ??= []), id, score, start, end);
      }
    },
  });
  if (
    !words.length ||
    words.length > MAX_WORDS ||
    words.some(({ word, oov }) => !word || oov)
  ) {
    return [];
  }
  return words.map((path) => nearbyWords(path, network, endings));
}
