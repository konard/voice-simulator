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
  HMM_DECODE_DEFAULTS,
  alignWords,
  createThresholds,
  decodeWords,
} from '../src/recognition/hmm-decode.js';
import { getHmmModel, stateIndex } from '../src/recognition/hmm-model.js';
import { ipaToText } from '../src/recognition/ipa-to-text.js';
import {
  HMM_LIVE_WORDS,
  buildNetwork,
  firstToneClass,
  getNetwork,
  packHmmNetwork,
  toneVariants,
} from '../src/recognition/hmm-network.js';
import { recognitionSettings } from '../src/recognition/recognizer.js';
import {
  hmmAudioToIpa,
  stressOutOfVocabulary,
} from '../src/recognition/hmm-stage.js';

const RATE = 8000;

it('keeps batch frames private across a nested recognition callback', () => {
  const options = { level: 'low', languages: ['en'], engine: 'js' };
  const short = synthesize('Hello world.', {
    lang: 'en',
    tier: 'telephone',
    engine: 'js',
    seed: 1,
  });
  const longer = synthesize('The train leaves at seven.', {
    lang: 'en',
    tier: 'wideband',
    engine: 'js',
    seed: 1,
  });
  const expected = recognize(short.samples, short.sampleRate, options);
  const otherOptions = { ...options, level: 'medium' };
  const other = recognize(longer.samples, longer.sampleRate, otherOptions);
  let nested;
  const heard = recognize(short.samples, short.sampleRate, {
    ...options,
    profile(stage) {
      if (stage === 'Audio to IPA') {
        nested = recognize(longer.samples, longer.sampleRate, otherOptions);
      }
    },
  });
  assert.deepEqual(heard, expected);
  assert.deepEqual(nested, other);
});

it('packs the same live vocabulary and transitions as the source builder', () => {
  const source = buildNetwork(getHmmModel(), ['en'], {
    maxWords: HMM_LIVE_WORDS,
  });
  const packed = packHmmNetwork('en', HMM_LIVE_WORDS);
  assert.equal(packed.words.flags.length, source.words.length);
  assert.deepEqual(packed.tree.root, source.trees.get('en').root);
  assert.deepEqual(packed.emit, source.emit.subarray(0, source.stateCount));
  assert.deepEqual(packed.wordId, source.wordId.subarray(0, source.wordLinks));
  for (const [name, values] of Object.entries(packed.nodes)) {
    assert.deepEqual(values, source.nodes[name].subarray(0, source.nodeCount));
  }
});

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

it('aligns phones across an optional release and leading and trailing silence', () => {
  const units = ['sil', 'p', 'p_r', 'a'];
  const ciIndex = new Map();
  for (const [i, unit] of units.entries()) {
    for (let state = 0; state < 3; state++) {
      ciIndex.set(`${unit}#${state}`, 3 * i + state);
    }
  }
  const model = {
    ciIndex,
    contextIndex: new Map(),
    dims: 1,
    states: 12,
    first: Uint32Array.from({ length: 13 }, (_, i) => i),
    mu: Float32Array.from({ length: 12 }, (_, i) => i),
    inv: new Float32Array(12).fill(100),
    norm: new Float64Array(12),
    stay: new Float64Array(12),
    go: new Float64Array(12),
  };
  const words = [
    { units: ['p', 'a'], tokens: [{ symbol: 'p' }, { symbol: 'a' }] },
  ];
  const features = Float32Array.of(3, 4, 5, 9, 10, 11);
  const network = { model };
  const shorter = features.subarray(0, 3);
  const expectedNested = alignWords(network, shorter, shorter.length, words);
  let nested;
  const aligned = alignWords(network, features, features.length, words, {
    onScore() {
      nested = alignWords(network, shorter, shorter.length, words);
    },
  });
  assert.deepEqual(nested, expectedNested);
  assert.deepEqual(
    alignWords(network, shorter, shorter.length, words),
    expectedNested
  );
  assert.deepEqual(
    aligned.map(({ token, from, to }) => [token.symbol, from, to]),
    [
      ['p', 0, 3],
      ['a', 3, 6],
    ]
  );
});

it('uses only the relevant neighbor for each HMM state', () => {
  const model = {
    ciIndex: new Map([
      ['a#0', 0],
      ['a#1', 1],
      ['a#2', 2],
      ['t_r#0', 3],
    ]),
    contextIndex: new Map([
      ['a#0<p:m', 4],
      ['a#0<cor', 5],
      ['a#2>p:s', 6],
      ['t_r#0<p:m', 7],
    ]),
  };
  assert.equal(stateIndex(model, 'a', 0, 'm', 's'), 4);
  assert.equal(stateIndex(model, 'a', 0, 'm', 'n'), 4);
  assert.equal(stateIndex(model, 'a', 0, 'n', 's'), 5);
  assert.equal(stateIndex(model, 'a', 1, 'm', 's'), 1);
  assert.equal(stateIndex(model, 'a', 2, 'm', 's'), 6);
  assert.equal(stateIndex(model, 'a', 2, 'n', 's'), 6);
  assert.equal(stateIndex(model, 'a', 2, 'n', null), 2);
  assert.equal(stateIndex(model, 't_r', 0, 'm', 's'), 3);
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

it('keeps HMM phones and tracks when word and syllable formatting are skipped', () => {
  const { samples } = synthesize('It is time.', {
    tier: 'telephone',
    lang: 'en',
    engine: 'js',
  });
  const options = { languages: ['en'] };
  const full = hmmAudioToIpa(samples, RATE, options);
  assert.ok(full.words.length && full.syllables.length);
  const phones = hmmAudioToIpa(samples, RATE, {
    ...options,
    includeWords: false,
    includeSyllables: false,
  });
  assert.deepEqual(phones, { ...full, words: [], syllables: [] });
});

it('uses the HMM language directly with the built-in text decoder', () => {
  const { samples } = synthesize('It is time.', {
    tier: 'telephone',
    lang: 'en',
    engine: 'js',
  });
  const options = { modes: false, level: 'low', segments: true };
  const reads = [];
  const expected = recognize(samples, RATE, {
    ...options,
    stages: {
      ipaToText(input, settings) {
        reads.push(settings.spans);
        return ipaToText(input, settings);
      },
    },
  });
  assert.ok(reads[0]?.length);
  const actual = recognize(samples, RATE, options);
  assert.deepEqual(actual, expected);
});

it('keeps decoder scratch separate across nested and repeated searches', () => {
  const model = getHmmModel();
  const network = getNetwork(model, ['en'], { maxWords: 200 });
  const audio = synthesize('It is time.', { tier: 'telephone', lang: 'en' });
  const { feats, frames } = hmmFeatures(audio.samples, RATE, model.lda);
  const run = (settings) => decodeWords(network, feats, frames, settings);
  const expected = run();
  let nested;
  const actual = run({
    onWordEnd() {
      nested ??= run();
    },
  });
  assert.deepEqual(nested, expected);
  assert.deepEqual(actual, expected);
  assert.deepEqual(run(), expected);
});

it('reuses the decoding graph when only one of its languages is requested', () => {
  const model = getHmmModel();
  const options = { maxWords: 40 };
  const multilingual = getNetwork(model, ['ru', 'en'], options);
  const english = getNetwork(model, ['en'], options);
  assert.deepEqual([...english.trees.keys()], ['en']);
  assert.equal(english.trees.get('en'), multilingual.trees.get('en'));
  assert.equal(english.nodes.language, multilingual.nodes.language);
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
  assert.notEqual(english.nodes.first, russian.nodes.first);
  assert.equal(
    getNetwork(model, ['en'], options).nodes.first,
    english.nodes.first
  );
  assert.equal(
    getNetwork(model, ['ru'], options).nodes.first,
    russian.nodes.first
  );
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
    assert.deepEqual(
      entry.tokens.map((token) => token.symbol),
      ['z', 'ɔ', 'ɹ', 'b', 'ɛ', 'k', 's']
    );
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
    const { nodes, wordId, nextWord } = zh;
    const walk = (node) => {
      for (let link = nodes.terminal[node]; link; link = nextWord[link]) {
        ids.push(wordId[link]);
      }
      for (let child = nodes.child[node]; child; child = nodes.sibling[child]) {
        walk(child);
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
  const nodes = Uint8Array.of(0, 0, 1);
  const frame = (en) => [en, en - 140, -300];
  const settings = { ...HMM_DECODE_DEFAULTS, beam: 120, languageBeam: 400 };
  const prune = (en, options = settings) =>
    createThresholds(nodes, 2, options)([0, 1, 2], frame(en), 3, -300);
  assert.deepEqual(prune(-500), Float64Array.of(-620, -420));
  // A language more than languageBeam behind the best goes.
  assert.equal(prune(-800)[0], -700);
  // maxActive keeps the best nodes of each language, not of all.
  assert.deepEqual(
    prune(-500, { ...settings, maxActive: 1 }),
    Float64Array.of(-500, -420)
  );
});

it('selects the histogram threshold with repeated scores and reused rows', () => {
  const count = 1200;
  const nodes = Uint8Array.from({ length: count }, (_, i) => i % 2);
  const work = Array.from({ length: count }, (_, i) => i);
  const maxActive = 83;
  const thresholds = createThresholds(nodes, 2, {
    beam: Infinity,
    languageBeam: Infinity,
    maxActive,
  });
  for (const length of [count, 250, 650]) {
    const scores = Float64Array.from(
      { length },
      (_, i) => ((i * 103) % 219) - 110
    );
    const expected = Float64Array.from([0, 1], (lang) =>
      scores
        .filter((_, i) => nodes[i] === lang)
        .sort()
        .at(-maxActive)
    );
    assert.deepEqual(thresholds(work, scores, length, 108), expected);
  }
});

it('keeps ties at the histogram pruning threshold', () => {
  const scores = [-60, -7, -5, -3, -5, -1, -2, -80];
  const nodes = new Uint8Array(scores.length);
  const thresholds = createThresholds(nodes, 1, {
    ...HMM_DECODE_DEFAULTS,
    beam: 10,
    maxActive: 4,
  });
  assert.equal(
    thresholds(
      scores.map((_, i) => i),
      scores,
      scores.length,
      -1
    )[0],
    -5
  );
});

it('leaves scores outside the beam out of the active-node histogram', () => {
  const scores = [-1, -2, -10, -12, -20, -25];
  const nodes = new Uint8Array(scores.length);
  const row = new Float64Array(2);
  const workspace = {
    rows: [row],
    sizes: new Uint32Array(1),
    totals: new Uint32Array(1),
    peaks: new Float64Array(1),
    thresholds: new Float64Array(1),
  };
  const thresholds = createThresholds(
    nodes,
    1,
    { ...HMM_DECODE_DEFAULTS, beam: 5, maxActive: 1 },
    workspace
  );
  const work = scores.map((_, i) => i);
  assert.equal(thresholds(work, scores, scores.length, -1)[0], -1);
  assert.ok(workspace.rows[0] === row);
});
