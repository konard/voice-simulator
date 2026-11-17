/** Common, deterministic recognition measurements; no rendering or network. */
import { readFileSync } from 'node:fs';
import { parseIpa } from '../../src/ipa/parse.js';
import { syllabifyTokens } from '../../src/ipa/syllables.js';
import { listSymbols } from '../../src/ipa/inventory.js';
import { phoneDistance } from '../../src/recognition/phone-distance.js';

export const sentences = JSON.parse(
  readFileSync(
    new globalThis.URL(
      '../fixtures/recognition/ipa-sentences.json',
      import.meta.url
    ),
    'utf8'
  )
);
export const sounds = (ipa) =>
  parseIpa(ipa).tokens.filter((t) => t.kind !== 'pause');
export const soundKey = (tokens) =>
  tokens.map((t) => `${t.symbol}:${(t.tone ?? []).join('')}`).join('|');
export const ipaKey = (ipa) => soundKey(sounds(ipa));

/** Temporarily remove every pronunciation of the held-out dictionary words. */
export function withoutWords(lexicon, words, run) {
  const removed = [];
  const stack = [lexicon.root];
  while (stack.length) {
    const node = stack.pop();
    if (node.entries.some((entry) => words.has(entry.word))) {
      removed.push([node, node.entries]);
      node.entries = node.entries.filter((entry) => !words.has(entry.word));
    }
    stack.push(...node.children.values());
  }
  try {
    return run();
  } finally {
    for (const [node, entries] of removed) {
      node.entries = entries;
    }
  }
}

export function soundWords(words, language) {
  // Mandarin's written unit is a character/syllable; a discovered corpus
  // phrase can combine several of the forward engine's character words.
  return language === 'zh'
    ? words.flatMap((word) =>
        syllabifyTokens(sounds(word.ipa), { language }).map(soundKey)
      )
    : words.map((word) => ipaKey(word.ipa));
}

export function editDistance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++) {
      next.push(
        Math.min(next[j] + 1, row[j + 1] + 1, row[j] + Number(a[i] !== b[j]))
      );
    }
    row = next;
  }
  return row.at(-1);
}

const inventory = listSymbols().map((symbol) => sounds(symbol)[0]);
const nearestCache = new Map();
export function nearestOther(token) {
  const key = `${soundKey([token])}:${token.stress}`;
  if (!nearestCache.has(key)) {
    let nearest;
    let cost = Infinity;
    for (const other of inventory) {
      if (other.symbol === token.symbol) {
        continue;
      }
      const distance = phoneDistance(token, other);
      if (distance < cost) {
        nearest = other;
        cost = distance;
      }
    }
    nearestCache.set(key, nearest);
  }
  return nearestCache.get(key);
}
