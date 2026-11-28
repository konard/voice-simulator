/* eslint-disable complexity, max-statements */
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
    if (stateOfKey[key] < 0) {
      return 0;
    }
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

function languageModel(network, records, settings) {
  const { lmw, wip, oovPhone, oovWeight, minCount } = settings;
  const { words, trees } = network;
  const rows = new Map();
  const backoffs = new Float64Array(words.length).fill(NaN);
  return (hist, id) => {
    const w = words[id];
    if (w.oov) {
      const before = w.begin ? '' : words[records[hist].id].units[0];
      const row = trees.get(w.lang).loop.bigram.get(before);
      return oovWeight * row.get(w.units[0]) + oovPhone;
    }
    const previous = hist >= 0 ? records[hist].word : null;
    const data = trees.get(w.lang).data;
    if (previous && !rows.has(id)) {
      rows.set(id, data.transitionRow(w.word));
    }
    const cost = previous ? rows.get(id)?.get(previous) : undefined;
    if (cost !== undefined) {
      return lmw * lnProbability(cost) + wip;
    }
    // Unseen pairs use the same backoff regardless of the previous word.
    if (Number.isNaN(backoffs[id])) {
      const prior = (0.4 * Math.max(w.count ?? 1, minCount)) / data.total;
      backoffs[id] = lmw * lnProbability(-0.3 * Math.log(prior) + 0.5) + wip;
    }
    return backoffs[id];
  };
}

function entryBuffer(size) {
  const scores = new Float64Array(size);
  const history = new Int32Array(size);
  const starts = new Int32Array(size);
  const seen = new Int32Array(size);
  const ids = [];
  let generation = 1;
  return {
    ids,
    scores,
    history,
    starts,
    has: (id) => seen[id] === generation,
    add(id, score, hist, start) {
      if (seen[id] === generation) {
        if (score <= scores[id]) {
          return;
        }
      } else {
        seen[id] = generation;
        ids.push(id);
      }
      scores[id] = score;
      history[id] = hist;
      starts[id] = start;
    },
    clear() {
      generation++;
      ids.length = 0;
    },
  };
}

/** Tokens at the roots, loops and silences of every language at frame 0. */
function initialEntries(
  entries,
  network,
  records,
  languages,
  { lmw, oovStart }
) {
  for (const lang of languages) {
    const tree = network.trees.get(lang);
    const startRecord = records.length;
    records.push({ word: null, lang, prev: -1, start: 0, end: 0, score: 0 });
    for (const node of tree.root) {
      entries.add(node.id, lmw * node.lookLn, startRecord, 0);
    }
    for (const node of tree.loop.begin) {
      entries.add(node.id, oovStart, startRecord, 0);
    }
    entries.add(tree.silence.id, 0, startRecord, 0);
  }
}

/**
 * Record a word end and start the next word, a word outside the vocabulary
 * (or, after a loop phone, the rest of that word) or a silence after it.
 * A rising sandhi variant goes on only with a word of the tone that causes
 * it, without a pause (hmm-network.js toneVariants).
 */
function restart(next, network, records, rec, settings) {
  const { lmw, silencePenalty, oovStart } = settings;
  const r = records.length;
  records.push(rec);
  const tree = network.trees.get(rec.lang);
  const before = network.words[rec.id].before;
  if (before) {
    for (const child of tree.after.get(before)) {
      next.add(child.id, rec.score + lmw * child.lookLn, r, rec.end);
    }
    return;
  }
  for (const child of tree.root) {
    next.add(child.id, rec.score + lmw * child.lookLn, r, rec.end);
  }
  for (const node of tree.loop.begin) {
    next.add(node.id, rec.score + oovStart, r, rec.end);
  }
  if (rec.oov) {
    for (const node of tree.loop.next) {
      next.add(node.id, rec.score, r, rec.end);
    }
  }
  next.add(tree.silence.id, rec.score + silencePenalty, r, rec.end);
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
  const { stamp, prev, prevHist } = last;
  let best = bestEndingAt(network, records, frames);
  for (const lang of languages) {
    const sil = network.trees.get(lang).silence;
    const j = sil.first + 2;
    if (stamp[sil.id] === frames - 1 && prev[j] > (best?.score ?? -Infinity)) {
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

/**
 * Pruning threshold of each language at one frame: `beam` below its own
 * best token, at most `languageBeam` below the best of all, and its
 * `maxActive` best nodes.
 */
export function languageThresholds(nodes, processed, best, settings) {
  const values = new Map();
  for (const [id, nodeBest] of processed) {
    const { lang } = nodes[id];
    if (!values.has(lang)) {
      values.set(lang, []);
    }
    values.get(lang).push(nodeBest);
  }
  const thresholds = new Map();
  for (const [lang, scores] of values) {
    thresholds.set(lang, pruningThreshold(scores, best, settings));
  }
  return thresholds;
}

function pruningThreshold(scores, best, { beam, languageBeam, maxActive }) {
  const own = scores.reduce((a, b) => Math.max(a, b), -Infinity);
  const threshold = Math.max(own - beam, best - languageBeam);
  if (scores.length <= maxActive) {
    return threshold;
  }
  let count = 0;
  for (const score of scores) {
    if (score > threshold) {
      scores[count++] = score;
    }
  }
  if (count < maxActive) {
    return threshold;
  }
  return selectScore(scores, count, maxActive - 1);
}

/** Partition in place until the required rank is bracketed by the pivot. */
function selectScore(scores, count, rank) {
  let left = 0;
  let right = count - 1;
  while (left < right) {
    const pivot = scores[(left + right) >>> 1];
    let i = left;
    let j = right;
    while (i <= j) {
      while (scores[i] > pivot) {
        i++;
      }
      while (scores[j] < pivot) {
        j--;
      }
      if (i <= j) {
        const score = scores[i];
        scores[i++] = scores[j];
        scores[j--] = score;
      }
    }
    if (rank <= j) {
      right = j;
    } else if (rank >= i) {
      left = i;
    } else {
      return scores[rank];
    }
  }
  return scores[left];
}

/**
 * Best word sequence of the frames: words with their tokens, units and
 * frame ranges, the total score and the language of the last word.
 * `options.onWordEnd(id, score, start, end)` sees every word end inside
 * the beam, its score relative to the best token of its last frame.
 * `options.tone` (the `tone` of hmmFeatures) adds the tone stream.
 */
// Keep frame updates, pruning and word exits in the same hot loop.
// eslint-disable-next-line max-lines-per-function
export function decodeWords(network, feats, frames, options = {}) {
  const settings = { ...HMM_DECODE_DEFAULTS, ...options };
  const { lmw, releaseSkip, oovStart } = settings;
  const languages = settings.languages ?? [...network.trees.keys()];
  const { nodes, words, emit, stay, go, trees } = network;
  const S = emit.length;
  const score = emissionCache(network.model, feats, settings);
  let prev = new Float64Array(S).fill(-Infinity);
  let cur = new Float64Array(S).fill(-Infinity);
  let prevHist = new Int32Array(S);
  let curHist = new Int32Array(S);
  let prevStart = new Int32Array(S);
  let curStart = new Int32Array(S);
  const stamp = new Int32Array(nodes.length).fill(-2);
  const records = [];
  const lm = languageModel(network, records, settings);
  let entries = entryBuffer(nodes.length);
  let next = entryBuffer(nodes.length);
  initialEntries(entries, network, records, languages, settings);
  let work = [];
  let nextActive = [];
  const nodeScores = new Float64Array(nodes.length);
  const languageScores = new Map(
    [...trees.keys()].map((language) => [language, []])
  );
  const thresholds = new Map();
  const wordEnds = new Map();
  for (let t = 0; t < frames; t++) {
    for (const id of entries.ids) {
      if (stamp[id] !== t - 1) {
        work.push(id);
      }
    }
    let best = -Infinity;
    for (const scores of languageScores.values()) {
      scores.length = 0;
    }
    for (const id of work) {
      const node = nodes[id];
      const f = node.first;
      const wasActive = stamp[id] === t - 1;
      let nodeBest = -Infinity;
      for (let i = node.count - 1; i >= 0; i--) {
        const j = f + i;
        let s = -Infinity;
        let hist = 0;
        let start = 0;
        if (wasActive) {
          s = prev[j] + stay[j];
          hist = prevHist[j];
          start = prevStart[j];
          if (i > 0 && prev[j - 1] + go[j - 1] > s) {
            s = prev[j - 1] + go[j - 1];
            hist = prevHist[j - 1];
            start = prevStart[j - 1];
          }
        }
        if (i === 0 && entries.has(id) && entries.scores[id] > s) {
          s = entries.scores[id];
          hist = entries.history[id];
          start = entries.starts[id];
        }
        if (s > -Infinity) {
          s += score(emit[j], t);
        }
        cur[j] = s;
        curHist[j] = hist;
        curStart[j] = start;
        nodeBest = Math.max(nodeBest, s);
      }
      best = Math.max(best, nodeBest);
      nodeScores[id] = nodeBest;
      languageScores.get(node.lang).push(nodeBest);
    }
    for (const [lang, scores] of languageScores) {
      thresholds.set(lang, pruningThreshold(scores, best, settings));
    }
    wordEnds.clear();
    for (const id of work) {
      const node = nodes[id];
      const threshold = thresholds.get(node.lang);
      if (nodeScores[id] < threshold) {
        continue;
      }
      const f = node.first;
      for (let i = 0; i < node.count; i++) {
        if (cur[f + i] < threshold) {
          cur[f + i] = -Infinity;
        }
      }
      stamp[id] = t;
      nextActive.push(id);
      const last = f + node.count - 1;
      let exit = cur[last] + go[last];
      let hist = curHist[last];
      let start = curStart[last];
      if (node.optional && cur[f + 2] + go[f + 2] + releaseSkip > exit) {
        exit = cur[f + 2] + go[f + 2] + releaseSkip;
        hist = curHist[f + 2];
        start = curStart[f + 2];
      }
      if (exit < threshold) {
        continue;
      }
      const tree = trees.get(node.lang);
      if (node === tree.silence) {
        // Silence returns to the root with the same history.
        for (const child of tree.root) {
          next.add(child.id, exit + lmw * child.lookLn, hist, t + 1);
        }
        for (const loopNode of tree.loop.begin) {
          next.add(loopNode.id, exit + oovStart, hist, t + 1);
        }
        continue;
      }
      const look = lmw * node.lookLn;
      for (const child of node.children) {
        next.add(child.id, exit + lmw * child.lookLn - look, hist, start);
      }
      for (const wid of node.words) {
        const s = exit - look + lm(hist, wid);
        settings.onWordEnd?.(wid, s - best, start, t + 1);
        const { lang, before } = words[wid];
        // One word end per language and frame, apart for sandhi variants.
        const key = before ? `${lang}${before}` : lang;
        const end = wordEnds.get(key);
        if (!end || s > end.score) {
          wordEnds.set(key, {
            word: words[wid].word,
            id: wid,
            lang,
            prev: hist,
            start,
            end: t + 1,
            score: s,
            oov: Boolean(words[wid].oov),
          });
        }
      }
    }
    for (const rec of wordEnds.values()) {
      if (rec.score >= thresholds.get(rec.lang)) {
        restart(next, network, records, rec, settings);
      }
    }
    entries.clear();
    [entries, next] = [next, entries];
    work.length = 0;
    [work, nextActive] = [nextActive, work];
    [prev, cur] = [cur, prev];
    [prevHist, curHist] = [curHist, prevHist];
    [prevStart, curStart] = [curStart, prevStart];
  }
  const best = finalRecord(network, records, languages, frames, {
    stamp,
    prev,
    prevHist,
  });
  return {
    words: backtrace(words, records, best),
    score: best?.score ?? -Infinity,
    lang: best?.lang ?? null,
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
  const back = new Int32Array(frames * N);
  for (let t = 0; t < frames; t++) {
    const row = t * N;
    for (let n = 0; n < N; n++) {
      let s = -Infinity;
      let arg = -1;
      if (t === 0) {
        // Start in the first state or after skipping leading silence.
        if (n === 0) {
          s = 0;
        } else if (n === 3 && chain[0].skippable) {
          s = silencePenalty;
        }
      } else {
        s = prev[n] + chain[n].stay;
        arg = n;
        if (n > 0 && prev[n - 1] + chain[n - 1].go > s) {
          s = prev[n - 1] + chain[n - 1].go;
          arg = n - 1;
        }
        // Skip a whole optional unit that starts at n-3.
        if (n >= 4 && chain[n - 3].skippable) {
          const skip =
            prev[n - 4] + chain[n - 4].go + (chain[n - 3].sil ? 0 : -1);
          if (skip > s) {
            s = skip;
            arg = n - 4;
          }
        }
      }
      if (s > -Infinity) {
        s += score(chain[n].m, t);
      }
      cur[n] = s;
      back[row + n] = arg;
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
    at = back[t * N + at];
  }
  return tokens.map((tk, i) => ({ ...tk, from: spans[i][0], to: spans[i][1] }));
}
