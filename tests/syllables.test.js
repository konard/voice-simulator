/**
 * Syllabification of the IPA by maximal onset and sonority, with the
 * onsets each language allows.
 */

import { describe, it, expect } from 'test-anywhere';
import { textToIpa } from '../src/g2p/index.js';
import { parseIpa } from '../src/ipa/parse.js';
import {
  sonority,
  syllabifyIpa,
  syllabifyTokens,
} from '../src/ipa/syllables.js';

const syllables = (text, lang) =>
  syllabifyIpa(textToIpa(text, { lang }).ipa, { language: lang }).map((word) =>
    word.join('.')
  );

describe('sonority', () => {
  it('rises from stops to glides and vowels', () => {
    const [t, s, n, l, j, a] = parseIpa('tsnlja').tokens.filter(
      (token) => token.kind !== 'pause'
    );
    expect(sonority(t) < sonority(s)).toBe(true);
    expect(sonority(s) < sonority(n)).toBe(true);
    expect(sonority(n) < sonority(l)).toBe(true);
    expect(sonority(l) < sonority(j)).toBe(true);
    expect(sonority(j) < sonority(a)).toBe(true);
  });
});

describe('syllabifyIpa', () => {
  it('splits English by maximal onset with s-clusters', () => {
    expect(syllables('hello simulated extra', 'en')).toEqual([
      'hə.ˈloʊ',
      'ˈsɪ.mjə.ˌleɪ.ɾɪd',
      'ˈɛk.stɹə',
    ]);
  });

  it('keeps English diphthongs as one nucleus and splits vowel hiatus', () => {
    expect(syllables('window mountain serious', 'en')).toEqual([
      'ˈwɪn.doʊ',
      'ˈmaʊn.tən',
      'ˈsɪ.ɹi.əs',
    ]);
  });

  it('keeps one-syllable words whole', () => {
    expect(syllables('strength voice', 'en')).toEqual(['ˈstɹɛŋkθ', 'ˈvɔɪs']);
  });

  it('allows Russian obstruent clusters and starts a syllable at stress', () => {
    expect(syllables('звуковых привет сестра', 'ru')).toEqual([
      'ˈzvu.kə.vɨx',
      'prʲɪ.ˈvʲet',
      'sʲɪs.ˈtra',
    ]);
  });

  it('gives Hindi onsets one consonant plus a glide', () => {
    expect(syllables('नमस्ते बनती ध्वनि', 'hi')).toEqual([
      'nə.məs.t̪eː',
      'bən.t̪iː',
      'd̪ʱʋə.nɪ',
    ]);
  });

  it('writes Mandarin tones, after sandhi, at the end of the syllable', () => {
    expect(syllables('你好声音', 'zh')).toEqual([
      'ni˧˥',
      'xɑʊ˨˩',
      'ʂəŋ˥',
      'in˥',
    ]);
  });

  it('returns no syllables for an empty word', () => {
    expect(syllabifyTokens([])).toEqual([]);
    expect(syllabifyIpa('')).toEqual([]);
  });

  it('keeps every token in exactly one syllable', () => {
    const { tokens } = parseIpa(textToIpa('quality', { lang: 'en' }).ipa);
    const word = tokens.filter((token) => token.kind !== 'pause');
    const split = syllabifyTokens(word, { language: 'en' });
    expect(split.flat()).toEqual(word);
    expect(split.length).toBe(3);
  });
});
