/* eslint-disable complexity */
/**
 * Viterbi token passing over the word network of the Gaussian HMM
 * recogniser, with the shipped word bigrams, beam and histogram pruning,
 * then a forced alignment of the best words for phone times. Unlicense.
 */
import { stateIndex, stateScore } from './hmm-model.js';

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

// The low search keeps fewer competing paths per language. It uses the same
// pronunciation network, acoustic model and alignment as the wider search.
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

function emissionCache(model, feats, { tone, toneWeight }) {
  const stamp = new Int32Array(model.states).fill(-1);
  const value = new Float64Array(model.states);
  const toneScore =
    tone && model.tone && toneWeight
      ? toneCache(model.tone, tone, toneWeight)
      : null;
  const ofTone = model.tone?.ofState;
  const toneStates = model.tone?.stateOfKey;
  return (m, t) => {
    if (stamp[m] !== t) {
      stamp[m] = t;
      value[m] = stateScore(m, feats, t * model.dims, model);
      if (toneScore && toneStates[ofTone[m]] >= 0) {
        value[m] += toneScore(ofTone[m], t);
      }
    }
    return value[m];
  };
}

function languageModel(network, records, settings, buffers) {
  const { lmw, wip, oovPhone, oovWeight, minCount } = settings;
  const { words, trees } = network;
  const { predecessor, wordScores: scores, unigram } = buffers;
  predecessor.fill(undefined);
  unigram.fill(0);
  return (hist, id) => {
    const w = words[id];
    if (w.oov) {
      const before = w.begin ? '' : words[records[hist].id].units[0];
      const row = trees.get(w.lang).loop.bigram.get(before);
      return oovWeight * row.get(w.units[0]) + oovPhone;
    }
    const previous = hist >= 0 ? records[hist].word || null : null;
    if (predecessor[id] !== previous) {
      const data = trees.get(w.lang).data;
      const cost = previous
        ? data.transitionRow(w.word)?.get(previous)
        : undefined;
      if (cost === undefined) {
        unigram[id] ||= lnProbability(
          -0.3 *
            Math.log((0.4 * Math.max(w.count ?? 1, minCount)) / data.total) +
            0.5
        );
      }
      scores[id] =
        lmw * (cost === undefined ? unigram[id] : lnProbability(cost)) + wip;
      predecessor[id] = previous;
    }
    return scores[id];
  };
}

function entryQueue(count) {
  const ids = [];
  const score = new Float64Array(count);
  const queued = new Uint8Array(count);
  const history = new Int32Array(count);
  const start = new Int32Array(count);
  function enter(id, value, hist, from) {
    if (!queued[id]) {
      queued[id] = 1;
      ids.push(id);
    } else if (!(value > score[id])) {
      return;
    }
    score[id] = value;
    history[id] = hist;
    start[id] = from;
  }
  return { ids, queued, score, history, start, enter };
}

/** Tokens at the roots, loops and silences of every language at frame 0. */
function initialEntries(network, records, languages, { lmw, oovStart }, enter) {
  for (const lang of languages) {
    const tree = network.trees.get(lang);
    const startRecord = records.length;
    records.push({ word: null, lang, prev: -1, start: 0, end: 0, score: 0 });
    for (const id of tree.root) {
      enter(id, lmw * network.look[id], startRecord, 0);
    }
    for (const id of tree.loop.begin) {
      enter(id, oovStart, startRecord, 0);
    }
    enter(tree.silence, 0, startRecord, 0);
  }
}

/**
 * Record a word end and start the next word, a word outside the vocabulary
 * (or, after a loop phone, the rest of that word) or a silence after it.
 * A rising sandhi variant goes on only with a word of the tone that causes
 * it, without a pause (hmm-network.js toneVariants).
 */
function restart(enter, network, records, rec, settings) {
  const { lmw, silencePenalty, oovStart } = settings;
  const r = records.length;
  records.push(rec);
  const tree = network.trees.get(rec.lang);
  const before = network.words[rec.id].before;
  if (before) {
    for (const id of tree.after.get(before)) {
      enter(id, rec.score + lmw * network.look[id], r, rec.end);
    }
    return;
  }
  for (const id of tree.root) {
    enter(id, rec.score + lmw * network.look[id], r, rec.end);
  }
  for (const id of tree.loop.begin) {
    enter(id, rec.score + oovStart, r, rec.end);
  }
  if (rec.oov) {
    for (const id of tree.loop.next) {
      enter(id, rec.score, r, rec.end);
    }
  }
  enter(tree.silence, rec.score + silencePenalty, r, rec.end);
}

/** The best word that ended on `end` and needs no following word. */
function bestEndingAt(network, records, end) {
  let best = null;
  for (const r of records) {
    if (
      r.word !== null &&
      r.end === end &&
      !network.words[r.id].before &&
      (!best || r.score > best.score)
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
  const { stamp, offsets, prev, prevHist } = last;
  let best = bestEndingAt(network, records, frames);
  for (const lang of languages) {
    const sil = network.trees.get(lang).silence;
    const j = offsets[sil] + 2;
    if (stamp[sil] === frames - 1 && prev[j] > (best?.score ?? -Infinity)) {
      const h = prevHist[j];
      if (h >= 0 && records[h].word !== null) {
        best = { ...records[h], score: prev[j] };
      }
    }
  }
  if (best) {
    return best;
  }
  let end = -1;
  for (const r of records) {
    if (r.word !== null && r.end < frames && r.end > end) {
      end = r.end;
    }
  }
  return end < 0 ? null : bestEndingAt(network, records, end);
}

/**
 * Words of the best record back to the start; loop phones that go on with
 * an out-of-vocabulary word join it.
 */
function backtrace(words, records, best) {
  const out = [];
  for (let r = best; r && r.word !== null; r = records[r.prev] ?? null) {
    const w = { ...words[r.id], start: r.start, end: r.end };
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

/** The score of the nth best node, with ties retained by the caller. */
function selectScore(scores, nth) {
  let low = 0;
  let high = scores.length - 1;
  while (low < high) {
    const pivot = scores[(low + high) >>> 1];
    let left = low;
    let right = high;
    let current = low;
    // Partition higher scores, ties, and lower scores in place.
    while (current <= right) {
      const score = scores[current];
      if (score > pivot) {
        scores[current++] = scores[left];
        scores[left++] = score;
      } else if (score < pivot) {
        scores[current] = scores[right];
        scores[right--] = score;
      } else {
        current++;
      }
    }
    if (nth < left) {
      high = left - 1;
    } else if (nth > right) {
      low = right + 1;
    } else {
      return pivot;
    }
  }
  return scores[nth];
}

/**
 * Per-language beam against its own best score, subject to the global
 * language beam and the existing per-language histogram limit. Only nodes
 * within both beams can affect the histogram threshold.
 */
export function languageThresholds(
  language,
  { work, nodeScores, languageBest, buckets, thresholds },
  best,
  { beam, languageBeam, maxActive }
) {
  for (let i = 0; i < languageBest.length; i++) {
    thresholds[i] = Math.max(languageBest[i] - beam, best - languageBeam);
    buckets[i].length = 0;
  }
  if (maxActive <= 0 || work.length <= maxActive) {
    return;
  }
  for (let i = 0; i < work.length; i++) {
    const lang = language[work[i]];
    if (nodeScores[i] >= thresholds[lang]) {
      buckets[lang].push(nodeScores[i]);
    }
  }
  for (let i = 0; i < buckets.length; i++) {
    if (buckets[i].length > maxActive) {
      thresholds[i] = selectScore(buckets[i], maxActive - 1);
    }
  }
}

const STATES_PER_TOKEN = 6;

function tokenBuffer() {
  return {
    scores: new Float64Array(0),
    history: new Int32Array(0),
    starts: new Int32Array(0),
    reserve(tokens) {
      const size = tokens * STATES_PER_TOKEN;
      if (size > this.scores.length) {
        const capacity = Math.max(size, this.scores.length * 2);
        this.scores = new Float64Array(capacity);
        this.history = new Int32Array(capacity);
        this.starts = new Int32Array(capacity);
      }
    },
  };
}

/** Score the surviving tokens and all new entries, in search order. */
function scoreFrame(network, search, t) {
  const { firstState, emit, language, model } = network;
  const { stay, go } = model;
  const {
    work,
    nodeScores,
    languageBest,
    prev,
    cur,
    stamp,
    offsets,
    entries,
    score,
  } = search;
  for (const id of entries.ids) {
    if (stamp[id] !== t - 1) {
      work.push(id);
    }
  }
  cur.reserve(work.length);
  const { scores, history, starts } = cur;
  const { scores: prevScores, history: prevHistory, starts: prevStarts } = prev;
  const {
    queued,
    score: entryScores,
    history: entryHistory,
    start: entryStarts,
  } = entries;
  let best = -Infinity;
  languageBest.fill(-Infinity);
  for (let k = 0; k < work.length; k++) {
    const id = work[k];
    const first = firstState[id];
    const count = firstState[id + 1] - first;
    const wasActive = stamp[id] === t - 1;
    const old = offsets[id];
    const base = k * STATES_PER_TOKEN;
    const entry = queued[id] ? entryScores[id] : -Infinity;
    let nodeBest;
    if (wasActive) {
      const firstEmission = emit[first];
      const stayFirst = prevScores[old] + stay[firstEmission];
      const enterFirst = entry > stayFirst;
      const firstScore = enterFirst ? entry : stayFirst;
      nodeBest =
        firstScore > -Infinity
          ? firstScore + score(firstEmission, t)
          : firstScore;
      scores[base] = nodeBest;
      history[base] = enterFirst ? entryHistory[id] : prevHistory[old];
      starts[base] = enterFirst ? entryStarts[id] : prevStarts[old];

      let before = firstEmission;
      for (let i = 1; i < count; i++) {
        const j = base + i;
        const m = emit[first + i];
        const previous = old + i;
        let value = prevScores[previous] + stay[m];
        const advance = prevScores[previous - 1] + go[before];
        let source = previous;
        if (advance > value) {
          value = advance;
          source--;
        }
        if (value > -Infinity) {
          value += score(m, t);
        }
        scores[j] = value;
        history[j] = prevHistory[source];
        starts[j] = prevStarts[source];
        nodeBest = Math.max(nodeBest, value);
        before = m;
      }
    } else {
      nodeBest = entry > -Infinity ? entry + score(emit[first], t) : -Infinity;
      scores[base] = nodeBest;
      history[base] = entryHistory[id];
      starts[base] = entryStarts[id];
      scores.fill(-Infinity, base + 1, base + count);
    }
    queued[id] = 0;
    nodeScores[k] = nodeBest;
    const lang = language[id];
    languageBest[lang] = Math.max(languageBest[lang], nodeBest);
    best = Math.max(best, nodeBest);
  }
  entries.ids.length = 0;
  return best;
}

/** Drop states outside the beam and queue their successors for the next frame. */
function propagateFrame(network, search, t, best) {
  const {
    words,
    emit,
    trees,
    firstState,
    firstChild,
    firstWord,
    children,
    endings,
    look,
    optional,
    language,
  } = network;
  const { go } = network.model;
  const {
    settings,
    work,
    nodeScores,
    wordEnds,
    treesByLanguage,
    thresholds,
    stamp,
    offsets,
    cur,
    entries,
    lm,
    records,
  } = search;
  const { lmw, releaseSkip, oovStart, onWordEnd } = settings;
  const { enter } = entries;
  const { scores, history, starts } = cur;
  wordEnds.clear();
  let active = 0;
  for (let k = 0; k < work.length; k++) {
    const id = work[k];
    const lang = language[id];
    const threshold = thresholds[lang];
    if (nodeScores[k] < threshold) {
      continue;
    }
    const base = k * STATES_PER_TOKEN;
    const first = firstState[id];
    const lastState = firstState[id + 1] - 1;
    const last = base + lastState - first;
    for (let j = base; j <= last; j++) {
      if (scores[j] < threshold) {
        scores[j] = -Infinity;
      }
    }
    stamp[id] = t;
    offsets[id] = base;
    work[active++] = id;
    let exit = scores[last] + go[emit[lastState]];
    let hist = history[last];
    let start = starts[last];
    if (optional[id]) {
      const skip = scores[base + 2] + go[emit[first + 2]] + releaseSkip;
      if (skip > exit) {
        exit = skip;
        hist = history[base + 2];
        start = starts[base + 2];
      }
    }
    if (exit < threshold) {
      continue;
    }
    const tree = treesByLanguage[lang];
    if (id === tree.silence) {
      // Silence returns to the root with the same history.
      for (const child of tree.root) {
        enter(child, exit + lmw * look[child], hist, t + 1);
      }
      for (const child of tree.loop.begin) {
        enter(child, exit + oovStart, hist, t + 1);
      }
      continue;
    }
    const lookScore = lmw * look[id];
    for (let i = firstChild[id]; i < firstChild[id + 1]; i++) {
      const child = children[i];
      enter(child, exit + lmw * look[child] - lookScore, hist, start);
    }
    for (let i = firstWord[id]; i < firstWord[id + 1]; i++) {
      const wid = endings[i];
      const value = exit - lookScore + lm(hist, wid);
      onWordEnd?.(wid, value - best, start, t + 1);
      const word = words[wid];
      // One word end per language and frame, apart for sandhi variants.
      const key = word.before ? `${word.lang}${word.before}` : word.lang;
      const end = wordEnds.get(key);
      if (!end || value > end.score) {
        wordEnds.set(key, {
          word: word.word,
          id: wid,
          lang: word.lang,
          prev: hist,
          start,
          end: t + 1,
          score: value,
          oov: Boolean(word.oov),
        });
      }
    }
  }
  work.length = active;
  for (const rec of wordEnds.values()) {
    if (rec.score >= thresholds[trees.get(rec.lang).index]) {
      restart(enter, network, records, rec, settings);
    }
  }
}

/**
 * Best word sequence of the frames: words with their tokens, units and
 * frame ranges, the total score and the language of the last word.
 * `options.onWordEnd(id, score, start, end)` sees every word end inside
 * the beam, its score relative to the best token of its last frame.
 * `options.tone` (the `tone` of hmmFeatures) adds the tone stream.
 */
export function decodeWords(network, feats, frames, options = {}, cache) {
  const settings = { ...HMM_DECODE_DEFAULTS, ...options };
  const languages = settings.languages ?? [...network.trees.keys()];
  const { model, language, trees } = network;
  const records = [];
  const buffers = searchBuffers(network, cache);
  const { entries, stamp, offsets, prev, cur } = buffers;
  for (const id of entries.ids) {
    entries.queued[id] = 0;
  }
  entries.ids.length = 0;
  stamp.fill(-2);
  const search = {
    work: [],
    nodeScores: [],
    languageBest: new Float64Array(trees.size),
    thresholds: new Float64Array(trees.size),
    buckets: Array.from({ length: trees.size }, () => []),
    wordEnds: new Map(),
    treesByLanguage: Array.from(trees.values()),
    stamp,
    offsets,
    score: emissionCache(model, feats, settings),
    lm: languageModel(network, records, settings, buffers),
    settings,
    entries,
    records,
    prev,
    cur,
  };
  initialEntries(network, records, languages, settings, entries.enter);
  for (let t = 0; t < frames; t++) {
    const best = scoreFrame(network, search, t);
    languageThresholds(language, search, best, settings);
    propagateFrame(network, search, t, best);
    [search.prev, search.cur] = [search.cur, search.prev];
  }
  const best = finalRecord(network, records, languages, frames, {
    stamp: search.stamp,
    offsets: search.offsets,
    prev: search.prev.scores,
    prevHist: search.prev.history,
  });
  return {
    words: backtrace(network.words, records, best),
    score: best?.score ?? -Infinity,
    lang: best?.lang ?? null,
  };
}

// Reuse numeric arrays and reset only the state read by the next search.
// Streams keep a weak cache per recognizer. Batch retains only its last network.
function searchBuffers(network, cache) {
  let buffers = cache?.get(network);
  if (!buffers) {
    cache?.clear?.();
    const nodes = network.language.length;
    const words = network.words.length;
    buffers = {
      entries: entryQueue(nodes),
      stamp: new Int32Array(nodes),
      offsets: new Int32Array(nodes),
      prev: tokenBuffer(),
      cur: tokenBuffer(),
      predecessor: new Array(words),
      wordScores: new Float64Array(words),
      unigram: new Float64Array(words),
    };
    cache?.set(network, buffers);
  }
  return buffers;
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
  let prev = new Float64Array(N).fill(-Infinity);
  let cur = new Float64Array(N);
  // Each predecessor is at most four states back in the chain.
  const back = new Uint8Array(frames * N);
  for (let t = 0; t < frames; t++) {
    const row = t * N;
    for (let n = 0; n < N; n++) {
      const state = chain[n];
      let s = -Infinity;
      let advanceBy = 0;
      if (t === 0) {
        // Start in the first state or after skipping leading silence.
        if (n === 0) {
          s = 0;
        } else if (n === 3 && chain[0].skippable) {
          s = silencePenalty;
        }
      } else {
        s = prev[n] + state.stay;
        const advance = n > 0 ? prev[n - 1] + chain[n - 1].go : -Infinity;
        if (advance > s) {
          s = advance;
          advanceBy = 1;
        }
        // Skip a whole optional unit that starts at n-3.
        if (n >= 4 && chain[n - 3].skippable) {
          const skip =
            prev[n - 4] + chain[n - 4].go + (chain[n - 3].sil ? 0 : -1);
          if (skip > s) {
            s = skip;
            advanceBy = 4;
          }
        }
      }
      if (s > -Infinity) {
        s += score(state.m, t);
      }
      cur[n] = s;
      back[row + n] = advanceBy;
    }
    [prev, cur] = [cur, prev];
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
    at -= back[t * N + at];
  }
  return tokens.map((tk, i) => ({ ...tk, from: spans[i][0], to: spans[i][1] }));
}
