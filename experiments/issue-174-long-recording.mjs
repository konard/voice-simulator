/** Compare complete word paths on a bounded series of telephone utterances. Unlicense. */
import assert from 'node:assert/strict';
import { RATE, streamInput } from '../scripts/lowest-rows.mjs';
import {
  HMM_DECODE_DEFAULTS,
  HMM_LOW_BATCH_SEARCH,
  decodeWords,
} from '../src/recognition/hmm-decode.js';
import { hmmFeatures } from '../src/recognition/hmm-features.js';
import { getHmmModel } from '../src/recognition/hmm-model.js';
import { getNetwork } from '../src/recognition/hmm-network.js';

const seconds = Number(process.argv[2] ?? 60);
if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 60) {
  throw new RangeError('Select up to 60 seconds of audio');
}
const audio = streamInput(seconds);
const model = getHmmModel();
const network = getNetwork(model, ['en']);
const { feats, frames, tone } = hmmFeatures(audio, RATE, model.lda);
for (const [name, search] of [
  ['low', HMM_LOW_BATCH_SEARCH],
  ['narrow', { beam: 60, languageBeam: 150, maxActive: 340 }],
  ['default', HMM_DECODE_DEFAULTS],
]) {
  let lastCandidate = 0;
  const decoded = decodeWords(network, feats, frames, {
    ...search,
    tone,
    onWordEnd(id, score, start, end) {
      if (Number.isFinite(score)) {
        lastCandidate = end;
      }
    },
  });
  const lastWord = decoded.words.at(-1)?.end;
  console.log(
    JSON.stringify({
      name,
      frames,
      lastCandidate,
      lastWord,
      words: decoded.words.length,
    })
  );
  if (name === 'low' && seconds === 60) {
    assert.ok(lastWord > 5500, `the last word ended at frame ${lastWord}`);
  }
}
