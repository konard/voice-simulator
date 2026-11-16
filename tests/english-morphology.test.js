/**
 * English morphology: words built from known words, and the build step
 * that leaves such words out of the shipped lexicon.
 */

import { describe, it, expect } from 'test-anywhere';
import { deriveEnglish } from '../src/g2p/english-morphology.js';
import { englishWordToIpa } from '../src/g2p/english.js';
import { lexiconFor } from '../src/g2p/lexicon.js';
import { selectEnglish } from '../scripts/build-lexicon.mjs';

const KNOWN = new Map([
  ['atrocity', 'əˈtɹɑsəti'],
  ['condition', 'kənˈdɪʃən'],
  ['congress', 'ˈkɑŋɡɹəs'],
  ['woman', 'ˈwʊmən'],
  ['stop', 'ˈstɑp'],
  ['intrigue', 'ɪnˈtɹiɡ'],
  ['happy', 'ˈhæpi'],
  ['lodge', 'ˈlɑd͡ʒ'],
  ['stealth', 'ˈstɛlθ'],
  ['want', 'ˈwɑnt'],
]);
const lookup = (word) => KNOWN.get(word) ?? null;

describe('english morphology', () => {
  it('derives words from known words', () => {
    const expected = {
      atrocities: 'əˈtɹɑsətiz',
      conditioners: 'kənˈdɪʃənɚz',
      congresswoman: 'ˈkɑŋɡɹəsˌwʊmən',
      stopped: 'ˈstɑpt',
      wanted: 'ˈwɑntɪd',
      intriguing: 'ɪnˈtɹiɡɪŋ',
      unhappiness: 'ʌnˈhæpinəs',
      dislodged: 'dɪsˈlɑd͡ʒd',
      stealthily: 'ˈstɛlθili',
      "woman's": 'ˈwʊmənz',
    };
    for (const [word, ipa] of Object.entries(expected)) {
      expect(`${word} ${deriveEnglish(word, lookup)}`).toBe(`${word} ${ipa}`);
    }
    for (const word of ['xyzzy', "woman'd", 'st', 'happyxx']) {
      expect(deriveEnglish(word, lookup)).toBe(null);
    }
  });

  it('reads words outside the lexicon with morphology', () => {
    for (const word of ['conditioners', 'congresswoman', 'childhood']) {
      expect(lexiconFor('en').has(word)).toBe(false);
      expect(englishWordToIpa(word).source).toBe('morphology');
    }
    expect(englishWordToIpa('childhood').ipa).toBe('ˈt͡ʃaɪldˌhʊd');
  });

  it('leaves derived words out of the shipped lexicon', () => {
    const cmudict = new Map([
      ['want', ['ˈwɑnt']],
      ['wanted', ['ˈwɑntɪd']],
      ['wants', ['ˈwɑnts']],
      ['ox', ['ˈɑks']],
      ['oxen', ['ˈɑksən']],
      ['cat', ['ˈkæt']],
      ['cats', ['ˈkæts']],
      ['read', ['ˈɹɛd', 'ˈɹid']],
      ['reads', ['ˈɹidz']],
    ]);
    const ranked = [...cmudict.keys()];
    const extra = new Map([['cat', ['ˈkæt']]]);
    const words = (limit, size) => [
      ...selectEnglish(ranked, cmudict, extra, limit, size).keys(),
    ];
    // `reads` is read from the default `ˈɹɛd` of `read`, so it is kept.
    expect(words(10)).toEqual(['cat', 'want', 'ox', 'oxen', 'read', 'reads']);
    expect(words(2)).toEqual(['cat', 'want', 'ox']);
    // Derived words with the shortest pronunciations fill up to `size`.
    expect(words(2, 4)).toEqual(['cat', 'want', 'ox', 'wants']);
  });
});
