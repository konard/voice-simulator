/* eslint-disable complexity, max-statements */
/**
 * Viterbi token passing over the word network of the Gaussian HMM
 * recogniser, with the shipped word bigrams, beam and histogram pruning,
 * then a forced alignment of the best words for phone times. Unlicense.
 */
import { Frontier } from './hmm-frontier.js';
import { scoreFrame } from './hmm-frame.js';
import { stateIndex, toneUnits } from './hmm-model.js';
import { EmissionCache } from './hmm-emissions.js';

export const HMM_DECODE_DEFAULTS = Object.freeze({
  // Beam of each language against its own best token: the languages share
  // no words, so a fixed beam over all of them let one language's tokens
  // crowd out the right one long before the sentence ended (the 3D tiers
  // decoded English as Mandarin). A language goes only once its best token
  // falls `languageBeam` behind the best of all.
  beam: 120,
  languageBeam: 400,
  lmw: 8,
  wip: -4,
  silencePenalty: -2,
  releaseSkip: -1,
  maxActive: 6000,
  // A word outside the vocabulary: its start, each phone, and the weight
  // of the phone bigram of the loop.
  oovStart: -60,
  oovPhone: -4,
  oovWeight: 8,
  // Weight of the tone stream (hmm-tone.js) against the spectral one; it
  // applies when `tone` features are given.
  toneWeight: 2,
  // Count of a lexicon word the count corpus never saw (it has count 1,
  // SOURCES.md), for its unigram backoff.
  minCount: 3,
});

// Keep fewer competing paths per language on the low phrase search.
export const HMM_LOW_SEARCH = Object.freeze({
  beam: 65,
  languageBeam: 170,
  maxActive: 256,
});

// Whole recordings need more paths than the independently decoded phrases.
export const HMM_LOW_BATCH_SEARCH = Object.freeze({
  ...HMM_LOW_SEARCH,
  maxActive: 480,
});

// Keep the same within-language beam while limiting work on competing languages.
export const HMM_LOW_MULTILINGUAL_SEARCH = Object.freeze({
  ...HMM_LOW_BATCH_SEARCH,
  languageBeam: 120,
  maxActive: 384,
});

/** ln p of a shipped bigram cost (the costs are 0.5 - 0.3 ln p). */
const lnProbability = (cost) => -(cost - 0.5) / 0.3;

function createWordHistory() {
  const columns = {
    id: new Int32Array(256),
    language: new Uint8Array(256),
    before: new Uint8Array(256),
    prev: new Int32Array(256),
    start: new Int32Array(256),
    end: new Int32Array(256),
    score: new Float64Array(256),
  };
  let length = 0;
  return {
    columns,
    get length() {
      return length;
    },
    clear() {
      length = 0;
    },
    add({ id, language, before, prev, start }, end, score) {
      const row = length++;
      if (row === columns.id.length) {
        for (const [name, column] of Object.entries(columns)) {
          const grown = new column.constructor(row * 2);
          grown.set(column);
          columns[name] = grown;
        }
      }
      columns.id[row] = id;
      columns.language[row] = language;
      columns.before[row] = before;
      columns.prev[row] = prev;
      columns.start[row] = start;
      columns.end[row] = end;
      columns.score[row] = score;
      return row;
    },
  };
}

function transitionCache() {
  // A bounded pair cache with no per-candidate allocations. Different
  // pronunciation IDs can spell the same word and get the same score.
  const capacity = 16384;
  return {
    histories: new Int32Array(capacity),
    candidates: new Uint32Array(capacity),
    costs: new Float64Array(capacity),
    unigramIds: new Uint32Array(capacity),
    unigramCosts: new Float64Array(capacity),
  };
}

function languageModel(network, records, settings, cache) {
  const { lmw, wip, oovPhone, oovWeight, minCount } = settings;
  const { words } = network;
  const weights = cache.weights;
  if (
    cache.words?.deref() !== words ||
    weights.lmw !== lmw ||
    weights.wip !== wip ||
    weights.oovPhone !== oovPhone ||
    weights.oovWeight !== oovWeight ||
    weights.minCount !== minCount
  ) {
    // The shared graph can append new words without changing existing IDs.
    // Keep scores for its existing words without retaining a retired graph.
    cache.words = new WeakRef(words);
    cache.weights = { lmw, wip, oovPhone, oovWeight, minCount };
    cache.candidates.fill(0);
    cache.unigramIds.fill(0);
  }
  return { words, records, cache, lmw, wip, oovPhone, oovWeight, minCount };
}

function unigramSlot({ words, cache, minCount, lmw, wip }, id, packed, data) {
  const { unigramIds, unigramCosts } = cache;
  const slot = id & (unigramIds.length - 1);
  if (unigramIds[slot] !== id + 1) {
    const count = packed ? packed.count(id) : words[id].count;
    const cost =
      -0.3 * Math.log((0.4 * Math.max(count ?? 1, minCount)) / data.total) +
      0.5;
    unigramIds[slot] = id + 1;
    unigramCosts[slot] = lmw * lnProbability(cost) + wip;
  }
  return slot;
}

function writeTransitionScore(lm, history, id, tree, slot) {
  const { words, cache, lmw, wip, oovPhone, oovWeight } = lm;
  const { costs, unigramCosts } = cache;
  const { wordTable: packed, data, loop } = tree;
  if (packed ? packed.oov(id) : words[id].oov) {
    const beginning = packed ? packed.begin(id) : words[id].begin;
    const phone = previousPhone(packed, words, id);
    const before = beginning ? '' : previousPhone(packed, words, history);
    costs[slot] = oovWeight * loop.bigram.get(before).get(phone) + oovPhone;
  } else {
    const seen = transitionCost(packed, data, words, id, history);
    costs[slot] =
      seen === undefined || seen === null
        ? unigramCosts[unigramSlot(lm, id, packed, data)]
        : lmw * lnProbability(seen) + wip;
  }
}

function wordScoreSlot(lm, hist, id, tree) {
  const { histories, candidates } = lm.cache;
  const history = lm.records.columns.id[hist] ?? -1;
  const slot =
    (Math.imul(history, 0x9e3779b1) ^ Math.imul(id, 0x85ebca6b)) &
    (candidates.length - 1);
  if (histories[slot] !== history || candidates[slot] !== id + 1) {
    writeTransitionScore(lm, history, id, tree, slot);
    histories[slot] = history;
    candidates[slot] = id + 1;
  }
  return slot;
}

function transitionCost(packed, data, words, id, history) {
  if (history < 0) {
    return undefined;
  }
  if (packed) {
    const previous = packed.rank(history);
    return previous >= 0
      ? data.transitionCostAt(packed.rank(id), previous)
      : undefined;
  }
  const previous = words[history].word;
  return previous ? data.transitionCost(words[id].word, previous) : undefined;
}

function previousPhone(packed, words, id) {
  return packed ? packed.phone(id) : words[id].units[0];
}

/** Tokens at the roots, loops and silences of every language at frame 0. */
function initialEntries(
  entries,
  network,
  records,
  languages,
  { lmw, oovStart }
) {
  const { lookLn } = network.nodes;
  const seed = { id: -1, language: 0, before: 0, prev: -1, start: 0 };
  for (const lang of languages) {
    const tree = network.trees.get(lang);
    seed.language = network.languages.indexOf(lang);
    const startRecord = records.add(seed, 0, 0);
    for (const node of tree.root) {
      entries.enter(node, lmw * lookLn[node], startRecord, 0);
    }
    for (const node of tree.loop.begin) {
      entries.enter(node, oovStart, startRecord, 0);
    }
    entries.enter(tree.silence, 0, startRecord, 0);
  }
}

/**
 * Record a word end and start the next word, a word outside the vocabulary
 * (or, after a loop phone, the rest of that word) or a silence after it.
 * A rising sandhi variant goes on only with a word of the tone that causes
 * it, without a pause (hmm-network.js toneVariants).
 */
function restart(network, records, rec, score, end, pass) {
  const { next, lookLn, settings } = pass;
  const { lmw, silencePenalty } = settings;
  const { id, language, before } = rec;
  const r = records.add(rec, end, score);
  const tree = pass.trees[language];
  if (before) {
    next.enterWeighted(tree.after.get(before), lookLn, lmw, score, r, end);
    return;
  }
  enterRoots(next, tree, score, r, end, pass);
  if (tree.wordTable ? tree.wordTable.oov(id) : network.words[id].oov) {
    next.enterList(tree.loop.next, score, r, end);
  }
  next.enter(tree.silence, score + silencePenalty, r, end);
}

/** The best word that ended on `end` and needs no following word. */
function bestEndingAt(records, end) {
  const { id, before, end: ends, score } = records.columns;
  let best = -1;
  for (let r = 0; r < records.length; r++) {
    if (
      id[r] >= 0 &&
      ends[r] === end &&
      !before[r] &&
      (best < 0 || score[r] > score[best])
    ) {
      best = r;
    }
  }
  return best;
}

/**
 * Best final: a word that ended at the last frame or a trailing silence.
 * An input cut inside a word (a streaming phrase at its longest) has
 * neither: it keeps the words up to the latest word end (issue 170). Scores
 * of different lengths are not comparable, so that end is only a fallback.
 */
function finalRecord(network, records, languages, frames, last) {
  const { positions, scores, histories } = last;
  const { id, end: ends, score } = records.columns;
  let best = bestEndingAt(records, frames);
  let bestScore = score[best] ?? -Infinity;
  for (const lang of languages) {
    const sil = network.trees.get(lang).silence;
    const position = positions[sil];
    const j = (position - 1) * 6 + 2;
    if (position && scores[j] > bestScore) {
      const h = histories[j];
      if (h >= 0 && id[h] >= 0) {
        best = h;
        bestScore = scores[j];
      }
    }
  }
  if (best >= 0) {
    return { best, score: bestScore };
  }
  let end = -1;
  for (let r = 0; r < records.length; r++) {
    if (id[r] >= 0 && ends[r] < frames && ends[r] > end) {
      end = ends[r];
    }
  }
  best = end < 0 ? -1 : bestEndingAt(records, end);
  return { best, score: score[best] ?? -Infinity };
}

/**
 * Words of the best record back to the start; loop phones that go on with
 * an out-of-vocabulary word join it.
 */
function backtrace(network, records, best) {
  const out = [];
  const { id, language, prev, start, end } = records.columns;
  for (let r = best; r >= 0 && id[r] >= 0; r = prev[r]) {
    const lang = network.languages[language[r]];
    const table = network.trees.get(lang).wordTable;
    const word = table ? table.read(id[r]) : network.words[id[r]];
    const units =
      word.units ??
      (lang === 'zh'
        ? toneUnits(word.tokens)
        : word.tokens.map((token) => token.symbol));
    const w = { ...word, units, start: start[r], end: end[r] };
    const after = out[0];
    if (after?.oov && !after.begin && after.start === w.end) {
      // A loop phone that goes on with the word before it.
      out[0] = {
        ...w,
        tokens: [...w.tokens, ...after.tokens],
        units: [...w.units, ...after.units],
        end: after.end,
      };
    } else {
      out.unshift(w);
    }
  }
  return out;
}

// Partition around the requested rank. The bounded fallback keeps the cost
// predictable for adversarial score orderings.
function scoreAtRank(row, size, rank) {
  if (!Number.isInteger(rank) || rank >= size) {
    return row.subarray(0, size)[rank];
  }
  let left = 0;
  let right = size - 1;
  let attempts = 2 * Math.ceil(Math.log2(size));
  while (left < right) {
    if (attempts-- === 0) {
      row.subarray(left, right + 1).sort();
      break;
    }
    const pivot = row[Math.floor((left + right) / 2)];
    let low = left;
    let high = right;
    while (low <= high) {
      while (row[low] < pivot) {
        low++;
      }
      while (row[high] > pivot) {
        high--;
      }
      if (low <= high) {
        const score = row[low];
        row[low++] = row[high];
        row[high--] = score;
      }
    }
    if (rank <= high) {
      right = high;
    } else if (rank >= low) {
      left = low;
    } else {
      break;
    }
  }
  return row[rank];
}

function thresholdWorkspace(languageCount) {
  return {
    rows: Array.from({ length: languageCount }, () => new Float64Array(256)),
    sizes: new Uint32Array(languageCount),
    totals: new Uint32Array(languageCount),
    peaks: new Float64Array(languageCount),
    thresholds: new Float64Array(languageCount),
  };
}

/** Pruning combines the relative language beams and the active-node limit. */
function frameThresholds(
  { nodes, languageCount, beam, languageBeam, maxActive },
  { rows, sizes, totals, peaks, thresholds },
  work,
  scores,
  length,
  best
) {
  peaks.fill(-Infinity);
  totals.fill(0);
  for (let i = 0; i < length; i++) {
    const language = nodes[work[i]];
    peaks[language] = Math.max(peaks[language], scores[i]);
    totals[language]++;
  }
  const globalThreshold = best - languageBeam;
  for (let i = 0; i < languageCount; i++) {
    thresholds[i] = Math.max(peaks[i] - beam, globalThreshold);
  }
  if (maxActive <= 0 || length <= maxActive) {
    return thresholds;
  }
  // A score already below either beam cannot affect the final threshold.
  sizes.fill(0);
  for (let i = 0; i < length; i++) {
    const language = nodes[work[i]];
    const score = scores[i];
    if (totals[language] <= maxActive || score < thresholds[language]) {
      continue;
    }
    const size = sizes[language]++;
    if (size === rows[language].length) {
      const expanded = new Float64Array(size * 2);
      expanded.set(rows[language]);
      rows[language] = expanded;
    }
    rows[language][size] = score;
  }
  for (let i = 0; i < languageCount; i++) {
    if (sizes[i] >= maxActive) {
      thresholds[i] = Math.max(
        thresholds[i],
        scoreAtRank(rows[i], sizes[i], sizes[i] - maxActive)
      );
    }
  }
  return thresholds;
}

/** Create a reusable threshold selector for independent score columns. */
export function createThresholds(nodes, languageCount, settings) {
  const { beam, languageBeam, maxActive } = settings;
  const beams = { nodes, languageCount, beam, languageBeam, maxActive };
  const histogram = thresholdWorkspace(languageCount);
  return (work, scores, length, best) =>
    frameThresholds(beams, histogram, work, scores, length, best);
}

// Only the nodes visited by the beam need state scores and history.
function stateHistory(rows) {
  return {
    scores: new Float64Array(6 * rows),
    histories: new Int32Array(6 * rows),
    starts: new Int32Array(6 * rows),
  };
}

function growHistory(previous) {
  const grown = stateHistory((previous.scores.length / 6) * 2);
  grown.scores.set(previous.scores);
  grown.histories.set(previous.histories);
  grown.starts.set(previous.starts);
  return grown;
}

function createWorkspace({ nodeCount, model, languages }) {
  return {
    positions: new Uint32Array(nodeCount),
    previous: stateHistory(256),
    current: { state: stateHistory(256), peaks: new Float64Array(256) },
    entries: new Frontier(nodeCount),
    next: new Frontier(nodeCount),
    work: new Uint32Array(256),
    records: createWordHistory(),
    transitions: transitionCache(),
    histogram: thresholdWorkspace(languages.length),
    emission: new EmissionCache(model),
  };
}

const workspaces = new WeakMap();

/**
 * Best word sequence of the frames: words with their tokens, units and
 * frame ranges, the total score and the language of the last word.
 * `options.onWordEnd(id, score, start, end)` sees every word end inside
 * the beam, its score relative to the best token of its last frame.
 * `options.tone` (the `tone` of hmmFeatures) adds the tone stream.
 */
export function decodeWords(network, feats, frames, options = {}, cache) {
  const storage = cache ?? workspaces;
  const key = cache ? network.nodes.language : network.model;
  const prior = storage.get(key);
  const workspace =
    prior?.positions.length >= network.nodeCount &&
    prior.emission.model === network.model &&
    prior.histogram.rows.length >= network.languages.length
      ? prior
      : createWorkspace(network);
  // A word-end callback can start another decode synchronously.
  storage.delete(key);
  try {
    return decodeWithWorkspace(network, feats, frames, options, workspace);
  } finally {
    workspace.emission.clear();
    workspace.entries.clear();
    workspace.next.clear();
    workspace.records.clear();
    cache?.clear?.();
    storage.set(key, workspace);
  }
}

/** Compact the states that survive this frame's language thresholds. */
function retainStates({ count, language }, pass, thresholds) {
  const {
    positions,
    work,
    length,
    active: previousActive,
    current: { peaks, state: available },
    entries: { index: entryIndex, columns: queued },
  } = pass;
  let { scores, histories, starts } = pass.previous;
  for (let i = 0; i < previousActive; i++) {
    positions[work[i]] = 0;
  }
  let active = 0;
  for (let index = 0; index < length; index++) {
    const id = work[index];
    const threshold = thresholds[language[id]];
    if (peaks[index] < threshold) {
      continue;
    }
    const offset = active * 6;
    const states = count[id];
    if (offset === scores.length) {
      pass.previous = growHistory(pass.previous);
      ({ scores, histories, starts } = pass.previous);
    }
    if (index < previousActive) {
      const source = index * 6;
      for (let i = 0; i < states; i++) {
        const score = available.scores[source + i];
        scores[offset + i] = score < threshold ? -Infinity : score;
        histories[offset + i] = available.histories[source + i];
        starts[offset + i] = available.starts[source + i];
      }
    } else {
      // A newly entered node could only emit its first state this frame.
      const entry = entryIndex[id] - 1;
      scores[offset] = peaks[index];
      const entered = queued.scores[entry] > -Infinity;
      histories[offset] = entered ? queued.histories[entry] : 0;
      starts[offset] = entered ? queued.starts[entry] : 0;
      for (let i = 1; i < states; i++) {
        scores[offset + i] = -Infinity;
        histories[offset + i] = 0;
        starts[offset + i] = 0;
      }
    }
    positions[id] = active + 1;
    work[active++] = id;
  }
  pass.active = active;
}

/** Queue transitions and word ends from the compacted states. */
function queueExits(network, pass, thresholds, t) {
  const { nodes, words, emit, wordId, nextWord } = network;
  const { first, count, optional, terminal, lookLn } = nodes;
  const { go } = network.model;
  const {
    work,
    active,
    previous: { scores, histories, starts },
    lm,
    settings,
    next,
    wordEnds,
    endings,
    endingScores,
  } = pass;
  const { lmw, releaseSkip } = settings;
  const transitionCosts = lm.cache.costs;
  const endFrame = t + 1;
  wordEnds.length = 0;
  for (let row = 0; row < active; row++) {
    const id = work[row];
    const offset = row * 6;
    const last = count[id] - 1;
    const firstState = first[id];
    let exit = scores[offset + last] + go[emit[firstState + last]];
    let hist = histories[offset + last];
    let start = starts[offset + last];
    if (optional[id]) {
      const skipped =
        scores[offset + 2] + go[emit[firstState + 2]] + releaseSkip;
      if (skipped > exit) {
        exit = skipped;
        hist = histories[offset + 2];
        start = starts[offset + 2];
      }
    }
    const language = nodes.language[id];
    if (exit < thresholds[language]) {
      continue;
    }
    const tree = pass.trees[language];
    if (id === tree.silence) {
      // Silence returns to the root with the same history.
      enterRoots(next, tree, exit, hist, endFrame, pass);
      continue;
    }
    if (nodes.child[id]) {
      next.enterChildren(id, nodes, lmw, exit, hist, start);
    }
    const packed = tree.wordTable;
    for (let link = terminal[id]; link; link = nextWord[link]) {
      const wid = wordId[link];
      const s =
        exit -
        lmw * lookLn[id] +
        transitionCosts[wordScoreSlot(lm, hist, wid, tree)];
      settings.onWordEnd?.(wid, s - pass.framePeak[0], start, endFrame);
      const before = packed ? packed.before(wid) : words[wid].before;
      // One word end per language and frame, apart for sandhi variants.
      const slot = language * 5 + (before ?? 0);
      const end = endings[slot];
      if (end.frame !== t) {
        end.frame = t;
        wordEnds.push(slot);
      } else if (!(s > endingScores[slot])) {
        continue;
      }
      endingScores[slot] = s;
      end.language = language;
      end.before = before;
      end.id = wid;
      end.prev = hist;
      end.start = start;
    }
  }
}

function enterRoots(next, tree, score, history, frame, { lookLn, settings }) {
  const { lmw, oovStart } = settings;
  const { root, loop } = tree;
  next.enterWeighted(root, lookLn, lmw, score, history, frame);
  next.enterList(loop.begin, score + oovStart, history, frame);
}

function prepareFrame(pass, nodeCount) {
  const { active, entries, positions } = pass;
  let { work } = pass;
  const capacity = Math.min(nodeCount, active + entries.length);
  if (work.length < capacity) {
    const grown = new Uint32Array(Math.max(capacity, 2 * work.length));
    grown.set(work.subarray(0, active));
    pass.work = work = grown;
  }
  const entryNodes = entries.columns.nodes;
  let length = active;
  for (let i = 0; i < entries.length; i++) {
    const id = entryNodes[i];
    if (positions[id] === 0) {
      work[length++] = id;
    }
  }
  const { current } = pass;
  const rows = current.state.scores.length / 6;
  if (rows < active) {
    current.state = stateHistory(Math.max(active, 2 * rows));
  }
  if (current.peaks.length < length) {
    current.peaks = new Float64Array(
      Math.max(length, 2 * current.peaks.length)
    );
  }
  pass.length = length;
}

// Keep the order of emission, pruning and word ends explicit in the loop.
function advanceFrames(network, frames, pass, histogram, records) {
  const { wordEnds, endings, endingScores } = pass;
  const { beam, languageBeam, maxActive } = pass.settings;
  const beams = {
    nodes: network.nodes.language,
    languageCount: network.languages.length,
    beam,
    languageBeam,
    maxActive,
  };
  for (let t = 0; t < frames; t++) {
    prepareFrame(pass, network.nodeCount);
    scoreFrame(network, pass, t);
    const thresholds = frameThresholds(
      beams,
      histogram,
      pass.work,
      pass.current.peaks,
      pass.length,
      pass.framePeak[0]
    );
    retainStates(network.nodes, pass, thresholds);
    queueExits(network, pass, thresholds, t);
    for (let i = 0; i < wordEnds.length; i++) {
      const slot = wordEnds[i];
      const end = endings[slot];
      const score = endingScores[slot];
      if (score >= thresholds[end.language]) {
        restart(network, records, end, score, t + 1, pass);
      }
    }
    const { entries } = pass;
    entries.clear();
    pass.entries = pass.next;
    pass.next = entries;
  }
}

function decodeWithWorkspace(network, feats, frames, options, workspace) {
  const settings = { ...HMM_DECODE_DEFAULTS, ...options };
  const languages = settings.languages ?? [...network.trees.keys()];
  const emissions = workspace.emission;
  emissions.begin(feats, settings);
  const { previous, current, entries, next, positions, records, work } =
    workspace;
  positions.fill(0);
  const lm = languageModel(network, records, settings, workspace.transitions);
  initialEntries(entries, network, records, languages, settings);
  const wordEnds = [];
  const endings = Array.from({ length: network.languages.length * 5 }, () => ({
    frame: -1,
    language: 0,
    before: 0,
    id: 0,
    prev: 0,
    start: 0,
  }));
  const pass = {
    positions,
    work,
    active: 0,
    length: 0,
    previous,
    current,
    entries,
    next,
    wordEnds,
    endings,
    endingScores: new Float64Array(endings.length),
    lookLn: network.nodes.lookLn,
    emissions,
    framePeak: new Float64Array(1),
    lm,
    settings,
    trees: network.languages.map((lang) => network.trees.get(lang)),
  };
  advanceFrames(network, frames, pass, workspace.histogram, records);
  const { best, score: bestScore } = finalRecord(
    network,
    records,
    languages,
    frames,
    {
      positions,
      ...pass.previous,
    }
  );
  workspace.previous = pass.previous;
  workspace.current = pass.current;
  workspace.work = pass.work;
  return {
    words: backtrace(network, records, best),
    score: bestScore,
    lang: network.languages[records.columns.language[best]] ?? null,
  };
}

function alignmentColumns(capacity) {
  return {
    stay: new Float64Array(capacity),
    go: new Float64Array(capacity),
    emit: new Int32Array(capacity),
    token: new Int32Array(capacity),
    skip: new Uint8Array(capacity),
    previous: new Float64Array(capacity),
    current: new Float64Array(capacity),
  };
}

function alignmentChain(model, words, { stay, go, emit, token, skip }) {
  const tokens = [];
  let count = 0;
  function pushUnit(unit, tokenIndex, skipKind, left = null, right = null) {
    if (count >= 1) {
      // The decision to skip this unit is recorded at the state after it.
      skip[count + 3] = skipKind;
    }
    for (let s = 0; s < 3; s++) {
      const m = stateIndex(model, unit, s, left, right);
      stay[count] = model.stay[m];
      go[count] = model.go[m];
      emit[count] = m ?? -1;
      token[count++] = tokenIndex;
    }
  }
  pushUnit('sil', -1, 1);
  words.forEach((w, wi) => {
    w.tokens.forEach((t, i) => {
      const left = i ? w.tokens[i - 1].symbol : null;
      const right = i + 1 < w.tokens.length ? w.tokens[i + 1].symbol : null;
      const unit = w.units[i];
      pushUnit(unit, tokens.length, 0, left, right);
      if (model.ciIndex.has(`${unit}_r#0`)) {
        pushUnit(`${unit}_r`, tokens.length, 2, left, right);
      }
      tokens.push({ word: wi, token: t, from: Infinity, to: -Infinity });
    });
    pushUnit('sil', -1, 1);
  });
  return { count, tokens };
}

const alignmentWorkspaces = new WeakMap();
const MAX_CACHED_TRACE_BYTES = 4 * 1024 * 1024;
const MAX_CACHED_ALIGNMENT_STATES = 4096;

/**
 * Forced alignment of the decoded words with optional silence between
 * them and optional stop releases; returns per-token frame ranges.
 * `options.tone` adds the tone stream, as for decodeWords.
 */
export function alignWords(network, feats, frames, words, options = {}) {
  const { model } = network;
  const workspace = alignmentWorkspaces.get(model) ?? {
    emission: new EmissionCache(model),
    back: new Uint8Array(0),
    columns: alignmentColumns(0),
  };
  // A score callback can align a different utterance using the same model.
  alignmentWorkspaces.delete(model);
  try {
    return alignWithWorkspace(model, feats, frames, words, options, workspace);
  } finally {
    workspace.emission.clear();
    alignmentWorkspaces.set(model, workspace);
  }
}

function alignWithWorkspace(model, feats, frames, words, options, workspace) {
  const settings = { ...HMM_DECODE_DEFAULTS, ...options };
  const { silencePenalty } = settings;
  // Each word is followed by silence, and each phone may have a release.
  let capacity = 3;
  words.forEach(({ tokens }) => {
    capacity += 3 + 6 * tokens.length;
  });
  let { columns } = workspace;
  if (capacity > columns.stay.length) {
    if (capacity <= MAX_CACHED_ALIGNMENT_STATES) {
      columns = alignmentColumns(
        Math.min(
          MAX_CACHED_ALIGNMENT_STATES,
          Math.max(capacity, columns.stay.length * 2)
        )
      );
      workspace.columns = columns;
    } else {
      columns = alignmentColumns(capacity);
    }
  }
  const { stay, go, emit, token, skip } = columns;
  skip.fill(0, 0, capacity);
  const { count: N, tokens } = alignmentChain(model, words, columns);
  const cache = workspace.emission;
  cache.begin(feats, settings);
  const { stamp, value: emissions } = cache;
  let { previous: prev, current: cur } = columns;
  prev.fill(-Infinity, 0, N);
  // A predecessor can stay, advance by one, or skip three states. Store
  // those three choices in two bits per cell.
  const bytes = Math.ceil((frames * N) / 4);
  let { back } = workspace;
  if (back.length >= bytes) {
    back.fill(0, 0, bytes);
  } else if (bytes <= MAX_CACHED_TRACE_BYTES) {
    back = new Uint8Array(
      Math.min(MAX_CACHED_TRACE_BYTES, Math.max(bytes, back.length * 2))
    );
    workspace.back = back;
  } else {
    back = new Uint8Array(bytes);
  }
  if (frames > 0) {
    cache.evaluate(emit[0], 0);
    prev[0] = 0 + emissions[emit[0]];
    if (N > 3) {
      prev[3] = silencePenalty;
      if (silencePenalty > -Infinity) {
        if (stamp[emit[3]] !== 0) {
          cache.evaluate(emit[3], 0);
        }
        prev[3] += emissions[emit[3]];
      }
    }
  }
  for (let t = 1; t < frames; t++) {
    const row = t * N;
    for (let n = 0; n < N; n++) {
      let s = prev[n] + stay[n];
      let step = 0;
      if (n > 0) {
        const advance = prev[n - 1] + go[n - 1];
        if (advance > s) {
          s = advance;
          step = 1;
        }
      }
      if (skip[n]) {
        const jump = prev[n - 4] + go[n - 4] + (1 - skip[n]);
        if (jump > s) {
          s = jump;
          step = 2;
        }
      }
      if (s > -Infinity) {
        const state = emit[n];
        if (stamp[state] !== t) {
          cache.evaluate(state, t);
        }
        s += emissions[state];
      }
      cur[n] = s;
      if (step) {
        const cell = row + n;
        back[Math.floor(cell / 4)] |= step << ((cell % 4) * 2);
      }
    }
    const earlier = prev;
    prev = cur;
    cur = earlier;
  }
  let at = prev[N - 4] > prev[N - 1] ? N - 4 : N - 1;
  options.onScore?.(prev[at]);
  for (let t = frames - 1; t >= 0 && at >= 0; t--) {
    const span = tokens[token[at]];
    if (span) {
      span.from = Math.min(span.from, t);
      span.to = Math.max(span.to, t + 1);
    }
    const cell = t * N + at;
    const step = (back[Math.floor(cell / 4)] >> ((cell % 4) * 2)) & 3;
    at -= step === 2 ? 4 : step;
  }
  return tokens;
}
