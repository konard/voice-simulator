import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import { addLexicon, clearLexicons, recognize } from '../src/index.js';
import {
  hmmBoundaryTime,
  hmmFrameTime,
} from '../src/recognition/hmm-features.js';
import { getHmmModel } from '../src/recognition/hmm-model.js';
import { getNetwork } from '../src/recognition/hmm-network.js';
import { hmmAudioToIpa } from '../src/recognition/hmm-stage.js';

const RATE = 8000;

it('accepts the word and phone decoders only', () => {
  assert.throws(
    () => recognize(new Float32Array(RATE), RATE, { decoder: 'frames' }),
    RangeError
  );
});

it('puts frame boundaries halfway between frame centres', () => {
  const halfway = (hmmFrameTime(4) + hmmFrameTime(5)) / 2;
  assert.ok(Math.abs(hmmBoundaryTime(5) - halfway) < 1e-12);
});

it('decodes no words from silence', () => {
  const decoded = hmmAudioToIpa(new Float32Array(RATE), RATE, {
    languages: ['en'],
  });
  assert.deepEqual(decoded.words, []);
  assert.equal(decoded.ipa, '');
});

it('adds the words of addLexicon() to the decoding network', () => {
  const model = getHmmModel();
  const has = () =>
    getNetwork(model, ['en'], { maxWords: 200 }).words.some(
      (w) => w.word === 'zorbex'
    );
  assert.equal(has(), false);
  addLexicon('en', { zorbex: 'ˈzɔɹbɛks' });
  try {
    const entry = getNetwork(model, ['en'], { maxWords: 200 }).words.find(
      (w) => w.word === 'zorbex'
    );
    assert.deepEqual(entry.units, ['z', 'ɔ', 'ɹ', 'b', 'ɛ', 'k', 's']);
    assert.ok(entry.count > 1);
  } finally {
    clearLexicons();
  }
  assert.equal(has(), false);
});
