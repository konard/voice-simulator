/**
 * English heteronyms: a word spelled one way and spoken two ways gets the
 * reading that fits the sentence.
 */

import { describe, it, expect } from 'test-anywhere';
import { parseIpa } from '../src/ipa/parse.js';
import { textToIpa } from '../src/g2p/index.js';
import { englishWordToIpa } from '../src/g2p/english.js';
import { ENGLISH_HETERONYMS } from '../src/g2p/english-heteronyms.js';
import { chooseReading } from '../src/g2p/english-context.js';

const ipa = (text) => textToIpa(text, { lang: 'en' }).ipa;

/** [sentence, expected IPA fragment] */
const SENTENCES = [
  ['I will read the book.', 'ˈɹid'],
  ['I read the book yesterday.', 'ˈɹɛd'],
  ['She read the letter.', 'ˈɹɛd'],
  ['I have read it.', 'ˈɹɛd'],
  ['Did you record the record?', 'ɹəˈkɔɹd ðə ˈɹɛkɚd'],
  ['I live here.', 'ˈlɪv'],
  ['A live show.', 'ˈlaɪv'],
  ['The wind blows.', 'ˈwɪnd'],
  ['Wind the clock.', 'ˈwaɪnd'],
  ['I use it.', 'ˈjuz'],
  ['It is of no use.', 'ˈjus'],
  ['Close the door.', 'ˈkloʊz'],
  ['Stay close to me.', 'ˈkloʊs'],
  ['They present the plan.', 'pɹɪˈzɛnt'],
  ['A present for you.', 'ˈpɹɛzənt'],
  ['He dove in.', 'ˈdoʊv'],
  ['The dove flew.', 'ˈdʌv'],
  ['A bass swam by.', 'ˈbæs'],
  ['The bass guitar.', 'ˈbeɪs'],
  ['A lead pipe.', 'ˈlɛd'],
  ['They lead the team.', 'ˈlid'],
  ['He records songs.', 'ɹəˈkɔɹdz'],
  ['The records are old.', 'ˈɹɛkɚdz'],
];

describe('English heteronyms', () => {
  it('has at least 60 words with two different readings', () => {
    const words = Object.entries(ENGLISH_HETERONYMS).filter(
      ([, readings]) =>
        readings.length >= 2 &&
        new Set(readings.map((reading) => reading.ipa)).size >= 2
    );
    expect(words.length >= 60).toBe(true);
  });

  it('every reading parses', () => {
    for (const [word, readings] of Object.entries(ENGLISH_HETERONYMS)) {
      for (const reading of readings) {
        const { tokens, unknown } = parseIpa(reading.ipa);
        expect([word, unknown]).toEqual([word, []]);
        expect(tokens.length > 0).toBe(true);
      }
    }
  });

  it('chooses by the word before', () => {
    for (const [text, expected] of SENTENCES) {
      const result = ipa(text);
      expect([text, result.includes(expected)]).toEqual([text, true]);
    }
  });

  it('keeps the context inside the sentence', () => {
    // `arrow` selects ˈboʊ only in its own sentence.
    expect(ipa('Take a bow. A bow and arrow.')).toBe(
      'ˈteɪk ə ˈbaʊ . ə ˈboʊ ənd ˈæɹoʊ .'
    );
  });

  it('reports the heteronym source and tag', () => {
    const record = textToIpa('Did you record the record?', { lang: 'en' })
      .words.filter((word) => word.text === 'record')
      .map(({ ipa: reading, source, tag }) => [reading, source, tag]);
    expect(record).toEqual([
      ['ɹəˈkɔɹd', 'heteronym', 'V'],
      ['ˈɹɛkɚd', 'heteronym', 'N'],
    ]);
  });

  it('falls back to the first reading without context', () => {
    expect(englishWordToIpa('record').ipa).toBe('ˈɹɛkɚd');
    expect(chooseReading(ENGLISH_HETERONYMS.use, {}).ipa).toBe('ˈjuz');
    expect(englishWordToIpa('constructor').source).not.toBe('heteronym');
  });
});
