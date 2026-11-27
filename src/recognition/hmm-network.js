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
import { getHmmModel, stateIndex, toneClass, toneUnits } from './hmm-model.js';
import {
  openHmmWords,
  packHmmWords,
  spokenTokenSelector,
  tokenIpa,
} from './hmm-pronunciations.js';

/** Words per language in the decoding network. */
export const HMM_MAX_WORDS = 20000;

export { tokenIpa } from './hmm-pronunciations.js';

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

// Zero is the end of both linked lists. A word can end at more than one
// node (Mandarin sandhi), so word links have their own IDs.
const NODE_COLUMNS = {
  first: Uint32Array,
  count: Uint8Array,
  optional: Uint8Array,
  language: Uint8Array,
  child: Uint32Array,
  sibling: Uint32Array,
  terminal: Uint32Array,
  lookLn: Float64Array,
};

function grow(column) {
  const larger = new column.constructor(column.length * 2);
  larger.set(column);
  return larger;
}

function createBuilder(model) {
  const nodes = Object.fromEntries(
    Object.entries(NODE_COLUMNS).map(([name, Type]) => [name, new Type(8192)])
  );
  const network = {
    model,
    nodes,
    words: [],
    trees: new Map(),
    languages: [],
    emit:
      model.states > 65536 ? new Uint32Array(32768) : new Uint16Array(32768),
    wordId: new Uint32Array(8192),
    nextWord: new Uint32Array(8192),
    nodeCount: 1,
    stateCount: 0,
    wordLinks: 1,
  };

  function addNode(lang, unit, left, right) {
    const id = network.nodeCount++;
    if (id === nodes.first.length) {
      for (const key of Object.keys(nodes)) {
        nodes[key] = grow(nodes[key]);
      }
    }
    if (unit === undefined) {
      return id; // A root has children but no emitting states.
    }
    const expansion = model.expansions.get(unit);
    const release = `${unit}_r`;
    const released = expansion?.release && model.ciIndex.has(`${release}#0`);
    const first = network.stateCount;
    const count = released ? 6 : 3;
    if (first + count > network.emit.length) {
      network.emit = grow(network.emit);
    }
    nodes.first[id] = first;
    nodes.count[id] = count;
    nodes.optional[id] = released && expansion.optional ? 1 : 0;
    nodes.language[id] = lang;
    for (let i = 0; i < count; i++) {
      network.emit[first + i] = stateIndex(
        model,
        i < 3 ? unit : release,
        i % 3,
        left,
        right
      );
    }
    network.stateCount += count;
    return id;
  }

  function addWord(node, wid) {
    if (network.wordLinks === network.wordId.length) {
      network.wordId = grow(network.wordId);
      network.nextWord = grow(network.nextWord);
    }
    const link = network.wordLinks++;
    network.wordId[link] = wid;
    let tail = nodes.terminal[node];
    if (tail === 0) {
      nodes.terminal[node] = link;
    } else {
      while (network.nextWord[tail]) {
        tail = network.nextWord[tail];
      }
      network.nextWord[tail] = link;
    }
  }

  return { network, addNode, addWord };
}

function insertWord(builder, root, lang, wid, units) {
  const { model, nodes, words } = builder.network;
  const { tokens } = words[wid];
  let node = root;
  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    const left = tokens[i - 1]?.symbol ?? null;
    const right = tokens[i + 1]?.symbol ?? null;
    const middle = model.ciIndex.get(`${unit}#1`);
    const exit = stateIndex(model, unit, 2, left, right);
    const releaseExit = stateIndex(model, `${unit}_r`, 2, left, right);
    const emit = builder.network.emit;
    let child = nodes.child[node];
    let last = 0;
    // Preserve insertion order for deterministic ties. Siblings with the
    // same unit and exit states share a node.
    while (child) {
      const first = nodes.first[child];
      if (
        emit[first + 1] === middle &&
        emit[first + 2] === exit &&
        (nodes.count[child] === 3 || emit[first + 5] === releaseExit)
      ) {
        break;
      }
      last = child;
      child = nodes.sibling[child];
    }
    if (!child) {
      child = builder.addNode(lang, unit, left, right);
      if (last) {
        nodes.sibling[last] = child;
      } else {
        nodes.child[node] = child;
      }
    }
    node = child;
  }
  builder.addWord(node, wid);
}

function lookahead(network, node, uni) {
  const { nodes, wordId, nextWord } = network;
  let best = -Infinity;
  for (let link = nodes.terminal[node]; link; link = nextWord[link]) {
    best = Math.max(best, uni(wordId[link]));
  }
  for (let child = nodes.child[node]; child; child = nodes.sibling[child]) {
    best = Math.max(best, lookahead(network, child, uni));
  }
  nodes.lookLn[node] = best;
  return best;
}

function childrenOf(nodes, node) {
  const children = [];
  for (let child = nodes.child[node]; child; child = nodes.sibling[child]) {
    children.push(child);
  }
  return children;
}

/**
 * Phone loop of a language for words outside its vocabulary: per phone of
 * its pronunciations a node that begins such a word and one that goes on
 * with it, each ending a one-phone pseudo-word that the decoder joins with
 * the ones before it (hmm-decode.js). `bigram` holds ln p of a phone after
 * the previous one ('' at the start of a word), from the pronunciations.
 */
function addLoop(builder, lang, language, words, phones, pairs) {
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
    const n = builder.addNode(language, symbol);
    builder.addWord(n, words.length);
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

/**
 * Per tone that causes a rising sandhi variant among the words `ids`, the
 * tree of the words whose first syllable has it: the variant goes on there
 * only.
 */
function sandhiTrees(builder, lang, words, ids) {
  const after = new Map();
  for (const wid of ids) {
    const { before } = words[wid];
    if (before && !after.has(before)) {
      const sub = builder.addNode(lang);
      for (const id of ids) {
        if (firstToneClass(words[id].tokens) === before) {
          insertWord(builder, sub, lang, id, words[id].units);
        }
      }
      after.set(before, sub);
    }
  }
  return after;
}

let readPrepared;

export function installPreparedHmm(read) {
  readPrepared = read;
}

function* pronunciationEntries(lexicon, limit) {
  const selectTokens = spokenTokenSelector();
  yield* lexicon.pronunciations(limit, selectTokens);
  yield* lexicon.addedPronunciations(limit, undefined, selectTokens);
}

function countPhonePairs(tokens, phones, pairs) {
  tokens.forEach((token, i) => {
    phones.set(token.symbol, token);
    const from = i ? tokens[i - 1].symbol : '';
    const row = pairs.get(from) ?? new Map();
    pairs.set(from, row.set(token.symbol, (row.get(token.symbol) ?? 0) + 1));
  });
}

function* recognizedVariants(lexicon, maxWords, model, tonal) {
  const seen = new Set();
  let previousWord;
  for (const entry of pronunciationEntries(lexicon, maxWords)) {
    if (entry.word !== previousWord) {
      previousWord = entry.word;
      seen.clear();
    }
    const variants = tonal
      ? toneVariants(entry.word, entry.tokens)
      : [{ tokens: entry.tokens }];
    for (const { tokens, before } of variants) {
      const units = tonal ? toneUnits(tokens) : tokens.map((t) => t.symbol);
      const ipa = tokens.map(tokenIpa).join(' ');
      if (
        !tokens.length ||
        units.some((u) => !model.ciIndex.has(`${u}#0`)) ||
        seen.has(ipa)
      ) {
        continue;
      }
      seen.add(ipa);
      yield { word: entry.word, tokens, units, before, prior: entry.prior };
    }
  }
}

function addTree(builder, lang, language, { maxWords, oov }) {
  const { network } = builder;
  const { model, nodes, words } = network;
  const lexicon = getLexicon(lang);
  const root = builder.addNode(language);
  const silence = builder.addNode(language, 'sil');
  const phones = new Map();
  const pairs = new Map();
  const tonal = lang === 'zh' && model.units.some((u) => u.includes('@'));
  const hasLoop = oov && !tonal;
  const ids = [];
  for (const { word, tokens, units, before, prior } of recognizedVariants(
    lexicon,
    maxWords,
    model,
    tonal
  )) {
    if (hasLoop) {
      countPhonePairs(tokens, phones, pairs);
    }
    const wid = words.length;
    // `count` is the decoder's unigram backoff: the word's prior.
    words.push({ word, lang, tokens, count: prior, ...(tonal && { units }) });
    if (before) {
      words[wid].before = before;
    }
    ids.push(wid);
    insertWord(builder, root, language, wid, units);
  }
  const after = sandhiTrees(builder, language, words, ids);
  const uni = (id) => Math.log((words[id].count ?? 1) / lexicon.total);
  for (const tree of [root, ...after.values()]) {
    lookahead(network, tree, uni);
  }
  return {
    root: childrenOf(nodes, root),
    after: new Map([...after].map(([k, v]) => [k, childrenOf(nodes, v)])),
    silence,
    loop: hasLoop
      ? addLoop(builder, lang, language, words, phones, pairs)
      : { begin: [], next: [], bigram: new Map() },
    data: lexicon,
  };
}

const linkedNodes = new Set(['child', 'sibling']);

function appendColumn(column, source, start, delta = 0, sentinel = false) {
  if (start + source.length > column.length) {
    const larger = new column.constructor(start + source.length);
    larger.set(column);
    column = larger;
  }
  if (!delta) {
    column.set(source, start);
  } else {
    for (let i = 0; i < source.length; i++) {
      const value = source[i];
      column[start + i] = sentinel && value === 0 ? 0 : value + delta;
    }
  }
  return column;
}

function appendPrepared(network, lang, language, packed) {
  const { nodes, emit, wordId, nextWord, tree, words } = packed;
  const lexicon = getLexicon(lang);
  const first = network.words.length;
  const nodeDelta = network.nodeCount - 1;
  const linkDelta = network.wordLinks - 1;
  for (const name of Object.keys(nodes)) {
    const delta =
      name === 'first'
        ? network.stateCount
        : name === 'terminal'
          ? linkDelta
          : linkedNodes.has(name)
            ? nodeDelta
            : name === 'language'
              ? language
              : 0;
    network.nodes[name] = appendColumn(
      network.nodes[name],
      nodes[name].subarray(1),
      network.nodeCount,
      delta,
      name === 'terminal' || linkedNodes.has(name)
    );
  }
  network.emit = appendColumn(network.emit, emit, network.stateCount);
  network.wordId = appendColumn(
    network.wordId,
    wordId.subarray(1),
    network.wordLinks,
    network.words.length
  );
  network.nextWord = appendColumn(
    network.nextWord,
    nextWord.subarray(1),
    network.wordLinks,
    linkDelta,
    true
  );
  network.nodeCount += nodes.first.length - 1;
  network.stateCount += emit.length;
  network.wordLinks += wordId.length - 1;
  const offset = (list) => list.map((id) => id + nodeDelta);
  network.words.length += words.flags.length;
  return {
    root: offset(tree.root),
    after: new Map(
      [...tree.after].map(([tone, roots]) => [tone, offset(roots)])
    ),
    silence: tree.silence + nodeDelta,
    loop: {
      begin: offset(tree.loop.begin),
      next: offset(tree.loop.next),
      bigram: tree.loop.bigram,
    },
    data: lexicon,
    wordTable: openHmmWords(words, lexicon.words, lang, first),
  };
}

function firstPrepared(network, lang, packed) {
  const { nodes, emit, wordId, nextWord, tree, words } = packed;
  const lexicon = getLexicon(lang);
  Object.assign(network.nodes, nodes);
  network.emit = emit;
  network.wordId = wordId;
  network.nextWord = nextWord;
  network.nodeCount = nodes.first.length;
  network.stateCount = emit.length;
  network.wordLinks = wordId.length;
  network.words.length = words.flags.length;
  return {
    ...tree,
    data: lexicon,
    wordTable: openHmmWords(words, lexicon.words, lang, 0),
  };
}

/** Precompute the shipped tree for an unmodified vocabulary. */
export function packHmmNetwork(lang) {
  const options = { maxWords: HMM_MAX_WORDS, oov: true };
  const builder = createBuilder(getHmmModel());
  const { network } = builder;
  const { data, ...tree } = addTree(builder, lang, 0, options);
  const nodes = Object.fromEntries(
    Object.entries(network.nodes).map(([name, column]) => [
      name,
      column.slice(0, network.nodeCount),
    ])
  );
  return {
    nodes,
    tree,
    emit: network.emit.slice(0, network.stateCount),
    wordId: network.wordId.slice(0, network.wordLinks),
    nextWord: network.nextWord.slice(0, network.wordLinks),
    words: packHmmWords(network.words, data.words),
  };
}

function withLanguages(builder, languages, options) {
  const { network } = builder;
  const trees = new Map();
  for (const lang of languages) {
    if (!network.trees.has(lang)) {
      const language = network.languages.length;
      const packed =
        options.prepared && readPrepared?.(lang, getLexicon(lang).words);
      network.trees.set(
        lang,
        packed
          ? language === 0
            ? firstPrepared(network, lang, packed)
            : appendPrepared(network, lang, language, packed)
          : addTree(builder, lang, language, options)
      );
      network.languages.push(lang);
    }
    trees.set(lang, network.trees.get(lang));
  }
  return { ...network, trees };
}

/** Build a decoding network with the given languages and vocabulary. */
export function buildNetwork(
  model,
  languages,
  { maxWords = HMM_MAX_WORDS, oov = true } = {}
) {
  return withLanguages(createBuilder(model), languages, { maxWords, oov });
}

const networks = new WeakMap();

/**
 * Keep the most recent vocabulary configuration per model. Overlapping
 * language lists share the same trees, including between batch and stream.
 */
export function getNetwork(
  model,
  languages,
  { maxWords = HMM_MAX_WORDS, oov = true } = {}
) {
  const revision = lexiconRevision();
  let cached = networks.get(model);
  const current = cached?.builder.network.trees;
  if (
    !cached ||
    cached.revision !== revision ||
    cached.maxWords !== maxWords ||
    cached.oov !== oov ||
    (current.size > 0 && !languages.some((lang) => current.has(lang)))
  ) {
    cached = { revision, maxWords, oov, builder: createBuilder(model) };
    networks.set(model, cached);
  }
  const prepared =
    revision === 0 &&
    oov &&
    maxWords === HMM_MAX_WORDS &&
    readPrepared &&
    model === getHmmModel();
  return withLanguages(cached.builder, languages, { maxWords, oov, prepared });
}
