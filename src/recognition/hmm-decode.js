/* eslint-disable complexity, max-statements */
/**
 * Viterbi token passing over the word network of the Gaussian HMM
 * recogniser, with the shipped word bigrams, beam and histogram pruning,
 * then a forced alignment of the best words for phone times. Unlicense.
 */
import { stateIndex, stateScore } from './hmm-model.js';

export const HMM_DECODE_DEFAULTS = Object.freeze({
  beam: 120,
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
  const { lmw, wip, oovPhone, oovWeight } = settings;
  const { words, trees } = network;
  const cache = new Map();
  return (hist, id) => {
    const w = words[id];
    if (w.oov) {
      const before = w.begin ? '' : words[records[hist].id].units[0];
      const row = trees.get(w.lang).loop.bigram.get(before);
      return oovWeight * row.get(w.units[0]) + oovPhone;
    }
    const previous = hist >= 0 ? records[hist].word : null;
    const key = `${previous ?? ''}\t${id}`;
    let v = cache.get(key);
    if (v === undefined) {
      const data = trees.get(w.lang).data;
      const row = previous ? data.transitionRow(w.word) : undefined;
      const cost = row?.has(previous)
        ? row.get(previous)
        : -0.3 * Math.log((0.4 * (w.count ?? 1)) / data.total) + 0.5;
      v = lmw * lnProbability(cost) + wip;
      cache.set(key, v);
    }
    return v;
  };
}

function enter(map, node, score, hist, start) {
  const e = map.get(node);
  if (!e || score > e[0]) {
    map.set(node, [score, hist, start]);
  }
}

/** Tokens at the roots, loops and silences of every language at frame 0. */
function initialEntries(network, records, languages, { lmw, oovStart }) {
  const entries = new Map();
  for (const lang of languages) {
    const tree = network.trees.get(lang);
    const startRecord = records.length;
    records.push({ word: null, lang, prev: -1, start: 0, end: 0, score: 0 });
    for (const node of tree.root) {
      enter(entries, node.id, lmw * node.lookLn, startRecord, 0);
    }
    for (const node of tree.loop.begin) {
      enter(entries, node.id, oovStart, startRecord, 0);
    }
    enter(entries, tree.silence.id, 0, startRecord, 0);
  }
  return entries;
}

/**
 * Record a word end and start the next word, a word outside the vocabulary
 * (or, after a loop phone, the rest of that word) or a silence after it.
 */
function restart(next, network, records, rec, settings) {
  const { lmw, silencePenalty, oovStart } = settings;
  const r = records.length;
  records.push(rec);
  const tree = network.trees.get(rec.lang);
  for (const child of tree.root) {
    enter(next, child.id, rec.score + lmw * child.lookLn, r, rec.end);
  }
  for (const node of tree.loop.begin) {
    enter(next, node.id, rec.score + oovStart, r, rec.end);
  }
  if (rec.oov) {
    for (const node of tree.loop.next) {
      enter(next, node.id, rec.score, r, rec.end);
    }
  }
  enter(next, tree.silence.id, rec.score + silencePenalty, r, rec.end);
}

/** Best final: a word that ended at the last frame or a trailing silence. */
function finalRecord(network, records, languages, frames, last) {
  const { stamp, prev, prevHist } = last;
  let best = null;
  for (const r of records) {
    if (
      r.word !== null &&
      r.end === frames &&
      (!best || r.score > best.score)
    ) {
      best = r;
    }
  }
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
  return best;
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
 * Best word sequence of the frames: words with their tokens, units and
 * frame ranges, the total score and the language of the last word.
 * `options.onWordEnd(id, score, start, end)` sees every word end inside
 * the beam, its score relative to the best token of its last frame.
 * `options.tone` (the `tone` of hmmFeatures) adds the tone stream.
 */
export function decodeWords(network, feats, frames, options = {}) {
  const settings = { ...HMM_DECODE_DEFAULTS, ...options };
  const { beam, lmw, releaseSkip, maxActive, oovStart } = settings;
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
  let entries = initialEntries(network, records, languages, settings);
  let active = [];
  for (let t = 0; t < frames; t++) {
    const work = new Set(active);
    for (const id of entries.keys()) {
      work.add(id);
    }
    let best = -Infinity;
    const processed = [];
    for (const id of work) {
      const node = nodes[id];
      const f = node.first;
      const wasActive = stamp[id] === t - 1;
      const entry = entries.get(id);
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
        if (i === 0 && entry && entry[0] > s) {
          [s, hist, start] = entry;
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
      processed.push([id, nodeBest]);
    }
    let threshold = best - beam;
    if (processed.length > maxActive) {
      const sorted = processed.map((p) => p[1]).sort((a, b) => b - a);
      threshold = Math.max(threshold, sorted[maxActive - 1]);
    }
    const next = new Map();
    const nextActive = [];
    const wordEnds = new Map();
    for (const [id, nodeBest] of processed) {
      if (nodeBest < threshold) {
        continue;
      }
      const node = nodes[id];
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
          enter(next, child.id, exit + lmw * child.lookLn, hist, t + 1);
        }
        for (const loopNode of tree.loop.begin) {
          enter(next, loopNode.id, exit + oovStart, hist, t + 1);
        }
        continue;
      }
      const look = lmw * node.lookLn;
      for (const child of node.children.values()) {
        enter(next, child.id, exit + lmw * child.lookLn - look, hist, start);
      }
      for (const wid of node.words) {
        const s = exit - look + lm(hist, wid);
        settings.onWordEnd?.(wid, s - best, start, t + 1);
        const lang = words[wid].lang;
        const end = wordEnds.get(lang);
        if (!end || s > end.score) {
          wordEnds.set(lang, {
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
      if (rec.score >= threshold) {
        restart(next, network, records, rec, settings);
      }
    }
    entries = next;
    active = nextActive;
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
