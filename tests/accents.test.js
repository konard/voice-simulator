/**
 * English accents: General American against Southern British,
 * Australian and Indian English, derived from the American dictionary.
 */

import { describe, it, expect } from 'test-anywhere';
import { textToIpa } from '../src/g2p/index.js';
import {
  ACCENTS,
  adaptEnglishWord,
  resolveAccent,
} from '../src/g2p/accents.js';
import { parseIpa } from '../src/ipa/parse.js';
import { prepareUtterance } from '../src/synthesize.js';
import { runCli } from '../bin/voice-simulator.js';

const say = (text, accent) => textToIpa(text, { lang: 'en', accent }).ipa;

describe('resolveAccent', () => {
  it('accepts codes and regions and defaults to General American', () => {
    expect(resolveAccent('en', 'en-GB')).toBe('en-GB');
    expect(resolveAccent('en', 'gb')).toBe('en-GB');
    expect(resolveAccent('en', 'AU')).toBe('en-AU');
    expect(resolveAccent('en')).toBe('en-US');
    expect(resolveAccent('en', 'xx')).toBe('en-US');
  });

  it('has no accents for the other languages', () => {
    expect(resolveAccent('ru', 'en-GB')).toBe(null);
    expect(resolveAccent('zh')).toBe(null);
  });

  it('lists the default accent first', () => {
    expect(ACCENTS.en[0].code).toBe('en-US');
  });
});

describe('General American', () => {
  it('stays rhotic and flaps t between vowels', () => {
    expect(say('car')).toBe('ˈkɑɹ');
    expect(say('water')).toBe('ˈwɔɾɚ');
    expect(say('lot')).toBe('ˈlɑt');
    expect(say('bath')).toBe('ˈbæθ');
    expect(say('Hello world')).toBe('həˈloʊ ˈwɝld');
  });

  it('keeps t before a stressed vowel', () => {
    expect(say('attack')).toBe(say('attack', 'en-US'));
    expect(say('attack').includes('ɾ')).toBe(false);
  });
});

describe('Southern British', () => {
  it('drops a final r and lengthens START', () => {
    expect(say('car', 'en-GB')).toBe('ˈkɑː');
    expect(say('start', 'en-GB')).toBe('ˈstɑːt');
  });

  it('uses the BATH vowel and a rounded LOT', () => {
    expect(say('bath', 'en-GB')).toBe('ˈbɑːθ');
    expect(say('dance', 'en-GB')).toBe('ˈdɑːns');
    expect(say('cat', 'en-GB')).toBe('ˈkæt');
    expect(say('lot', 'en-GB')).toBe('ˈlɒt');
    expect(say('want', 'en-GB')).toBe('ˈwɒnt');
    expect(say('father', 'en-GB')).toBe('ˈfɑːðə');
  });

  it('keeps t unflapped and THOUGHT long', () => {
    expect(say('water', 'en-GB')).toBe('ˈwɔːtə');
    expect(say('better', 'en-GB')).toBe('ˈbɛtə');
    expect(say('thought', 'en-GB')).toBe('ˈθɔːt');
  });

  it('has its own GOAT, NURSE, NEAR, SQUARE and CURE vowels', () => {
    expect(say('go', 'en-GB')).toBe('ˈɡəʊ');
    expect(say('nurse', 'en-GB')).toBe('ˈnɜːs');
    expect(say('near', 'en-GB')).toBe('ˈnɪə');
    expect(say('square', 'en-GB')).toBe('ˈskwɛə');
    expect(say('pure', 'en-GB')).toBe('ˈpjʊə');
    expect(say('hurry', 'en-GB')).toBe('ˈhʌɹi');
    expect(say('sorry', 'en-GB')).toBe('ˈsɒɹi');
  });

  it('keeps a yod after t, d and n', () => {
    expect(say('tune', 'en-GB')).toBe('ˈtjuːn');
    expect(say('tune')).toBe('ˈtun');
  });

  it('links a final r to a following vowel only', () => {
    expect(say('far away', 'en-GB')).toBe('ˈfɑːɹ əˈweɪ');
    expect(say('far gone', 'en-GB').startsWith('ˈfɑː ')).toBe(true);
    expect(say('four. Apples', 'en-GB').startsWith('ˈfɔː .')).toBe(true);
  });

  it('reports the accent it used', () => {
    expect(textToIpa('car', { lang: 'en', accent: 'gb' }).accent).toBe('en-GB');
    expect(textToIpa('car', { lang: 'en' }).accent).toBe('en-US');
  });
});

describe('other English accents', () => {
  it('derives General Australian vowels', () => {
    expect(say('car', 'en-AU')).toBe('ˈkɐː');
    expect(say('go', 'en-AU')).toBe('ˈɡəʉ');
    expect(say('dance', 'en-AU')).toBe('ˈdæns');
    expect(say('water', 'en-AU')).toBe('ˈwoːɾə');
  });

  it('derives Indian English consonants', () => {
    expect(say('water', 'en-IN')).toBe('ˈʋɔʈəɾ');
    expect(say('thought', 'en-IN')).toBe('ˈt̪ʰɔʈ');
    expect(say('go', 'en-IN')).toBe('ˈɡoː');
  });

  it('only produces symbols the parser knows', () => {
    const text = 'The quick brown fox, thirty cars: water, tune, square!';
    for (const { code } of ACCENTS.en) {
      expect(parseIpa(say(text, code)).unknown).toEqual([]);
    }
  });

  it('leaves the other languages alone', () => {
    const russian = textToIpa('Привет, мир', { lang: 'ru' });
    const british = textToIpa('Привет, мир', { lang: 'ru', accent: 'en-GB' });
    expect(british.ipa).toBe(russian.ipa);
    expect(british.accent).toBe(null);
  });

  it('passes unknown accents through unchanged', () => {
    expect(adaptEnglishWord('ˈkɑɹ', 'car', 'en-XX')).toBe('ˈkɑɹ');
  });
});

describe('accent option', () => {
  it('reaches the planner through prepareUtterance', () => {
    const british = prepareUtterance('car', { lang: 'en', accent: 'en-GB' });
    expect(british.accent).toBe('en-GB');
    expect(british.ipa).toBe('ˈkɑː');
    const phones = (prepared) =>
      prepared.plan.segments.map((segment) => segment.token?.symbol);
    expect(phones(prepareUtterance('car', { lang: 'en' }))).toContain('ɹ');
    expect(phones(british)).not.toContain('ɹ');
  });

  it('is a CLI option', async () => {
    const stdout = [];
    const code = await runCli(['ipa', '--accent', 'en-GB', 'water'], {
      stderr: () => {},
      stdout: (line) => stdout.push(line),
    });
    expect(code).toBe(0);
    expect(stdout).toEqual(['ˈwɔːtə']);
  });

  it('is implied by a regional language code', () => {
    const british = textToIpa('water', { lang: 'en-GB' });
    expect(british.lang).toBe('en');
    expect(british.accent).toBe('en-GB');
    expect(british.ipa).toBe('ˈwɔːtə');
    expect(textToIpa('car', { lang: 'en-au' }).accent).toBe('en-AU');
    // An explicit accent wins over the region of the language code.
    expect(textToIpa('car', { lang: 'en-GB', accent: 'en-US' }).ipa).toBe(
      'ˈkɑɹ'
    );
    expect(prepareUtterance('car', { lang: 'en-GB' }).ipa).toBe('ˈkɑː');
  });
});
