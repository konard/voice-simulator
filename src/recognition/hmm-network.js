/**
 * Decoding network of the Gaussian HMM recogniser: per language a prefix
 * tree over the pronunciations of the most frequent lexicon words, one
 * node per phone (three states, six with a stop release), with unigram
 * look-ahead for the word bigram. Unlicense.
 */
import { getLexicon } from './lexicon.js';
import { contextClass, stateIndex, toneClass, toneUnits } from './hmm-model.js';

const TONES = ['', '˩', '˨', '˧', '˦', '˥'];

/** IPA of a lexicon token with its stress mark and tone letters. */
export function tokenIpa(token) {
  const tones = (token.tone ?? []).map((n) => TONES[n]).join('');
  const stress = token.stress === 1 ? 'ˈ' : token.stress === 2 ? 'ˌ' : '';
  return `${stress}${token.symbol}${tones}`;
}

/**
 * Tone variants of a Mandarin pronunciation: a word-final third tone may
 * be read as a rising tone (third-tone sandhi), 不 and 一 change by context.
 */
export function toneVariants(word, tokens) {
  const out = [tokens];
  const toned = tokens.findLastIndex((t) => t.tone?.length);
  if (toned < 0) {
    return out;
  }
  const withTone = (tone) =>
    tokens.map((t, i) => (i === toned ? { ...t, tone } : t));
  if (toneClass(tokens[toned].tone) === 3 || word === '不' || word === '一') {
    out.push(withTone([3, 5]));
  }
  if (word === '一') {
    out.push(withTone([5, 1]));
  }
  return out;
}

function createBuilder(model) {
  const emit = [];
  const nodes = [];
  const addStates = (unit, left, right) => {
    for (let s = 0; s < 3; s++) {
      emit.push(stateIndex(model, unit, s, left, right));
    }
  };
  const newNode = (symbol, lang, left = null, right = null) => {
    const ex = model.expansions.get(symbol);
    const released = Boolean(ex?.release) && model.ciIndex.has(`${symbol}_r#0`);
    const node = {
      id: nodes.length,
      symbol,
      lang,
      first: emit.length,
      count: released ? 6 : 3,
      optional: released && ex.optional,
      children: new Map(),
      words: [],
      lookLn: 0,
    };
    addStates(symbol, left, right);
    if (released) {
      addStates(`${symbol}_r`, left, right);
    }
    nodes.push(node);
    return node;
  };
  return { emit, nodes, newNode };
}

function lookahead(node, uni) {
  let best = -Infinity;
  for (const id of node.words) {
    best = Math.max(best, uni(id));
  }
  for (const child of node.children.values()) {
    best = Math.max(best, lookahead(child, uni));
  }
  node.lookLn = best;
  return best;
}

function spokenTokens(entry) {
  return entry.tokens.filter(
    (t) => t.kind === 'vowel' || t.kind === 'consonant'
  );
}

function addTree(builder, model, lang, words, maxWords) {
  const lexicon = getLexicon(lang);
  const root = { children: new Map() };
  const silence = builder.newNode('sil', lang);
  const seen = new Set();
  const tonal = lang === 'zh' && model.units.some((u) => u.includes('@'));
  for (const entry of lexicon.pronunciations(maxWords)) {
    const spoken = spokenTokens(entry);
    for (const tokens of tonal ? toneVariants(entry.word, spoken) : [spoken]) {
      const units = tonal ? toneUnits(tokens) : tokens.map((t) => t.symbol);
      const ipa = tokens.map(tokenIpa).join(' ');
      if (
        !tokens.length ||
        units.some((u) => !model.ciIndex.has(`${u}#0`)) ||
        seen.has(`${entry.word}\t${ipa}`)
      ) {
        continue;
      }
      seen.add(`${entry.word}\t${ipa}`);
      let node = root;
      tokens.forEach((t, i) => {
        const left = i ? contextClass(tokens[i - 1].symbol) : null;
        const right =
          i + 1 < tokens.length ? contextClass(tokens[i + 1].symbol) : null;
        const key = `${units[i]}>${right}`;
        let child = node.children.get(key);
        if (!child) {
          child = builder.newNode(units[i], lang, left, right);
          node.children.set(key, child);
        }
        node = child;
      });
      node.words.push(words.length);
      words.push({ word: entry.word, lang, tokens, units });
    }
  }
  const uni = (id) =>
    Math.log((lexicon.counts.get(words[id].word) ?? 1) / lexicon.total);
  for (const child of root.children.values()) {
    lookahead(child, uni);
  }
  return { root: [...root.children.values()], silence, data: lexicon };
}

/** Build the decoding network of the given languages. */
export function buildNetwork(model, languages, { maxWords = 8000 } = {}) {
  const builder = createBuilder(model);
  const words = [];
  const trees = new Map();
  for (const lang of languages) {
    trees.set(lang, addTree(builder, model, lang, words, maxWords));
  }
  const emit = Int32Array.from(builder.emit);
  return {
    model,
    nodes: builder.nodes,
    words,
    trees,
    emit,
    stay: Float64Array.from(emit, (m) => model.stay[m]),
    go: Float64Array.from(emit, (m) => model.go[m]),
  };
}

const networks = new WeakMap();

/** Cached network of a model and language list. */
export function getNetwork(model, languages, options = {}) {
  const key = `${languages.join(',')}:${options.maxWords ?? 8000}`;
  let byModel = networks.get(model);
  if (!byModel) {
    byModel = new Map();
    networks.set(model, byModel);
  }
  let network = byModel.get(key);
  if (!network) {
    network = buildNetwork(model, languages, options);
    byModel.set(key, network);
  }
  return network;
}
