/**
 * Decoding network of the Gaussian HMM recogniser: per language a prefix
 * tree over the pronunciations of the most frequent lexicon words, one
 * node per phone (three states, six with a stop release), with unigram
 * look-ahead for the word bigram. Unlicense.
 */
import { lexiconRevision } from '../g2p/lexicon.js';
import { getLexicon } from './lexicon.js';
import { stateIndex, toneClass, toneUnits } from './hmm-model.js';

const TONES = ['', '˩', '˨', '˧', '˦', '˥'];

/** Words per language in the decoding network. */
export const HMM_MAX_WORDS = 20000;

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

/**
 * Phone loop of a language for words outside its vocabulary: per phone of
 * its pronunciations a node that begins such a word and one that goes on
 * with it, each ending a one-phone pseudo-word that the decoder joins with
 * the ones before it (hmm-decode.js). `bigram` holds ln p of a phone after
 * the previous one ('' at the start of a word), from the pronunciations.
 */
function addLoop(builder, lang, words, phones, pairs) {
  const symbols = [...phones.keys()].sort();
  const bigram = new Map();
  for (const from of ['', ...symbols]) {
    const row = pairs.get(from) ?? new Map();
    let total = symbols.length;
    for (const n of row.values()) {
      total += n;
    }
    // Add-one smoothing over the phones.
    bigram.set(
      from,
      new Map(
        symbols.map((to) => [to, Math.log(((row.get(to) ?? 0) + 1) / total)])
      )
    );
  }
  const node = (symbol, begin) => {
    const n = builder.newNode(symbol, lang);
    n.loop = true;
    n.words.push(words.length);
    words.push({
      word: '',
      lang,
      tokens: [{ symbol, kind: phones.get(symbol).kind }],
      units: [symbol],
      oov: true,
      begin,
    });
    return n;
  };
  return {
    begin: symbols.map((symbol) => node(symbol, true)),
    next: symbols.map((symbol) => node(symbol, false)),
    bigram,
  };
}

function addTree(builder, model, lang, words, { maxWords, oov }) {
  const lexicon = getLexicon(lang);
  const root = { children: new Map() };
  const silence = builder.newNode('sil', lang);
  const seen = new Set();
  const phones = new Map();
  const pairs = new Map();
  const tonal = lang === 'zh' && model.units.some((u) => u.includes('@'));
  const entries = [
    ...lexicon.pronunciations(maxWords),
    ...lexicon.addedPronunciations(maxWords),
  ];
  for (const entry of entries) {
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
      if (!tonal) {
        tokens.forEach((t, i) => {
          phones.set(t.symbol, t);
          const from = i ? tokens[i - 1].symbol : '';
          const row = pairs.get(from) ?? new Map();
          pairs.set(from, row.set(t.symbol, (row.get(t.symbol) ?? 0) + 1));
        });
      }
      let node = root;
      tokens.forEach((t, i) => {
        const left = i ? tokens[i - 1].symbol : null;
        const right = i + 1 < tokens.length ? tokens[i + 1].symbol : null;
        // Siblings that differ only in the next phone share a node when
        // their exit states are the same.
        const key = `${units[i]}>${stateIndex(model, units[i], 2, left, right)}>${stateIndex(model, `${units[i]}_r`, 2, left, right)}`;
        let child = node.children.get(key);
        if (!child) {
          child = builder.newNode(units[i], lang, left, right);
          node.children.set(key, child);
        }
        node = child;
      });
      node.words.push(words.length);
      words.push({ word: entry.word, lang, tokens, units, count: entry.count });
    }
  }
  const uni = (id) => Math.log((words[id].count ?? 1) / lexicon.total);
  for (const child of root.children.values()) {
    lookahead(child, uni);
  }
  return {
    root: [...root.children.values()],
    silence,
    loop:
      oov && !tonal
        ? addLoop(builder, lang, words, phones, pairs)
        : { begin: [], next: [], bigram: new Map() },
    data: lexicon,
  };
}

/**
 * Build the decoding network of the given languages: the lexicon trees of
 * the `maxWords` most frequent words and, with `oov` (default), a phone
 * loop per language without tones.
 */
export function buildNetwork(
  model,
  languages,
  { maxWords = HMM_MAX_WORDS, oov = true } = {}
) {
  const builder = createBuilder(model);
  const words = [];
  const trees = new Map();
  for (const lang of languages) {
    trees.set(lang, addTree(builder, model, lang, words, { maxWords, oov }));
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
  // Pronunciations added with addLexicon() change the trees.
  const revision = lexiconRevision();
  const key = `${languages.join(',')}:${options.maxWords ?? HMM_MAX_WORDS}:${options.oov ?? true}`;
  let byModel = networks.get(model);
  if (!byModel || byModel.revision !== revision) {
    byModel = Object.assign(new Map(), { revision });
    networks.set(model, byModel);
  }
  let network = byModel.get(key);
  if (!network) {
    network = buildNetwork(model, languages, options);
    byModel.set(key, network);
  }
  return network;
}
