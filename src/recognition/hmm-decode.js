/* eslint-disable complexity, max-statements */
/**
 * Viterbi token passing over the word network of the Gaussian HMM
 * recogniser, with the shipped word bigrams, beam and histogram pruning,
 * then a forced alignment of the best words for phone times. Unlicense.
 */
import { createFrontier } from './hmm-frontier.js';
import { stateIndex, stateScore, toneUnits } from './hmm-model.js';

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

/** ln p of a shipped bigram cost (the costs are 0.5 - 0.3 ln p). */
const lnProbability = (cost) => -(cost - 0.5) / 0.3;

/**
 * Tone-stream score of each tone mixture at frame t: the weight times the
 * log posterior of its tone class among the classes of its state, 0 for
 * the mixture of the states without a tone (hmm-tone.js).
 */
function toneCache(tone, feats, weight) {
  const { states, stateOfKey } = tone;
  const scores = new Float64Array(states);
  const peak = new Float64Array(3);
  const sum = new Float64Array(3);
  let frame = -1;
  return (key, t) => {
    if (frame !== t) {
      frame = t;
      peak.fill(-Infinity);
      sum.fill(0);
      for (let k = 0; k < states; k++) {
        const s = stateOfKey[k];
        if (s >= 0) {
          scores[k] = stateScore(k, feats, t * tone.dims, tone);
          peak[s] = Math.max(peak[s], scores[k]);
        }
      }
      for (let k = 0; k < states; k++) {
        const s = stateOfKey[k];
        if (s >= 0) {
          sum[s] += Math.exp(scores[k] - peak[s]);
        }
      }
      for (let k = 0; k < states; k++) {
        const s = stateOfKey[k];
        scores[k] =
          s < 0 ? 0 : weight * (scores[k] - peak[s] - Math.log(sum[s]));
      }
    }
    return scores[key];
  };
}

function emissionWorkspace(model) {
  return {
    stamp: new Int32Array(model.states),
    value: new Float64Array(model.states),
  };
}

function emissionCache(
  model,
  feats,
  { tone, toneWeight },
  { stamp, value } = emissionWorkspace(model)
) {
  stamp.fill(-1);
  const toneScore =
    tone && model.tone && toneWeight
      ? toneCache(model.tone, tone, toneWeight)
      : null;
  const ofTone = model.tone?.ofState;
  return (m, t) => {
    if (stamp[m] !== t) {
      stamp[m] = t;
      value[m] = stateScore(m, feats, t * model.dims, model);
      if (toneScore) {
        value[m] += toneScore(ofTone[m], t);
      }
    }
    return value[m];
  };
}

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
    add({ id, language, before, prev, start, score }, end) {
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
  };
}

function languageModel(
  network,
  records,
  settings,
  { histories, candidates, costs }
) {
  const { lmw, wip, oovPhone, oovWeight, minCount } = settings;
  const { words } = network;
  const mask = candidates.length - 1;
  candidates.fill(0);
  return (hist, id, tree) => {
    const { wordTable: packed, data, loop } = tree;
    const history = records.columns.id[hist] ?? -1;
    if (packed ? packed.oov(id) : words[id].oov) {
      const beginning = packed ? packed.begin(id) : words[id].begin;
      const phone = previousPhone(packed, words, id);
      const before = beginning ? '' : previousPhone(packed, words, history);
      return oovWeight * loop.bigram.get(before).get(phone) + oovPhone;
    }
    const slot =
      (Math.imul(history, 0x9e3779b1) ^ Math.imul(id, 0x85ebca6b)) & mask;
    if (histories[slot] === history && candidates[slot] === id + 1) {
      return costs[slot];
    }
    const word = packed ? packed.name(id) : words[id].word;
    const count = packed ? packed.count(id) : words[id].count;
    const previous =
      history < 0 ? null : packed ? packed.name(history) : words[history].word;
    const seen = previous ? data.transitionCost(word, previous) : undefined;
    const cost =
      seen ??
      -0.3 * Math.log((0.4 * Math.max(count ?? 1, minCount)) / data.total) +
        0.5;
    const value = lmw * lnProbability(cost) + wip;
    histories[slot] = history;
    candidates[slot] = id + 1;
    costs[slot] = value;
    return value;
  };
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
  const seed = { id: -1, language: 0, before: 0, prev: -1, start: 0, score: 0 };
  for (const lang of languages) {
    const tree = network.trees.get(lang);
    seed.language = network.languages.indexOf(lang);
    const startRecord = records.add(seed, 0);
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
function restart(next, network, records, rec, end, settings) {
  const { lmw, silencePenalty, oovStart } = settings;
  const { id, language, before, score } = rec;
  const r = records.add(rec, end);
  const tree = network.trees.get(network.languages[language]);
  const { lookLn } = network.nodes;
  if (before) {
    for (const child of tree.after.get(before)) {
      next.enter(child, score + lmw * lookLn[child], r, end);
    }
    return;
  }
  for (const child of tree.root) {
    next.enter(child, score + lmw * lookLn[child], r, end);
  }
  for (const node of tree.loop.begin) {
    next.enter(node, score + oovStart, r, end);
  }
  if (tree.wordTable ? tree.wordTable.oov(id) : network.words[id].oov) {
    for (const node of tree.loop.next) {
      next.enter(node, score, r, end);
    }
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
    peaks: new Float64Array(languageCount),
    thresholds: new Float64Array(languageCount),
  };
}

/**
 * Pruning threshold of each language at one frame: `beam` below its own
 * best token, at most `languageBeam` below the best of all, and its
 * `maxActive` best nodes.
 */
export function createThresholds(
  nodes,
  languageCount,
  settings,
  { rows, sizes, peaks, thresholds } = thresholdWorkspace(languageCount)
) {
  const { beam, languageBeam, maxActive } = settings;
  return (work, scores, length, best) => {
    sizes.fill(0);
    peaks.fill(-Infinity);
    for (let i = 0; i < length; i++) {
      const language = nodes[work[i]];
      const score = scores[i];
      const size = sizes[language]++;
      if (size === rows[language].length) {
        const expanded = new Float64Array(size * 2);
        expanded.set(rows[language]);
        rows[language] = expanded;
      }
      rows[language][size] = score;
      peaks[language] = Math.max(peaks[language], score);
    }
    for (let i = 0; i < languageCount; i++) {
      let threshold = Math.max(peaks[i] - beam, best - languageBeam);
      if (sizes[i] > maxActive) {
        threshold = Math.max(
          threshold,
          scoreAtRank(rows[i], sizes[i], sizes[i] - maxActive)
        );
      }
      thresholds[i] = threshold;
    }
    return thresholds;
  };
}

// Only the nodes visited by the beam need state scores and history.
function stateFrame(rows) {
  return {
    scores: new Float64Array(6 * rows),
    histories: new Int32Array(6 * rows),
    starts: new Int32Array(6 * rows),
  };
}

function createWorkspace({ nodeCount, model, languages }) {
  return {
    positions: new Uint32Array(nodeCount),
    previous: stateFrame(256),
    current: stateFrame(256),
    entries: createFrontier(nodeCount),
    next: createFrontier(nodeCount),
    work: [],
    processed: [],
    records: createWordHistory(),
    transitions: transitionCache(),
    histogram: thresholdWorkspace(languages.length),
    emission: emissionWorkspace(model),
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
export function decodeWords(network, feats, frames, options = {}) {
  const prior = workspaces.get(network.model);
  const workspace =
    prior?.positions.length >= network.nodeCount &&
    prior.histogram.rows.length >= network.languages.length
      ? prior
      : createWorkspace(network);
  // A word-end callback can start another decode synchronously.
  workspaces.delete(network.model);
  try {
    return decodeWithWorkspace(network, feats, frames, options, workspace);
  } finally {
    workspace.entries.clear();
    workspace.next.clear();
    workspace.records.clear();
    workspaces.set(network.model, workspace);
  }
}

// Keep the order of emission, pruning and word ends explicit in the loop.
// eslint-disable-next-line max-lines-per-function
function decodeWithWorkspace(network, feats, frames, options, workspace) {
  const settings = { ...HMM_DECODE_DEFAULTS, ...options };
  const { lmw, releaseSkip, oovStart } = settings;
  const languages = settings.languages ?? [...network.trees.keys()];
  const { nodes, words, emit, trees, wordId, nextWord } = network;
  const { stay, go } = network.model;
  const { first, count, optional, child, sibling, terminal, lookLn } = nodes;
  const score = emissionCache(
    network.model,
    feats,
    settings,
    workspace.emission
  );
  let { previous, current, entries, next } = workspace;
  const { positions, work, processed, records } = workspace;
  positions.fill(0);
  const lm = languageModel(network, records, settings, workspace.transitions);
  const thresholdsOf = createThresholds(
    nodes.language,
    network.languages.length,
    settings,
    workspace.histogram
  );
  initialEntries(entries, network, records, languages, settings);
  let active = 0;
  const wordEnds = [];
  const endings = Array.from({ length: network.languages.length * 5 }, () => ({
    frame: -1,
  }));
  for (let t = 0; t < frames; t++) {
    let length = active;
    for (let i = 0; i < entries.length; i++) {
      const id = entries.nodes[i];
      if (positions[id] === 0) {
        work[length++] = id;
      }
    }
    if (current.scores.length < 6 * length) {
      current = stateFrame(Math.max(length, current.scores.length / 3));
    }
    const { scores, histories, starts } = current;
    let best = -Infinity;
    for (let index = 0; index < length; index++) {
      const id = work[index];
      const f = first[id];
      const wasActive = index < active;
      const prior = (positions[id] - 1) * 6;
      const offset = index * 6;
      const entry = entries.at(id);
      let nodeBest = -Infinity;
      for (let i = 0; i < count[id]; i++) {
        const j = prior + i;
        const state = f + i;
        let s = -Infinity;
        let hist = 0;
        let start = 0;
        if (wasActive) {
          s = previous.scores[j] + stay[emit[state]];
          hist = previous.histories[j];
          start = previous.starts[j];
          if (i > 0 && previous.scores[j - 1] + go[emit[state - 1]] > s) {
            s = previous.scores[j - 1] + go[emit[state - 1]];
            hist = previous.histories[j - 1];
            start = previous.starts[j - 1];
          }
        }
        if (i === 0 && entry >= 0 && entries.scores[entry] > s) {
          s = entries.scores[entry];
          hist = entries.histories[entry];
          start = entries.starts[entry];
        }
        if (s > -Infinity) {
          s += score(emit[state], t);
        }
        scores[offset + i] = s;
        histories[offset + i] = hist;
        starts[offset + i] = start;
        nodeBest = Math.max(nodeBest, s);
      }
      best = Math.max(best, nodeBest);
      processed[index] = nodeBest;
    }
    const thresholds = thresholdsOf(work, processed, length, best);
    for (let i = 0; i < active; i++) {
      positions[work[i]] = 0;
    }
    active = 0;
    wordEnds.length = 0;
    for (let index = 0; index < length; index++) {
      const id = work[index];
      const language = nodes.language[id];
      const threshold = thresholds[language];
      if (processed[index] < threshold) {
        continue;
      }
      const offset = index * 6;
      for (let i = 0; i < count[id]; i++) {
        if (scores[offset + i] < threshold) {
          scores[offset + i] = -Infinity;
        }
      }
      positions[id] = index + 1;
      work[active++] = id;
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
      if (exit < threshold) {
        continue;
      }
      const lang = network.languages[language];
      const tree = trees.get(lang);
      if (id === tree.silence) {
        // Silence returns to the root with the same history.
        for (const child of tree.root) {
          next.enter(child, exit + lmw * lookLn[child], hist, t + 1);
        }
        for (const loopNode of tree.loop.begin) {
          next.enter(loopNode, exit + oovStart, hist, t + 1);
        }
        continue;
      }
      const look = lmw * lookLn[id];
      for (let kid = child[id]; kid; kid = sibling[kid]) {
        next.enter(kid, exit + lmw * lookLn[kid] - look, hist, start);
      }
      for (let link = terminal[id]; link; link = nextWord[link]) {
        const wid = wordId[link];
        const s = exit - look + lm(hist, wid, tree);
        settings.onWordEnd?.(wid, s - best, start, t + 1);
        const packed = tree.wordTable;
        const before = packed ? packed.before(wid) : words[wid].before;
        // One word end per language and frame, apart for sandhi variants.
        const end = endings[language * 5 + (before ?? 0)];
        if (end.frame !== t) {
          end.frame = t;
          end.score = -Infinity;
          wordEnds.push(end);
        } else if (!(s > end.score)) {
          continue;
        }
        end.score = s;
        end.language = language;
        end.before = before;
        end.id = wid;
        end.prev = hist;
        end.start = start;
      }
    }
    for (const end of wordEnds) {
      if (end.score >= thresholds[end.language]) {
        restart(next, network, records, end, t + 1, settings);
      }
    }
    entries.clear();
    const finished = entries;
    entries = next;
    next = finished;
    const completed = previous;
    previous = current;
    current = completed;
  }
  const { best, score: bestScore } = finalRecord(
    network,
    records,
    languages,
    frames,
    {
      positions,
      ...previous,
    }
  );
  workspace.previous = previous;
  workspace.current = current;
  return {
    words: backtrace(network, records, best),
    score: bestScore,
    lang: network.languages[records.columns.language[best]] ?? null,
  };
}

function alignmentChain(model, words) {
  const chain = [];
  const tokens = [];
  const pushUnit = (unit, token, skippable, left = null, right = null) => {
    for (let s = 0; s < 3; s++) {
      const m = stateIndex(model, unit, s, left, right);
      chain.push({
        m,
        stay: model.stay[m],
        go: model.go[m],
        token,
        skippable: skippable && s === 0,
        sil: unit === 'sil',
      });
    }
  };
  pushUnit('sil', -1, true);
  words.forEach((w, wi) => {
    w.tokens.forEach((t, i) => {
      const left = i ? w.tokens[i - 1].symbol : null;
      const right = i + 1 < w.tokens.length ? w.tokens[i + 1].symbol : null;
      const unit = w.units[i];
      pushUnit(unit, tokens.length, false, left, right);
      if (model.ciIndex.has(`${unit}_r#0`)) {
        pushUnit(`${unit}_r`, tokens.length, true, left, right);
      }
      tokens.push({ word: wi, token: t });
    });
    pushUnit('sil', -1, true);
  });
  return { chain, tokens };
}

function alignmentColumns(chain) {
  const stay = new Float64Array(chain.length);
  const go = new Float64Array(chain.length);
  const emit = new Array(chain.length);
  const skip = new Uint8Array(chain.length);
  for (let n = 0; n < chain.length; n++) {
    const state = chain[n];
    stay[n] = state.stay;
    go[n] = state.go;
    emit[n] = state.m;
    if (n >= 4 && chain[n - 3].skippable) {
      skip[n] = chain[n - 3].sil ? 1 : 2;
    }
  }
  return { stay, go, emit, skip };
}

/**
 * Forced alignment of the decoded words with optional silence between
 * them and optional stop releases; returns per-token frame ranges.
 * `options.tone` adds the tone stream, as for decodeWords.
 */
export function alignWords(network, feats, frames, words, options = {}) {
  const settings = { ...HMM_DECODE_DEFAULTS, ...options };
  const { silencePenalty } = settings;
  const { model } = network;
  const { chain, tokens } = alignmentChain(model, words);
  const score = emissionCache(model, feats, settings);
  const N = chain.length;
  const { stay, go, emit, skip } = alignmentColumns(chain);
  let prev = new Float64Array(N).fill(-Infinity);
  let cur = new Float64Array(N);
  // A predecessor can stay, advance by one, or skip three states. Store
  // those three choices in two bits per cell.
  const back = new Uint8Array(Math.ceil((frames * N) / 4));
  if (frames > 0) {
    prev[0] = 0 + score(emit[0], 0);
    if (chain[0].skippable && N > 3) {
      prev[3] =
        silencePenalty > -Infinity
          ? silencePenalty + score(emit[3], 0)
          : silencePenalty;
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
        s += score(emit[n], t);
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
  const spans = tokens.map(() => [Infinity, -Infinity]);
  for (let t = frames - 1; t >= 0 && at >= 0; t--) {
    const ti = chain[at].token;
    if (ti >= 0) {
      spans[ti][0] = Math.min(spans[ti][0], t);
      spans[ti][1] = Math.max(spans[ti][1], t + 1);
    }
    const cell = t * N + at;
    const step = (back[Math.floor(cell / 4)] >> ((cell % 4) * 2)) & 3;
    at -= step === 2 ? 4 : step;
  }
  return tokens.map((tk, i) => ({ ...tk, from: spans[i][0], to: spans[i][1] }));
}
