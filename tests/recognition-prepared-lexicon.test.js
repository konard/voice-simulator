/** Generated recognition tables preserve the source trie. Unlicense. */
import { expect, it } from 'test-anywhere';
import { parseIpa } from '../src/ipa/parse.js';
import { exactCandidates } from '../src/recognition/candidates.js';
import { addPronunciation, trieNode } from '../src/recognition/lexicon.js';
import {
  getCounts,
  openWordTransitions,
  packWordTransitions,
} from '../src/recognition/data/index.js';
import {
  openHmmArchive,
  packHmmArchive,
} from '../src/recognition/hmm-archive.js';
import {
  countPronunciations,
  phoneProbability,
} from '../src/recognition/language-model.js';
import {
  openPackedLanguageModel,
  packLanguageModel,
} from '../src/recognition/node-models.js';
import {
  openPreparedLexicon,
  serializeLexicon,
} from '../src/recognition/prepared-lexicon.js';
import { withWordSearch } from '../src/recognition/word-search.js';
import { phoneDistance } from '../src/recognition/phone-distance.js';

it('opens all prepared HMM columns in the archive buffer', () => {
  const network = {
    nodes: { first: Uint32Array.of(3, 7), score: Float64Array.of(-2.51) },
    tree: { root: [1] },
    emit: Uint16Array.of(27, 31),
    wordId: Uint32Array.of(0, 1),
    nextWord: Uint32Array.of(0, 3),
    words: { flags: Uint8Array.of(2), symbols: [{ symbol: 'ʃ' }] },
  };
  const encode = (value) =>
    new globalThis.TextEncoder().encode(JSON.stringify(value));
  const decode = (bytes) =>
    JSON.parse(new globalThis.TextDecoder().decode(bytes));
  const archive = packHmmArchive(network, 3, encode);
  const opened = openHmmArchive(archive, 3, decode);
  expect(opened).toEqual(network);
  for (const column of [
    ...Object.values(opened.nodes),
    opened.emit,
    opened.wordId,
    opened.nextWord,
    opened.words.flags,
  ]) {
    expect(column.buffer === archive.buffer).toBe(true);
  }
  expect(openHmmArchive(archive, 2, decode)).toBeUndefined();
  expect(() => openHmmArchive(archive.subarray(0, -1), 3, decode)).toThrow(
    RangeError
  );
});

it('opens the same discounted transition costs from packed word counts', () => {
  const language = 'en';
  const { words, transitionRow, transitionCost } = getCounts(language);
  const [offsets, pairs] = packWordTransitions(language);
  const read = openWordTransitions(
    words,
    Uint32Array.from(offsets),
    Uint32Array.from(pairs)
  );
  for (const { word } of words.slice(0, 128)) {
    const actual = read(word);
    for (const [previous, cost] of actual ?? []) {
      expect(read(word, previous)).toBe(cost);
      expect(transitionCost(word, previous)).toBe(cost);
    }
    expect(actual).toEqual(transitionRow(word));
    expect(read(word, 'mangosteenish')).toBeUndefined();
  }
  expect(read('mangosteenish')).toBeUndefined();
});

it('preserves language scores for known and missing phones in generated count tables', () => {
  const reference = countPronunciations([
    { symbols: ['a', 'b', 'a'], count: 2 },
    { symbols: ['a', 'b', 'kʰ'], count: 15 },
    { symbols: ['kʰ', 'b'], count: 3 },
  ]);
  const packed = openPackedLanguageModel(
    JSON.parse(JSON.stringify(packLanguageModel(reference)))
  );
  const phones = ['#', 'a', 'b', 'kʰ', 'ɹ'];
  for (const a of phones) {
    for (const b of phones) {
      for (const c of phones) {
        expect(phoneProbability(packed, a, b, c)).toBe(
          phoneProbability(reference, a, b, c)
        );
      }
    }
  }
});

it('reads stressed pronunciations, homophones and Mandarin tones from a prepared trie', () => {
  const cases = [
    [
      'en',
      [
        ['record', 'ɹɪˈkɔːd'],
        ['record', 'ˈɹɛkɔːd'],
        ['read', 'ɹɛd'],
        ['red', 'ɹɛd'],
      ],
    ],
    [
      'zh',
      [
        ['宜', 'i˧˥'],
        ['你', 'ni˨˩˦'],
        ['尼', 'ni˧˥'],
      ],
    ],
  ];
  for (const [language, pronunciations] of cases) {
    const root = trieNode();
    const counts = new Map();
    for (const [word, ipa] of pronunciations) {
      const count = counts.get(word) ?? counts.size + 1;
      counts.set(word, count);
      addPronunciation(root, { word, count, ipa }, language);
    }
    const words = [...counts].map(([word, count]) => ({ word, count }));
    const lexicon = { root, words };
    const rows = serializeLexicon(lexicon, language);
    const prepared = openPreparedLexicon(rows, language, words);
    for (const [, ipa] of pronunciations) {
      const { tokens } = parseIpa(ipa);
      const exact = (trie) =>
        exactCandidates(tokens, 0, tokens.length, trie, language);
      expect(exact(prepared)).toEqual(exact(lexicon));
      const near = (trie) =>
        withWordSearch(
          trie,
          tokens,
          language,
          phoneDistance,
          null,
          (search) => {
            const { hits, entriesAt } = search(0, tokens.length, 8);
            return {
              hits,
              group: hits.filter((_, i) => i % 3 === 1).map(entriesAt),
            };
          }
        );
      expect(near({ root: prepared.root, prepared })).toEqual(near(lexicon));
    }
  }
});
