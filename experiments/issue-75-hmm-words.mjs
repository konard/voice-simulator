/* eslint-disable complexity, max-statements, max-depth, max-lines-per-function */
/**
 * Word decoding over lexical prefix trees of HMM units with the shipped
 * word bigrams: token passing, one tree per language, beam pruning and
 * forced alignment for phone times. Unlicense.
 */
import { getLexicon } from '../src/recognition/lexicon.js';
import { contextClass, contextKey } from './issue-75-hmm-context.mjs';
import { toneClass, toneUnits } from './issue-75-hmm-lib.mjs';
import { gmmScore } from './issue-75-hmm-model.mjs';

const TONES = ['', '˩', '˨', '˧', '˦', '˥'];

/** Learn symbol → units from the training items ("k k_r", "d͡ʒ d͡ʒ_r"). */
export function learnExpansions(items) {
  const counts = new Map();
  for (const item of items) {
    for (const units of item.units ?? []) {
      const [symbol] = units.split(' ');
      const c = counts.get(symbol) ?? { plain: 0, released: 0 };
      if (units.includes(' ')) {
        c.released++;
      } else {
        c.plain++;
      }
      counts.set(symbol, c);
    }
  }
  const out = new Map();
  for (const [symbol, { plain, released }] of counts) {
    const share = released / (plain + released);
    out.set(symbol, {
      release: share > 0.02,
      optional: share > 0.02 && share < 0.98,
    });
  }
  return out;
}

export function tokenIpa(token) {
  const tones = (token.tone ?? []).map((n) => TONES[n]).join('');
  return `${token.stress === 1 ? 'ˈ' : token.stress === 2 ? 'ˌ' : ''}${token.symbol}${tones}`;
}

/** State index of unit state s in the given contexts (falls back to CI). */
export function stateIndexer(model) {
  const ci = new Map();
  model.states.forEach((st, i) => {
    if (!st.context) {
      ci.set(`${st.unit}#${st.s}`, i);
    }
  });
  return (unit, s, left, right) => {
    const key = contextKey(unit, s, left, right);
    const cd = key ? model.contextIndex?.get(key) : undefined;
    return cd ?? ci.get(`${unit}#${s}`);
  };
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
  const c = toneClass(tokens[toned].tone);
  if (c === 3) {
    out.push(withTone([3, 5]));
  }
  if (word === '不' || word === '一') {
    out.push(withTone([3, 5]));
  }
  if (word === '一') {
    out.push(withTone([5, 1]));
  }
  return out;
}

function lnProbability(cost) {
  return -(cost - 0.5) / 0.3;
}

/**
 * Build the decoding network: per language a prefix tree whose nodes are
 * phones (3 states, or 6 with a release).
 */
export function buildNetwork(
  model,
  expansions,
  languages,
  { maxWords = 8000 } = {}
) {
  const stateOf = new Map(
    model.states
      .filter((s) => !s.context)
      .map((s, i) => [`${s.unit}#${s.s}`, i])
  );
  const stateIndex = stateIndexer(model);
  const stEmit = [];
  const stStay = [];
  const stGo = [];
  const nodes = [];
  const words = [];
  const addStates = (unit, left, right) => {
    for (let s = 0; s < 3; s++) {
      const i = stateIndex(unit, s, left, right);
      stEmit.push(i);
      stStay.push(model.states[i].stay);
      stGo.push(model.states[i].go);
    }
  };
  const newNode = (symbol, lang, left = null, right = null) => {
    const ex = expansions.get(symbol) ?? { release: false, optional: false };
    const released = ex.release && stateOf.has(`${symbol}_r#0`);
    const node = {
      symbol,
      lang,
      first: stEmit.length,
      count: released ? 6 : 3,
      optional: released && ex.optional,
      children: new Map(),
      words: [],
    };
    addStates(symbol, left, right);
    if (released) {
      addStates(`${symbol}_r`, left, right);
    }
    nodes.push(node);
    return node;
  };
  const trees = new Map();
  let skipped = 0;
  for (const lang of languages) {
    const lexicon = getLexicon(lang);
    const allowed = new Set(
      lexicon.words.slice(0, maxWords).map((w) => w.word)
    );
    const root = { children: new Map() };
    const silence = newNode('sil', lang);
    const seen = new Set();
    const tonal = lang === 'zh' && model.units.some((u) => u.includes('@'));
    for (const entry of lexicon.pronunciations()) {
      if (!allowed.has(entry.word)) {
        continue;
      }
      const spoken = entry.tokens.filter(
        (t) => t.kind === 'vowel' || t.kind === 'consonant'
      );
      for (const tokens of tonal
        ? toneVariants(entry.word, spoken)
        : [spoken]) {
        const units = tonal ? toneUnits(tokens) : tokens.map((t) => t.symbol);
        if (!tokens.length || units.some((u) => !stateOf.has(`${u}#0`))) {
          skipped++;
          continue;
        }
        const key = `${entry.word}\t${tokens.map(tokenIpa).join(' ')}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        let node = root;
        tokens.forEach((t, i) => {
          const left = i ? contextClass(tokens[i - 1].symbol) : null;
          const right =
            i + 1 < tokens.length ? contextClass(tokens[i + 1].symbol) : null;
          const key = `${units[i]}>${right}`;
          let child = node.children.get(key);
          if (!child) {
            child = newNode(units[i], lang, left, right);
            node.children.set(key, child);
          }
          node = child;
        });
        const id = words.length;
        words.push({
          word: entry.word,
          lang,
          ipa: entry.ipa,
          tokens,
          units,
          count: entry.count,
        });
        node.words.push(id);
      }
    }
    // Unigram look-ahead: the best ln p of any word below each node.
    const uni = (id) =>
      Math.log((lexicon.counts.get(words[id].word) ?? 1) / lexicon.total);
    const lookahead = (node) => {
      let best = -Infinity;
      for (const id of node.words) {
        best = Math.max(best, uni(id));
      }
      for (const child of node.children.values()) {
        best = Math.max(best, lookahead(child));
      }
      node.lookLn = best;
      return best;
    };
    for (const child of root.children.values()) {
      lookahead(child);
    }
    silence.lookLn = 0;
    trees.set(lang, {
      root: [...root.children.values()],
      silence,
      data: lexicon,
    });
  }
  nodes.forEach((n, i) => {
    n.id = i;
  });
  return {
    model,
    nodes,
    words,
    trees,
    skipped,
    stEmit: Int32Array.from(stEmit),
    stStay: Float64Array.from(stStay),
    stGo: Float64Array.from(stGo),
  };
}

/** Viterbi token passing; returns the best word sequence with frames. */
export function decodeWords(network, feats, options = {}) {
  const {
    beam = 120,
    lmw = 8,
    wip = -4,
    silencePenalty = -2,
    releaseSkip = -1,
    languages = [...network.trees.keys()],
    maxActive = 6000,
  } = options;
  const { nodes, words, stEmit, stStay, stGo, model, trees } = network;
  const S = stEmit.length;
  const T = feats.length;
  const modelStates = model.states;
  const emitStamp = new Int32Array(modelStates.length).fill(-1);
  const emitValue = new Float64Array(modelStates.length);
  let prev = new Float64Array(S).fill(-Infinity);
  let cur = new Float64Array(S).fill(-Infinity);
  let prevHist = new Int32Array(S);
  let curHist = new Int32Array(S);
  let prevStart = new Int32Array(S);
  let curStart = new Int32Array(S);
  const stamp = new Int32Array(nodes.length).fill(-2);
  const records = [];
  const lmCache = new Map();
  const lm = (hist, id) => {
    const w = words[id];
    const previous = hist >= 0 ? records[hist].word : null;
    const key = `${previous ?? ''}\t${id}`;
    let v = lmCache.get(key);
    if (v === undefined) {
      const data = trees.get(w.lang).data;
      let cost;
      const row = previous ? data.transitionRow(w.word) : undefined;
      if (row && row.has(previous)) {
        cost = row.get(previous);
      } else {
        cost =
          -0.3 * Math.log((0.4 * (data.counts.get(w.word) ?? 1)) / data.total) +
          0.5;
      }
      v = lmw * lnProbability(cost) + wip;
      lmCache.set(key, v);
    }
    return v;
  };
  // Entries for the next frame: node → [score, hist, start].
  let entries = new Map();
  const enter = (map, node, score, hist, start) => {
    const e = map.get(node);
    if (!e || score > e[0]) {
      map.set(node, [score, hist, start]);
    }
  };
  for (const lang of languages) {
    const tree = trees.get(lang);
    const startRecord = records.length;
    records.push({ word: null, lang, prev: -1, start: 0, end: 0, score: 0 });
    for (const node of tree.root) {
      enter(entries, node.id, lmw * node.lookLn, startRecord, 0);
    }
    enter(entries, tree.silence.id, 0, startRecord, 0);
  }
  let active = [];
  for (let t = 0; t < T; t++) {
    const x = feats[t];
    const emit = (j) => {
      const m = stEmit[j];
      if (emitStamp[m] !== t) {
        emitStamp[m] = t;
        emitValue[m] = gmmScore(modelStates[m].model, x);
      }
      return emitValue[m];
    };
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
        let score = -Infinity;
        let hist = 0;
        let start = 0;
        if (wasActive) {
          score = prev[j] + stStay[j];
          hist = prevHist[j];
          start = prevStart[j];
          if (i > 0) {
            const go = prev[j - 1] + stGo[j - 1];
            if (go > score) {
              score = go;
              hist = prevHist[j - 1];
              start = prevStart[j - 1];
            }
          }
        }
        if (i === 0 && entry && entry[0] > score) {
          [score, hist, start] = entry;
        }
        if (score > -Infinity) {
          score += emit(j);
        }
        cur[j] = score;
        curHist[j] = hist;
        curStart[j] = start;
        if (score > nodeBest) {
          nodeBest = score;
        }
      }
      if (nodeBest > best) {
        best = nodeBest;
      }
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
      let exit = cur[last] + stGo[last];
      let hist = curHist[last];
      let start = curStart[last];
      if (node.optional) {
        const early = cur[f + 2] + stGo[f + 2] + releaseSkip;
        if (early > exit) {
          exit = early;
          hist = curHist[f + 2];
          start = curStart[f + 2];
        }
      }
      if (exit < threshold) {
        continue;
      }
      if (node.symbol === 'sil' && node === trees.get(node.lang).silence) {
        // Silence returns to the root with the same history.
        const tree = trees.get(node.lang);
        for (const child of tree.root) {
          enter(next, child.id, exit + lmw * child.lookLn, hist, t + 1);
        }
        continue;
      }
      const look = lmw * node.lookLn;
      for (const child of node.children.values()) {
        enter(next, child.id, exit + lmw * child.lookLn - look, hist, start);
      }
      for (const wid of node.words) {
        const score = exit - look + lm(hist, wid);
        const lang = words[wid].lang;
        const end = wordEnds.get(lang);
        if (!end || score > end.score) {
          wordEnds.set(lang, {
            word: words[wid].word,
            id: wid,
            lang,
            prev: hist,
            start,
            end: t + 1,
            score,
          });
        }
      }
    }
    for (const [lang, rec] of wordEnds) {
      if (rec.score < threshold) {
        continue;
      }
      const r = records.length;
      records.push(rec);
      const tree = trees.get(lang);
      for (const child of tree.root) {
        enter(next, child.id, rec.score + lmw * child.lookLn, r, t + 1);
      }
      enter(next, tree.silence.id, rec.score + silencePenalty, r, t + 1);
    }
    entries = next;
    active = nextActive;
    [prev, cur] = [cur, prev];
    [prevHist, curHist] = [curHist, prevHist];
    [prevStart, curStart] = [curStart, prevStart];
  }
  // Best final: a word that ended at the last frame or a trailing silence.
  let best = null;
  for (const r of records) {
    if (r.word !== null && r.end === T && (!best || r.score > best.score)) {
      best = r;
    }
  }
  for (const lang of languages) {
    const sil = trees.get(lang).silence;
    const j = sil.first + 2;
    if (stamp[sil.id] === T - 1 && prev[j] > (best?.score ?? -Infinity)) {
      const h = prevHist[j];
      if (h >= 0 && records[h].word !== null) {
        best = { ...records[h], score: prev[j] };
      }
    }
  }
  const out = [];
  let r = best;
  while (r && r.word !== null) {
    out.unshift({ ...words[r.id], start: r.start, end: r.end });
    r = r.prev >= 0 ? records[r.prev] : null;
  }
  return {
    words: out,
    score: best?.score ?? -Infinity,
    lang: best?.lang ?? null,
    records: records.length,
  };
}

/**
 * Forced alignment of the decoded words' units with optional silence
 * between words; returns per-token frame ranges.
 */
export function alignWords(
  network,
  feats,
  decoded,
  { silencePenalty = -2 } = {}
) {
  const { model, stEmit, stStay, stGo } = network;
  const stateOf = new Map(model.states.map((s, i) => [`${s.unit}#${s.s}`, i]));
  const stateIndex = stateIndexer(model);
  const chain = [];
  const pushUnit = (
    unit,
    token,
    optionalSkip = false,
    left = null,
    right = null
  ) => {
    for (let s = 0; s < 3; s++) {
      const i = stateIndex(unit, s, left, right);
      chain.push({
        m: i,
        stay: model.states[i].stay,
        go: model.states[i].go,
        token,
        skippable: optionalSkip && s === 0,
        sil: unit === 'sil',
      });
    }
  };
  const tokens = [];
  const sil = () => pushUnit('sil', -1, true);
  sil();
  decoded.words.forEach((w, wi) => {
    w.tokens.forEach((t, i) => {
      const ti = tokens.length;
      const left = i ? contextClass(w.tokens[i - 1].symbol) : null;
      const right =
        i + 1 < w.tokens.length ? contextClass(w.tokens[i + 1].symbol) : null;
      tokens.push({ word: wi, token: t });
      const unit = w.units?.[i] ?? t.symbol;
      pushUnit(unit, ti, false, left, right);
      if (stateOf.has(`${unit}_r#0`)) {
        pushUnit(`${unit}_r`, ti, true, left, right);
      }
    });
    sil();
  });
  void stEmit;
  void stStay;
  void stGo;
  const N = chain.length;
  const T = feats.length;
  // Segment-level skip: a skippable unit (3 states) may be bypassed.
  let prev = new Float64Array(N).fill(-Infinity);
  const back = [];
  for (let t = 0; t < T; t++) {
    const cur = new Float64Array(N).fill(-Infinity);
    const bp = new Int32Array(N).fill(-1);
    for (let n = 0; n < N; n++) {
      let score = -Infinity;
      let arg = -1;
      if (t === 0) {
        // Start in the first state or after skipping leading silence.
        if (n === 0 || (n === 3 && chain[0].skippable)) {
          score = n === 0 ? 0 : silencePenalty;
        }
      } else {
        score = prev[n] + chain[n].stay;
        arg = n;
        if (n > 0) {
          const go = prev[n - 1] + chain[n - 1].go;
          if (go > score) {
            score = go;
            arg = n - 1;
          }
        }
        // Skip a whole optional unit ending at n-1.
        if (n >= 4 && chain[n - 3].skippable) {
          const go =
            prev[n - 4] + chain[n - 4].go + (chain[n - 3].sil ? 0 : -1);
          if (go > score) {
            score = go;
            arg = n - 4;
          }
        }
      }
      if (score > -Infinity) {
        score += gmmScore(model.states[chain[n].m].model, feats[t]);
      }
      cur[n] = score;
      bp[n] = arg;
    }
    back.push(bp);
    prev = cur;
  }
  let at = N - 1;
  if (prev[N - 4] > prev[N - 1]) {
    at = N - 4;
  }
  const path = new Int32Array(T);
  for (let t = T - 1; t >= 0; t--) {
    path[t] = at;
    at = back[t][at];
  }
  const spans = tokens.map(() => [Infinity, -Infinity]);
  for (let t = 0; t < T; t++) {
    const ti = chain[path[t]].token;
    if (ti >= 0) {
      spans[ti][0] = Math.min(spans[ti][0], t);
      spans[ti][1] = Math.max(spans[ti][1], t + 1);
    }
  }
  return tokens.map((tk, i) => ({ ...tk, from: spans[i][0], to: spans[i][1] }));
}
