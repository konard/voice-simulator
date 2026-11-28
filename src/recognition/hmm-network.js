/**
 * Decoding network of the Gaussian HMM recogniser: per language a prefix
 * tree over the pronunciations of the most frequent lexicon words, one
 * node per phone (three states, six with a stop release), with unigram
 * look-ahead for the word bigram. A Mandarin tree also has, per sandhi
 * tone, a tree of the words that start with that tone (`after`), where a
 * rising sandhi variant goes on. Unlicense.
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
 * Each variant is `{ tokens, before }`: `before` is the tone class the
 * next syllable must have for the rising variant (3 after a third tone, 4
 * for 不 and 一, as applyToneSandhi in src/g2p/pinyin.js), absent if any.
 */
export function toneVariants(word, tokens) {
  const out = [{ tokens }];
  const toned = tokens.findLastIndex((t) => t.tone?.length);
  if (toned < 0) {
    return out;
  }
  const withTone = (tone) =>
    tokens.map((t, i) => (i === toned ? { ...t, tone } : t));
  if (toneClass(tokens[toned].tone) === 3 || word === '不' || word === '一') {
    out.push({
      tokens: withTone([3, 5]),
      before: word === '不' || word === '一' ? 4 : 3,
    });
  }
  if (word === '一') {
    out.push({ tokens: withTone([5, 1]) });
  }
  return out;
}

/** Tone class of the first toned syllable of a token list, 0 if none. */
export function firstToneClass(tokens) {
  return toneClass(tokens.find((t) => t.tone?.length)?.tone);
}

/** Add a word to a prefix tree, one node per unit (see addTree). */
function insertWord(builder, model, root, words, wid) {
  const { tokens, units } = words[wid];
  let node = root;
  tokens.forEach((t, i) => {
    const left = i ? tokens[i - 1].symbol : null;
    const right = i + 1 < tokens.length ? tokens[i + 1].symbol : null;
    // Siblings that differ only in the next phone share a node when
    // their exit states are the same.
    const key = `${units[i]}>${stateIndex(model, units[i], 2, left, right)}>${stateIndex(model, `${units[i]}_r`, 2, left, right)}`;
    node.children ??= new Map();
    let child = node.children.get(key);
    if (!child) {
      child = builder.newNode(units[i], left, right);
      node.children.set(key, child);
    }
    node = child;
  });
  (node.words ??= []).push(wid);
}

function createBuilder(model) {
  const emit = [];
  const firstState = [];
  const firstChild = [];
  const firstWord = [];
  const children = [];
  const endings = [];
  const look = [];
  const optional = [];
  const language = [];
  let pending = [];
  const addStates = (unit, left, right) => {
    for (let s = 0; s < 3; s++) {
      emit.push(stateIndex(model, unit, s, left, right));
    }
  };
  const newNode = (symbol, left = null, right = null) => {
    const ex = model.expansions.get(symbol);
    const released = Boolean(ex?.release) && model.ciIndex.has(`${symbol}_r#0`);
    const node = {
      id: firstState.length,
      optional: released && ex.optional,
      children: null,
      words: null,
      lookLn: 0,
    };
    firstState.push(emit.length);
    addStates(symbol, left, right);
    if (released) {
      addStates(`${symbol}_r`, left, right);
    }
    pending.push(node);
    return node;
  };
  function finishTree(index) {
    for (const node of pending) {
      firstChild.push(children.length);
      firstWord.push(endings.length);
      if (node.children) {
        for (const child of node.children.values()) {
          children.push(child.id);
        }
      }
      if (node.words) {
        for (const id of node.words) {
          endings.push(id);
        }
      }
      look.push(node.lookLn);
      optional.push(node.optional ? 1 : 0);
      language.push(index);
    }
    pending = [];
  }
  function finish() {
    firstState.push(emit.length);
    firstChild.push(children.length);
    firstWord.push(endings.length);
    return {
      emit: Int32Array.from(emit),
      firstState: Int32Array.from(firstState),
      firstChild: Int32Array.from(firstChild),
      firstWord: Int32Array.from(firstWord),
      children: Int32Array.from(children),
      endings: Int32Array.from(endings),
      look: Float64Array.from(look),
      optional: Uint8Array.from(optional),
      language: Uint8Array.from(language),
    };
  }
  return { newNode, finishTree, finish };
}

function lookahead(node, uni) {
  let best = -Infinity;
  if (node.words) {
    for (const id of node.words) {
      best = Math.max(best, uni(id));
    }
  }
  if (node.children) {
    for (const child of node.children.values()) {
      best = Math.max(best, lookahead(child, uni));
    }
  }
  node.lookLn = best;
  return best;
}

function compactPronunciations() {
  const phones = new Map();
  return (tokens) => {
    const result = [];
    for (const { kind, symbol, stress, tone } of tokens) {
      if (kind !== 'vowel' && kind !== 'consonant') {
        continue;
      }
      const key = `${kind}:${tokenIpa({ symbol, stress, tone })}`;
      let token = phones.get(key);
      if (!token) {
        token = { kind, symbol, stress, tone };
        phones.set(key, token);
      }
      result.push(token);
    }
    return result;
  };
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
    const n = builder.newNode(symbol);
    n.words = [words.length];
    words.push({
      word: '',
      lang,
      tokens: [{ symbol, kind: phones.get(symbol).kind }],
      units: [symbol],
      oov: true,
      begin,
    });
    return n.id;
  };
  return {
    begin: symbols.map((symbol) => node(symbol, true)),
    next: symbols.map((symbol) => node(symbol, false)),
    bigram,
  };
}

/**
 * Per tone that causes a rising sandhi variant among the words `ids`, the
 * tree of the words whose first syllable has it: the variant goes on there
 * only.
 */
function sandhiTrees(builder, model, words, ids) {
  const after = new Map();
  for (const wid of ids) {
    const { before } = words[wid];
    if (before && !after.has(before)) {
      const sub = { children: new Map() };
      for (const id of ids) {
        if (firstToneClass(words[id].tokens) === before) {
          insertWord(builder, model, sub, words, id);
        }
      }
      after.set(before, sub);
    }
  }
  return after;
}

function addTree(builder, model, lang, words, { maxWords, oov }) {
  const lexicon = getLexicon(lang);
  const root = { children: new Map() };
  const silence = builder.newNode('sil');
  const seen = new Set();
  const phones = new Map();
  const pairs = new Map();
  const tonal = lang === 'zh' && model.units.some((u) => u.includes('@'));
  const ids = [];
  const selectTokens = compactPronunciations();
  for (const entry of allPronunciations(lexicon, maxWords, selectTokens)) {
    const spoken = entry.tokens;
    const variants = tonal
      ? toneVariants(entry.word, spoken)
      : [{ tokens: spoken }];
    for (const { tokens, before } of variants) {
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
      const wid = words.length;
      // `count` is the decoder's unigram backoff: the word's prior.
      words.push({ word: entry.word, lang, tokens, units, count: entry.prior });
      if (before) {
        words[wid].before = before;
      }
      ids.push(wid);
      insertWord(builder, model, root, words, wid);
    }
  }
  const after = sandhiTrees(builder, model, words, ids);
  const uni = (id) => Math.log((words[id].count ?? 1) / lexicon.total);
  for (const tree of [root, ...after.values()]) {
    for (const child of tree.children.values()) {
      lookahead(child, uni);
    }
  }
  const roots = (tree) => Array.from(tree.children.values(), ({ id }) => id);
  return {
    root: roots(root),
    after: new Map([...after].map(([k, v]) => [k, roots(v)])),
    silence: silence.id,
    loop:
      oov && !tonal
        ? addLoop(builder, lang, words, phones, pairs)
        : { begin: [], next: [], bigram: new Map() },
    data: lexicon,
  };
}

function* allPronunciations(lexicon, maxWords, selectTokens) {
  yield* lexicon.pronunciations(maxWords, selectTokens);
  yield* lexicon.addedPronunciations(maxWords, undefined, selectTokens);
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
  for (const [index, lang] of languages.entries()) {
    const tree = addTree(builder, model, lang, words, { maxWords, oov });
    trees.set(lang, { ...tree, index });
    builder.finishTree(index);
  }
  return { model, words, trees, ...builder.finish() };
}

const networks = new WeakMap();

/** Reuse packed nodes across searches that request overlapping languages. */
export function getNetwork(model, languages, options = {}) {
  // Pronunciations added with addLexicon() change the trees.
  const revision = lexiconRevision();
  const key = `${options.maxWords ?? HMM_MAX_WORDS}:${options.oov ?? true}`;
  let byModel = networks.get(model);
  if (!byModel || byModel.revision !== revision) {
    byModel = Object.assign(new Map(), { revision });
    networks.set(model, byModel);
  }
  let network = byModel.get(key);
  if (!network || languages.some((language) => !network.trees.has(language))) {
    const shared = new Set(network?.trees.keys());
    for (const language of languages) {
      shared.add(language);
    }
    network = buildNetwork(model, [...shared], options);
    byModel.set(key, network);
  }
  return { ...network, languages };
}
