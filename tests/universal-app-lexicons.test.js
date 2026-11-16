/**
 * The app adds `lexicons/<lang>-full.json` when the server has the file.
 */

import { describe, it, expect } from 'test-anywhere';
import { VoiceEngine } from '../examples/universal-app/src/engine/voice-engine.js';
import {
  fetchFullLexicon,
  fullLexiconLoader,
} from '../examples/universal-app/src/engine/full-lexicons.js';
import { clearLexicons } from '../src/index.js';

const QUINOA = {
  format: 'lexicon',
  version: 1,
  lang: 'en',
  count: 1,
  words: { quinoa: ['kiˈnoʊə'] },
};

function countingLoad(files) {
  const calls = [];
  const load = async (lang) => {
    calls.push(lang);
    if (lang === 'hi') {
      throw new Error('404');
    }
    return files[lang] ?? null;
  };
  return { calls, load };
}

describe('full lexicons in the app', () => {
  it('asks the server once per language and adds what it finds', async () => {
    const { calls, load } = countingLoad({ en: QUINOA });
    const addFull = fullLexiconLoader(load);
    try {
      const [first, second] = await Promise.all([
        addFull(['en', 'en', 'hi', 'xx']),
        addFull(['en']),
      ]);
      expect(first).toEqual(['en']);
      expect(second).toEqual(['en']);
      expect(await addFull(['en', 'hi', 'ru'])).toEqual([]);
      expect(calls).toEqual(['en', 'hi', 'ru']);
    } finally {
      clearLexicons();
    }
  });

  it('reads the text with the full lexicon', async () => {
    const { load } = countingLoad({ en: QUINOA });
    const engine = new VoiceEngine({
      createWorker: () => ({ addEventListener() {}, postMessage() {} }),
      loadLexicon: load,
    });
    const request = { lang: 'auto', head: {}, seed: '1', mode: 'visual' };
    try {
      await engine.speak({ ...request, text: 'quinoa' });
      expect(engine.status.ipa).toContain('kiˈnoʊə');
    } finally {
      clearLexicons();
    }
    await engine.speak({ ...request, text: 'quinoa' });
    expect(engine.status.ipa).not.toContain('kiˈnoʊə');
  });

  it('fetches nothing outside a page', async () => {
    expect(await fetchFullLexicon('en')).toBe(null);
  });
});
