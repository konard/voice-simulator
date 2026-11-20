/** Intersect a timed acoustic lattice with the pronunciation trie. Unlicense. */
import { audioToIpa, ipaToText, parseIpa } from '../src/index.js';
import { wordCost } from '../src/recognition/data/index.js';
import { getLexicon } from '../src/recognition/lexicon.js';
import { renderWhisper } from './issue-72-whisper-robustness.mjs';

function keep(paths, path) {
  if (path.cost < (paths.get(path.node)?.cost ?? Infinity)) {
    paths.set(path.node, path);
  }
}

function indexLattice({ times, edges }) {
  const outgoing = Array.from(times, () => new Map());
  const symbols = new Map();
  for (const edge of edges) {
    if (!symbols.has(edge.ipa)) {
      symbols.set(edge.ipa, parseIpa(edge.ipa).tokens[0]?.symbol ?? '');
    }
    const symbol = symbols.get(edge.ipa);
    const row = outgoing[edge.from];
    if (!row.has(symbol)) {
      row.set(symbol, []);
    }
    row.get(symbol).push(edge);
  }
  return outgoing;
}

function finishWord(paths, path, lexicon, weight) {
  for (const { word } of path.node.entries) {
    keep(paths, {
      node: lexicon.root,
      cost: path.cost + weight * wordCost(lexicon, path.last, word),
      last: word,
      words: [...path.words, word],
    });
  }
}

function continuePhone(path, row, states, lexicon, weight) {
  for (const child of path.node.children.values()) {
    for (const edge of row.get(child.token.symbol) ?? []) {
      const next = { ...path, node: child, cost: path.cost + edge.cost };
      const to = states[edge.to];
      keep(to, next);
      finishWord(to, next, lexicon, weight);
    }
  }
}

function readLattice(outgoing, lexicon, weight, beam = 64) {
  const states = outgoing.map(() => new Map());
  keep(states[0], { node: lexicon.root, cost: 0, last: null, words: [] });
  for (const [i, row] of outgoing.entries()) {
    const best = [...states[i].values()]
      .sort((a, b) => a.cost - b.cost)
      .slice(0, beam);
    for (const path of best) {
      if (path.node === lexicon.root) {
        for (const edge of row.get('') ?? []) {
          keep(states[edge.to], path);
        }
      }
      continuePhone(path, row, states, lexicon, weight);
    }
  }
  return states.at(-1).get(lexicon.root);
}

for (const [language, text] of [
  ['en', 'she sees five sheep'],
  ['ru', 'Саша шла домой.'],
  ['hi', 'नमस्ते दुनिया'],
  ['zh', '请喝茶'],
  ['en', 'hello world'],
  ['en', 'a big dog'],
]) {
  const { samples, sampleRate, head } = renderWhisper(
    `[whisper] ${text}`,
    language
  );
  const options = {
    language,
    voice: head,
    whisper: [{ start: 0, end: samples.length / sampleRate }],
  };
  const { lattice, segments } = audioToIpa(samples, sampleRate, options);
  const indexed = indexLattice(lattice);
  const lexicon = getLexicon(language);
  const results = [0.25, 0.5, 1, 2].map((weight) =>
    readLattice(indexed, lexicon, weight)?.words.join(' ')
  );
  console.log({
    language,
    text,
    baseline: ipaToText(segments, { language }).text,
    results,
  });
}
