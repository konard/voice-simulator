/**
 * Full pronunciation lexicons of the app. A server may put the output of
 * `node scripts/build-lexicon.mjs build <lang> --full` at
 * `lexicons/<lang>-full.json` next to the page; when the file exists it is
 * added with `addLexicon` before the first text of that language is read.
 * A missing file (or any error) leaves the shipped lexicon in use.
 */

import { addLexicon } from '../../../../src/index.js';

const LANGUAGES = ['en', 'ru', 'hi', 'zh'];

/**
 * Fetch `lexicons/<lang>-full.json` relative to the page.
 * @param {string} lang
 * @returns {Promise<object|null>} the JSON, or null without one
 */
export async function fetchFullLexicon(lang) {
  const base = globalThis.document?.baseURI ?? globalThis.location?.href;
  if (!base || typeof globalThis.fetch !== 'function') {
    return null;
  }
  const url = new globalThis.URL(`lexicons/${lang}-full.json`, base);
  const response = await globalThis.fetch(url);
  return response.ok ? response.json() : null;
}

/**
 * Remember which languages have been tried and add each found lexicon once.
 * @param {(lang: string) => Promise<object|null>} [load]
 * @returns {(langs: Iterable<string>) => Promise<string[]>} adds the
 *   lexicons of the languages not tried before and resolves to the
 *   languages whose lexicon was added since the last call that saw them
 */
export function fullLexiconLoader(load = fetchFullLexicon) {
  const tried = new Map();
  const settled = new Set();
  const loadOne = async (lang) => {
    try {
      const data = await load(lang);
      if (data) {
        addLexicon(lang, data);
        return true;
      }
    } catch {
      // No file or a bad one: the shipped lexicon stays in use.
    }
    return false;
  };
  return async (langs) => {
    const wanted = [...new Set(langs)].filter((lang) =>
      LANGUAGES.includes(lang)
    );
    // Languages still loading (here or in an earlier call) may add words.
    const pending = wanted.filter((lang) => !settled.has(lang));
    for (const lang of pending) {
      if (!tried.has(lang)) {
        tried.set(
          lang,
          loadOne(lang).then((added) => {
            settled.add(lang);
            return added;
          })
        );
      }
    }
    const added = await Promise.all(pending.map((lang) => tried.get(lang)));
    return pending.filter((lang, index) => added[index]);
  };
}
