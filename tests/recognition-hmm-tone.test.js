/** Tone stream of the Gaussian HMM recogniser (issue 75). */
import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import { synthesize } from '../src/index.js';
import { decodeWords } from '../src/recognition/hmm-decode.js';
import { hmmFeatures } from '../src/recognition/hmm-features.js';
import { getHmmModel, stateScore } from '../src/recognition/hmm-model.js';
import { getNetwork } from '../src/recognition/hmm-network.js';
import {
  HMM_TONE_DIMS,
  hmmToneFeatures,
  toneKey,
  unpackHmmTone,
} from '../src/recognition/hmm-tone.js';

const at = (f, t, d) => f[t * HMM_TONE_DIMS + d];

it('measures height, slopes and curvature of the pitch', () => {
  const n = 80;
  const voicing = new Float64Array(n).fill(1);
  const level = hmmToneFeatures(new Float64Array(n).fill(0.25), voicing);
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map((d) => at(level, 40, d)),
    [1, 0, 0, 0, 0, 1]
  );
  // A rise of 1/40 octave per frame: slopes 40 · 1/40 = 1 per frame unit.
  const rise = hmmToneFeatures(
    Float64Array.from({ length: n }, (_, t) => t / 40),
    voicing
  );
  assert.ok(Math.abs(at(rise, 40, 1) - 1) < 1e-6);
  assert.ok(Math.abs(at(rise, 40, 2) - 1) < 1e-6);
  assert.ok(Math.abs(at(rise, 40, 3)) < 1e-6);
  // A parabola y = t²/400 around frame 40 has curvature 1/400 → 1.
  const bend = hmmToneFeatures(
    Float64Array.from({ length: n }, (_, t) => (t - 40) ** 2 / 400),
    voicing
  );
  assert.ok(Math.abs(at(bend, 40, 3) - 1) < 1e-5);
  assert.ok(Math.abs(at(bend, 40, 2)) < 1e-6);
});

it('keys the tone mixtures by tone class and state', () => {
  assert.equal(toneKey('o@2', 1), '2#1');
  assert.equal(toneKey('o', 1), '0');
  assert.equal(toneKey('sil', 0), '0');
});

it('maps every state of the shipped model to a tone mixture', () => {
  const model = getHmmModel();
  const { tone } = model;
  assert.equal(tone.dims, HMM_TONE_DIMS);
  assert.equal(tone.ofState.length, model.states);
  const keyOf = (m) => tone.keys[tone.ofState[m]];
  const ci = (unit, s) => model.ciIndex.get(`${unit}#${s}`);
  assert.equal(keyOf(ci('o@2', 0)), '2#0');
  assert.equal(keyOf(ci('a@4', 2)), '4#2');
  assert.equal(keyOf(ci('k', 1)), '0');
  const context = [...model.contextIndex].find(([key]) =>
    key.startsWith('a@1#2')
  );
  assert.equal(keyOf(context[1]), '1#2');
  // Tone classes share a normaliser per state; the toneless mixture has none.
  tone.keys.forEach((key, k) =>
    assert.equal(tone.stateOfKey[k], key === '0' ? -1 : Number(key.at(-1)))
  );
});

it('adds nothing to words without a tone', () => {
  const model = getHmmModel();
  const spoken = synthesize('hello', { lang: 'en', tier: 'telephone' });
  const { feats, frames, tone } = hmmFeatures(
    spoken.samples,
    spoken.sampleRate,
    model.lda
  );
  const network = getNetwork(model, ['en'], { maxWords: 200 });
  const plain = decodeWords(network, feats, frames, { toneWeight: 0 });
  const toned = decodeWords(network, feats, frames, { tone, toneWeight: 4 });
  assert.deepEqual(
    toned.words.map((w) => w.word),
    plain.words.map((w) => w.word)
  );
  assert.equal(toned.score, plain.score);
});

it('resets reused search buffers between recordings and networks', () => {
  const model = getHmmModel();
  const spoken = synthesize('hello', { lang: 'en', tier: 'telephone' });
  const { feats, frames, tone } = hmmFeatures(
    spoken.samples,
    spoken.sampleRate,
    model.lda
  );
  const open = getNetwork(model, ['en'], { maxWords: 200 });
  const closed = getNetwork(model, ['en'], { maxWords: 200, oov: false });
  const cache = new Map();
  const expected = decodeWords(open, feats, frames, { tone });

  decodeWords(open, feats, Math.floor(frames / 2), { maxActive: 16 }, cache);
  assert.deepEqual(decodeWords(open, feats, frames, { tone }, cache), expected);
  decodeWords(closed, feats, frames, { tone }, cache);
  assert.deepEqual([...cache.keys()], [closed]);
  assert.deepEqual(decodeWords(open, feats, frames, { tone }, cache), expected);
});

it('scores a tone mixture as a Gaussian mixture', () => {
  const data = {
    dims: 1,
    keys: ['0'],
    components: [
      [0, Math.log(0.5), 0, 1],
      [0, Math.log(0.5), 2, 4],
    ],
  };
  const tone = unpackHmmTone(data, [], new Map());
  const x = Float32Array.of(1);
  const gauss = (mu, v) =>
    Math.exp(-((1 - mu) ** 2) / (2 * v)) / Math.sqrt(2 * Math.PI * v);
  const expected = Math.log(0.5 * gauss(0, 1) + 0.5 * gauss(2, 4));
  assert.ok(Math.abs(stateScore(0, x, 0, tone) - expected) < 1e-6);
});
