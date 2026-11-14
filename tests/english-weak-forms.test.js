/**
 * Weak forms of English function words (issue 85): the table, single
 * words, the sentences of the prototype and the command line switch.
 */

import { describe, it, expect } from 'test-anywhere';
import { readFileSync } from 'node:fs';

import { runCli } from '../bin/voice-simulator.js';
import { WEAK_FORMS, textToIpa } from '../src/index.js';
import {
  BEFORE_TO,
  BEFORE_VOWEL,
  DETERMINERS,
  weakenFunctionWords,
} from '../src/g2p/weak-forms.js';

/** `experiments/issue-11-weak-forms-prototype.txt`: lang, text, ipa. */
function prototypeLines() {
  const url = new globalThis.URL(
    '../experiments/issue-11-weak-forms-prototype.txt',
    import.meta.url
  );
  return readFileSync(url, 'utf8')
    .trim()
    .split(/\r?\n/u)
    .map((line) => {
      const [, lang, text, ipa] = /^(\S+) (.*): (".*")$/u.exec(line);
      return { lang, text, ipa: JSON.parse(ipa) };
    });
}

/** The IPA of `textToIpa` in the notation of the prototype. */
const prototypeIpa = (ipa) =>
  ipa.replace(/ (?:↘ )?[.?!]$/u, '').replaceAll(/ (?:↘ )?[,.?!] /gu, ' | ');

describe('WEAK_FORMS', () => {
  it('is a frozen table of the five kinds of function words', () => {
    expect(Object.isFrozen(WEAK_FORMS)).toBe(true);
    expect(WEAK_FORMS.of).toEqual({ kind: 'preposition', weak: 'əv' });
    expect(WEAK_FORMS.can).toEqual({ kind: 'auxiliary', weak: 'kən' });
    const kinds = new Set(Object.values(WEAK_FORMS).map((entry) => entry.kind));
    expect([...kinds].sort()).toEqual([
      'article',
      'auxiliary',
      'conjunction',
      'preposition',
      'pronoun',
    ]);
    expect(Object.keys(WEAK_FORMS).length).toBe(55);
  });

  it('exports the context tables', () => {
    expect(BEFORE_VOWEL).toEqual({ the: 'ði', to: 'tu' });
    expect(BEFORE_TO.have).toBe('ˈhæf');
    expect(DETERMINERS.has('my')).toBe(true);
    expect(DETERMINERS.has('to')).toBe(false);
  });

  it('leaves every function word alone when it is said alone', () => {
    for (const lang of ['en-US', 'en-GB']) {
      for (const word of Object.keys(WEAK_FORMS)) {
        expect(textToIpa(word, { lang }).ipa).toBe(
          textToIpa(word, { lang, weakForms: false }).ipa
        );
      }
    }
  });

  it('skips words of other languages', () => {
    const items = [{ text: 'can', lang: 'ru', ipa: 'kan' }];
    weakenFunctionWords(
      [...items, { text: 'of', lang: 'ru', ipa: 'of' }],
      'en-US'
    );
    expect(items[0].ipa).toBe('kan');
    expect(textToIpa('Я не знаю', { lang: 'ru' }).ipa).toBe('ja nʲe ˈznajʊ');
  });
});

describe('weak-form prototype sentences', () => {
  it('gives the IPA of every sentence of the prototype', () => {
    const lines = prototypeLines();
    expect(lines.length > 30).toBe(true);
    for (const { lang, text, ipa } of lines) {
      expect(`${text}: ${prototypeIpa(textToIpa(text, { lang }).ipa)}`).toBe(
        `${text}: ${ipa}`
      );
    }
  });
});

describe('--strong-forms', () => {
  it('keeps every English word strong on the command line', async () => {
    const stdout = [];
    const io = { stderr: () => {}, stdout: (line) => stdout.push(line) };
    expect(await runCli(['ipa', '-l', 'en', 'I can do it'], io)).toBe(0);
    expect(
      await runCli(['ipa', '-l', 'en', '--strong-forms', 'I can do it'], io)
    ).toBe(0);
    expect(stdout).toEqual(['aɪ kən ˈdu ɪt', 'ˈaɪ ˈkæn ˈdu ˈɪt']);
  });
});
