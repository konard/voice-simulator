/** Build the same breadth-first trie as the prepared lexicon asset. Unlicense. */
import { soundKey } from './lexicon.js';
import { openPreparedLexicon } from './prepared-lexicon.js';

function extend(array) {
  const grown = new Uint32Array(array.length * 2);
  grown.set(array);
  return grown;
}

export function buildLexiconTrie(lexicon, language) {
  const words = lexicon.words;
  const wordIndices = new Map(words.map(({ word }, id) => [word, id]));
  const tokenIndices = new Map();
  const tokens = [];
  let first = new Uint32Array(8192);
  let sibling = new Uint32Array(first.length);
  let feature = new Uint32Array(first.length);
  let size = 1;
  const ends = new Map();
  for (const { word, ipa, tokens: phones } of lexicon.pronunciations()) {
    let node = 0;
    for (const phone of phones) {
      const key = soundKey(phone, language);
      if (!tokenIndices.has(key)) {
        tokenIndices.set(key, tokens.length);
        tokens.push(phone);
      }
      const token = tokenIndices.get(key);
      let child = first[node];
      let previous = 0;
      while (child && feature[child] !== token) {
        previous = child;
        child = sibling[child];
      }
      if (!child) {
        child = size++;
        if (child === first.length) {
          first = extend(first);
          sibling = extend(sibling);
          feature = extend(feature);
        }
        feature[child] = token;
        if (previous) {
          sibling[previous] = child;
        } else {
          first[node] = child;
        }
      }
      node = child;
    }
    if (node) {
      const rows = ends.get(node) ?? [];
      rows.push(wordIndices.get(word), ipa);
      ends.set(node, rows);
    }
  }
  const order = new Uint32Array(size);
  const offsets = new Uint32Array(size + 1);
  const features = new Uint32Array(size);
  const wordOffsets = new Uint32Array(size + 1);
  const ids = [];
  const readings = [];
  let next = 1;
  for (let i = 0; i < size; i++) {
    const node = order[i];
    offsets[i] = next - 1;
    features[i] = feature[node];
    for (let child = first[node]; child; child = sibling[child]) {
      order[next++] = child;
    }
    wordOffsets[i] = ids.length;
    const rows = ends.get(node);
    for (let j = 0; rows && j < rows.length; j += 2) {
      ids.push(rows[j]);
      readings.push(rows[j + 1]);
    }
  }
  offsets[size] = size - 1;
  wordOffsets[size] = ids.length;
  return openPreparedLexicon(
    [tokens, offsets, features, wordOffsets, Uint32Array.from(ids), readings],
    language,
    words,
    true
  );
}
