/** Generated recognition tables preserve the source trie. Unlicense. */
import { expect, it } from 'test-anywhere';
import { parseIpa } from '../src/ipa/parse.js';
import { exactCandidates } from '../src/recognition/candidates.js';
import { addPronunciation, trieNode } from '../src/recognition/lexicon.js';
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
    const rows = JSON.parse(
      JSON.stringify(serializeLexicon(lexicon, language))
    );
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
