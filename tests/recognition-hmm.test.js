import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import {
  addLexicon,
  clearLexicons,
  recognize,
  synthesize,
} from '../src/index.js';
import {
  hmmBoundaryTime,
  hmmFeatures,
  hmmFrameTime,
  hmmPitchStatics,
} from '../src/recognition/hmm-features.js';
import {
  decodeWords,
  HMM_DECODE_DEFAULTS,
  languageThresholds,
} from '../src/recognition/hmm-decode.js';
import { getHmmModel } from '../src/recognition/hmm-model.js';
import {
  buildNetwork,
  firstToneClass,
  getNetwork,
  toneVariants,
} from '../src/recognition/hmm-network.js';
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

it('interpolates across a pitch more than an octave from the median', () => {
  // 100 Hz with a 3x jump, as a tracker gives on the noise of a fricative.
  const f0 = Float64Array.from({ length: 40 }, (_, i) =>
    i >= 18 && i < 22 ? 300 : 100
  );
  const pitch = {
    startTime: hmmFrameTime(0),
    hop: 0.01,
    count: f0.length,
    f0,
    voicing: new Float64Array(f0.length).fill(1),
  };
  const { lf0, voicing } = hmmPitchStatics(pitch, f0.length);
  assert.ok(lf0.every((v) => Math.abs(v) < 1e-12));
  assert.equal(voicing[20], 1);
});

it('decodes no words from silence', () => {
  const decoded = hmmAudioToIpa(new Float32Array(RATE), RATE, {
    languages: ['en'],
  });
  assert.deepEqual(decoded.words, []);
  assert.equal(decoded.ipa, '');
});

it('reuses the decoding graph when only one of its languages is requested', () => {
  const model = getHmmModel();
  const options = { maxWords: 40 };
  const multilingual = getNetwork(model, ['ru', 'en'], options);
  const english = getNetwork(model, ['en'], options);
  assert.deepEqual(english.languages, ['en']);
  assert.equal(english.trees.get('en'), multilingual.trees.get('en'));
  assert.equal(english.language, multilingual.language);
  const spoken = synthesize('one two', { lang: 'en', tier: 'telephone' });
  const { feats, frames } = hmmFeatures(spoken.samples, RATE, model.lda);
  const decoded = decodeWords(english, feats, frames);
  assert.equal(decoded.lang, 'en');
  assert.deepEqual(
    decoded,
    decodeWords(buildNetwork(model, ['en'], options), feats, frames)
  );
});

it('keeps separate graphs for alternating single-language recognition', () => {
  const model = getHmmModel();
  const options = { maxWords: 41 };
  const english = getNetwork(model, ['en'], options);
  const russian = getNetwork(model, ['ru'], options);

  assert.deepEqual([...russian.trees.keys()], ['ru']);
  assert.equal(getNetwork(model, ['en'], options).language, english.language);
  assert.equal(getNetwork(model, ['ru'], options).language, russian.language);
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
  assert.ok(closed.words.every((word) => !word.oov));
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

it('lets a rising sandhi variant go on only before the tone that causes it', () => {
  const syllable = (symbol, tone) => [
    { symbol: 'x', kind: 'consonant' },
    { symbol, kind: 'vowel', tone },
  ];
  const third = toneVariants('火', syllable('wo', [2, 1, 4]));
  assert.deepEqual(
    third.map((v) => [v.tokens[1].tone, v.before]),
    [
      [[2, 1, 4], undefined],
      [[3, 5], 3],
    ]
  );
  const bu = toneVariants('不', syllable('u', [5, 1]));
  assert.deepEqual(
    bu.map((v) => v.before),
    [undefined, 4]
  );
  const zh = getNetwork(getHmmModel(), ['zh'], { maxWords: 300 });
  const tree = zh.trees.get('zh');
  const variants = zh.words.filter((w) => w.lang === 'zh' && w.before);
  assert.ok(variants.some((w) => w.before === 3));
  // The tree after a variant holds the words of that first tone only.
  for (const [before, roots] of tree.after) {
    const ids = [];
    const walk = (node) => {
      for (let i = zh.firstWord[node]; i < zh.firstWord[node + 1]; i++) {
        ids.push(zh.endings[i]);
      }
      for (let i = zh.firstChild[node]; i < zh.firstChild[node + 1]; i++) {
        walk(zh.children[i]);
      }
    };
    roots.forEach(walk);
    assert.ok(ids.length > 0);
    for (const id of ids) {
      assert.equal(firstToneClass(zh.words[id].tokens), before);
    }
  }
});

it('prunes each language against its own best token (issue 75)', () => {
  // English trails Mandarin by 200 at this frame, more than the beam of
  // 120: one beam over all languages would drop every English token.
  const frame = (en, maxActive) => {
    const thresholds = new Float64Array(2);
    languageThresholds(
      [0, 0, 1, 0, 0],
      {
        work: [0, 1, 2, 3, 4],
        nodeScores: [en, en - 50, -300, en - 50, en - 140],
        languageBest: [en, -300],
        buckets: [[], []],
        thresholds,
      },
      -300,
      { ...HMM_DECODE_DEFAULTS, maxActive }
    );
    return Array.from(thresholds);
  };
  assert.deepEqual(frame(-500, 6000), [-620, -420]);
  assert.deepEqual(frame(-800, 6000), [-700, -420]);
  assert.deepEqual(frame(-500, 1), [-500, -420]);
  assert.deepEqual(frame(-500, 2), [-550, -420]);
});

it('keeps ties at the histogram pruning threshold', () => {
  const scores = [-60, -7, -5, -3, -5, -1, -2, -80];
  const thresholds = new Float64Array(1);
  languageThresholds(
    new Uint8Array(scores.length),
    {
      work: scores.map((_, index) => index),
      nodeScores: scores,
      languageBest: [-1],
      buckets: [[]],
      thresholds,
    },
    -1,
    { ...HMM_DECODE_DEFAULTS, beam: 10, maxActive: 4 }
  );
  assert.equal(thresholds[0], -5);
});
