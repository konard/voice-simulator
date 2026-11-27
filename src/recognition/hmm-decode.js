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
  const { words } = network;
  // A bounded pair cache with no per-candidate allocations. Different
  // pronunciation IDs can spell the same word and get the same score.
  const capacity = 16384;
  const histories = new Int32Array(capacity);
  const candidates = new Uint32Array(capacity);
  const costs = new Float64Array(capacity);
  return (hist, id, tree) => {
    const { wordTable: packed, data, loop } = tree;
    if (packed ? packed.oov(id) : words[id].oov) {
      const beginning = packed ? packed.begin(id) : words[id].begin;
      const phone = previousPhone(packed, words, id);
      const before = beginning
        ? ''
        : previousPhone(packed, words, records[hist].id);
      return oovWeight * loop.bigram.get(before).get(phone) + oovPhone;
    }
    const record = records[hist];
    const history = record?.id ?? -1;
    const slot =
      (Math.imul(history, 0x9e3779b1) ^ Math.imul(id, 0x85ebca6b)) &
      (capacity - 1);
    if (histories[slot] === history && candidates[slot] === id + 1) {
      return costs[slot];
    }
    const word = packed ? packed.name(id) : words[id].word;
    const count = packed ? packed.count(id) : words[id].count;
    const previous = record?.word;
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
  for (const lang of languages) {
    const tree = network.trees.get(lang);
    const startRecord = records.length;
    records.push({ word: null, lang, prev: -1, start: 0, end: 0, score: 0 });
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
function restart(next, network, records, rec, settings) {
  const { lmw, silencePenalty, oovStart } = settings;
  const r = records.length;
  records.push(rec);
  const tree = network.trees.get(rec.lang);
  const { before } = rec;
  const { lookLn } = network.nodes;
  if (before) {
    for (const child of tree.after.get(before)) {
      next.enter(child, rec.score + lmw * lookLn[child], r, rec.end);
    }
    return;
  }
  for (const child of tree.root) {
    next.enter(child, rec.score + lmw * lookLn[child], r, rec.end);
  }
  for (const node of tree.loop.begin) {
    next.enter(node, rec.score + oovStart, r, rec.end);
  }
  if (rec.oov) {
    for (const node of tree.loop.next) {
      next.enter(node, rec.score, r, rec.end);
    }
  }
  next.enter(tree.silence, rec.score + silencePenalty, r, rec.end);
}

/** The best word that ended on `end` and needs no following word. */
function bestEndingAt(records, end) {
  let best = null;
  for (const r of records) {
    if (
      r.word !== null &&
      r.end === end &&
      !r.before &&
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
  const { positions, scores, histories } = last;
  let best = bestEndingAt(records, frames);
  for (const lang of languages) {
    const sil = network.trees.get(lang).silence;
    const position = positions[sil];
    const j = (position - 1) * 6 + 2;
    if (position && scores[j] > (best?.score ?? -Infinity)) {
      const h = histories[j];
      if (h >= 0 && records[h].word !== null) {
        best = { ...records[h], score: scores[j] };
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
  return end < 0 ? null : bestEndingAt(records, end);
}

/**
 * Words of the best record back to the start; loop phones that go on with
 * an out-of-vocabulary word join it.
 */
function backtrace(network, records, best) {
  const out = [];
  for (let r = best; r && r.word !== null; r = records[r.prev] ?? null) {
    const table = network.trees.get(r.lang).wordTable;
    const word = table ? table.read(r.id) : network.words[r.id];
    const units =
      word.units ??
      (r.lang === 'zh'
        ? toneUnits(word.tokens)
        : word.tokens.map((token) => token.symbol));
    const w = { ...word, units, start: r.start, end: r.end };
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
export function createThresholds(nodes, languageCount, settings) {
  const { beam, languageBeam, maxActive } = settings;
  const rows = Array.from(
    { length: languageCount },
    () => new Float64Array(256)
  );
  const sizes = new Uint32Array(languageCount);
  const peaks = new Float64Array(languageCount);
  const thresholds = new Float64Array(languageCount);
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
    for (let i = 0; i < rows.length; i++) {
      let threshold = Math.max(peaks[i] - beam, best - languageBeam);
      if (sizes[i] > maxActive) {
        rows[i].subarray(0, sizes[i]).sort();
        threshold = Math.max(threshold, rows[i][sizes[i] - maxActive]);
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

function createWorkspace(nodeCount) {
  return {
    positions: new Uint32Array(nodeCount),
    previous: stateFrame(256),
    current: stateFrame(256),
    entries: createFrontier(nodeCount),
    next: createFrontier(nodeCount),
    work: [],
    processed: [],
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
    prior?.positions.length >= network.nodeCount
      ? prior
      : createWorkspace(network.nodeCount);
  // A word-end callback can start another decode synchronously.
  workspaces.delete(network.model);
  try {
    return decodeWithWorkspace(network, feats, frames, options, workspace);
  } finally {
    workspace.entries.clear();
    workspace.next.clear();
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
  const score = emissionCache(network.model, feats, settings);
  let { previous, current, entries, next } = workspace;
  const { positions, work, processed } = workspace;
  positions.fill(0);
  const records = [];
  const lm = languageModel(network, records, settings);
  const thresholdsOf = createThresholds(
    nodes.language,
    network.languages.length,
    settings
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
    for (const { score, language, before, id, prev, start } of wordEnds) {
      if (score >= thresholds[language]) {
        const lang = network.languages[language];
        const packed = trees.get(lang).wordTable;
        restart(
          next,
          network,
          records,
          {
            word: packed ? packed.name(id) : words[id].word,
            before,
            id,
            lang,
            prev,
            start,
            end: t + 1,
            score,
            oov: packed ? packed.oov(id) : Boolean(words[id].oov),
          },
          settings
        );
      }
    }
    entries.clear();
    [entries, next] = [next, entries];
    [previous, current] = [current, previous];
  }
  const best = finalRecord(network, records, languages, frames, {
    positions,
    ...previous,
  });
  workspace.previous = previous;
  workspace.current = current;
  return {
    words: backtrace(network, records, best),
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
