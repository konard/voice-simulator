import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import { addLexicon, clearLexicons, recognize } from '../src/index.js';
import {
  hmmBoundaryTime,
  hmmFrameTime,
} from '../src/recognition/hmm-features.js';
import { getHmmModel } from '../src/recognition/hmm-model.js';
import { getNetwork } from '../src/recognition/hmm-network.js';
import { recognitionSettings } from '../src/recognition/recognizer.js';
import {
  hmmAudioToIpa,
  stressOutOfVocabulary,
} from '../src/recognition/hmm-stage.js';

const RATE = 8000;

it('accepts the word and phone decoders only', () => {
  assert.throws(
    () => recognize(new Float32Array(RATE), RATE, { decoder: 'frames' }),
    RangeError
  );
});

it('passes oov to the word decoder, on unless false', () => {
  assert.equal(recognitionSettings({}).oov, true);
  assert.equal(recognitionSettings({ oov: false }).oov, false);
  assert.equal(recognitionSettings({ decoder: 'phones' }).decoder, 'phones');
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

it('adds a phone loop for words outside the vocabulary unless oov is off', () => {
  const model = getHmmModel();
  const loop = getNetwork(model, ['en'], { maxWords: 200 }).trees.get(
    'en'
  ).loop;
  assert.ok(loop.begin.length > 20);
  assert.equal(loop.next.length, loop.begin.length);
  // Every row of the phone bigram is a distribution over the phones.
  for (const row of loop.bigram.values()) {
    const total = [...row.values()].reduce((sum, ln) => sum + Math.exp(ln), 0);
    assert.ok(Math.abs(total - 1) < 1e-9);
  }
  const closed = getNetwork(model, ['en'], { maxWords: 200, oov: false });
  assert.equal(closed.trees.get('en').loop.begin.length, 0);
  assert.ok(closed.nodes.every((node) => !node.loop));
});

it('stresses the longest full vowel of a word outside the vocabulary', () => {
  const vowel = (symbol, from, to) => ({
    word: 0,
    from,
    to,
    token: { symbol, kind: 'vowel' },
  });
  const aligned = [
    vowel('ə', 0, 20),
    { word: 0, from: 20, to: 25, token: { symbol: 'k', kind: 'consonant' } },
    vowel('ɪ', 25, 30),
    vowel('æ', 30, 38),
  ];
  stressOutOfVocabulary([{ oov: true, lang: 'en' }], aligned);
  assert.deepEqual(
    aligned.map((a) => a.token.stress ?? 0),
    [0, 0, 0, 1]
  );
  // Russian marks no stress on a one-vowel word, Hindi on none.
  const one = [vowel('a', 0, 9)];
  stressOutOfVocabulary([{ oov: true, lang: 'ru' }], one);
  const hindi = [vowel('a', 0, 9), vowel('i', 9, 12)];
  stressOutOfVocabulary([{ oov: true, lang: 'hi' }], hindi);
  assert.equal(one[0].token.stress, undefined);
  assert.ok(hindi.every((a) => a.token.stress === undefined));
});
