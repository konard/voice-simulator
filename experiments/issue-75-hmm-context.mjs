/* eslint-disable complexity */
/**
 * Context-dependent HMM states: the entry state of a phone depends on the
 * broad class of the previous phone and the exit state on the next one.
 * Classes come from the IPA inventory (place for consonants, backness for
 * vowels). Unlicense.
 */
import { CONSONANTS, VOWELS } from '../src/ipa/inventory.js';
import {
  decodeFeats,
  fitGmm,
  gmmScore,
  itemDim,
} from './issue-75-hmm-model.mjs';

const PLACE = {
  bilabial: 'lab',
  labiodental: 'lab',
  'labial-velar': 'lab',
  'labial-palatal': 'lab',
  dental: 'cor',
  alveolar: 'cor',
  postalveolar: 'pal',
  alveolopalatal: 'pal',
  palatal: 'pal',
  retroflex: 'ret',
  velar: 'dor',
  uvular: 'dor',
  glottal: 'glo',
  pharyngeal: 'glo',
};

const classes = new Map();
// CONTEXT=phone keys context states on the neighbouring phone ("p:k"), backing
// off to its broad class when the phone context has too few frames.
const PHONE_CONTEXT = process.env.CONTEXT === 'phone';

/** Context of a unit symbol: its broad class, or the phone with CONTEXT=phone. */
export function contextClass(unit) {
  if (unit === 'sil' || unit === undefined) {
    return 'sil';
  }
  if (PHONE_CONTEXT) {
    return `p:${unit.replace(/_r$|@\d$/u, '')}`;
  }
  return broadClass(unit);
}

/** The broad class of a context ("p:k" → "dor"). */
export const broadOf = (context) =>
  context?.startsWith('p:') ? broadClass(context.slice(2)) : context;

/** Broad context class of a unit symbol ("sil", "k_r", "tʲ", "aː" …). */
export function broadClass(unit) {
  if (unit === 'sil' || unit === undefined) {
    return 'sil';
  }
  const symbol = unit.endsWith('_r') ? unit.slice(0, -2) : unit;
  let c = classes.get(symbol);
  if (c) {
    return c;
  }
  const bases = [...symbol].filter((ch) => VOWELS[ch] || CONSONANTS[ch]);
  // Affricates take the place of their release (t͡ʃ → postalveolar).
  const base = bases.at(-1);
  if (VOWELS[base]) {
    const v = VOWELS[base];
    c = v.backness < 0.35 ? 'vF' : v.backness > 0.65 || v.rounded ? 'vB' : 'vC';
  } else if (CONSONANTS[base]) {
    c = symbol.includes('ʲ') ? 'pal' : (PLACE[CONSONANTS[base].place] ?? 'cor');
  } else {
    c = 'cor';
  }
  classes.set(symbol, c);
  return c;
}

const baseOf = (label) => (label.endsWith('_r') ? label.slice(0, -2) : label);

/** Per-frame left and right context classes from the label runs. */
export function frameContexts(labels) {
  const runs = [];
  for (let t = 0; t < labels.length; t++) {
    const b = baseOf(labels[t]);
    const last = runs.at(-1);
    if (last && last.base === b) {
      last.to = t + 1;
    } else {
      runs.push({ base: b, from: t, to: t + 1 });
    }
  }
  const left = new Array(labels.length);
  const right = new Array(labels.length);
  runs.forEach((run, i) => {
    const l = contextClass(runs[i - 1]?.base);
    const r = contextClass(runs[i + 1]?.base);
    for (let t = run.from; t < run.to; t++) {
      left[t] = l;
      right[t] = r;
    }
  });
  return { left, right };
}

/** Key of the context-dependent version of a state, or null. */
export function contextKey(unit, s, left, right) {
  if (unit === 'sil' || s === 1) {
    return null;
  }
  if (s === 0) {
    return unit.endsWith('_r') || !left ? null : `${unit}#0<${left}`;
  }
  return right ? `${unit}#2>${right}` : null;
}

/**
 * Train context-independent states (layout: unit × 3) and append
 * context-dependent entry/exit states with at least minFrames frames.
 */
export function trainContextModel(
  items,
  { K = 16, Kcd = 8, minFrames = 120 } = {}
) {
  // A pool holds (item, frame) index pairs, not a view per frame: three
  // views per frame of 48 training files exceed a 3 GB machine. The views of
  // one pool are made when it is fitted, in the same order.
  const pools = new Map();
  const durations = new Map();
  const D = itemDim(items[0]);
  const feats = items.map((item) => decodeFeats(item.feats));
  const add = (key, i, t) => {
    let p = pools.get(key);
    if (!p) {
      p = [];
      pools.set(key, p);
    }
    p.push(i, t);
  };
  const frames = (key) => {
    const p = pools.get(key);
    const out = new Array(p.length / 2);
    for (let j = 0; j < p.length; j += 2) {
      out[j / 2] = feats[p[j]].subarray(p[j + 1] * D, p[j + 1] * D + D);
    }
    return out;
  };
  for (const [i, item] of items.entries()) {
    const { left, right } = frameContexts(item.labels);
    let prev = null;
    let run = 0;
    for (let t = 0; t < item.frames; t++) {
      const label = item.labels[t];
      const s = item.states[t];
      add(`${label}#${s}`, i, t);
      const key = contextKey(label, s, left[t], right[t]);
      if (key) {
        add(key, i, t);
        const broad = contextKey(label, s, broadOf(left[t]), broadOf(right[t]));
        if (broad !== key) {
          add(broad, i, t);
        }
      }
      if (label !== prev) {
        if (prev !== null) {
          const d = durations.get(prev) ?? [0, 0];
          durations.set(prev, [d[0] + run, d[1] + 1]);
        }
        prev = label;
        run = 0;
      }
      run++;
    }
  }
  const units = [
    ...new Set(
      [...pools.keys()]
        .filter((k) => !/[<>]/u.test(k))
        .map((k) => k.split('#')[0])
    ),
  ].sort();
  const states = [];
  const fit = (key, k) => fitGmm(frames(key), k);
  for (const u of units) {
    const [total, n] = durations.get(u) ?? [9, 3];
    const mean = Math.max(3, total / n);
    for (let s = 0; s < 3; s++) {
      const key = [`${u}#${s}`, `${u}#1`, `${u}#0`, `${u}#2`].find((k) =>
        pools.has(k)
      );
      states.push({
        unit: u,
        s,
        model: fit(key, K),
        stay: Math.log(1 - 3 / mean),
        go: Math.log(3 / mean),
      });
    }
  }
  const contextIndex = new Map();
  const ciIndex = new Map(states.map((st, i) => [`${st.unit}#${st.s}`, i]));
  for (const [key, pool] of [...pools].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!/[<>]/u.test(key) || pool.length / 2 < minFrames) {
      continue;
    }
    const ci = states[ciIndex.get(key.split(/[<>]/u)[0])];
    contextIndex.set(key, states.length);
    states.push({ ...ci, context: key, model: fit(key, Kcd) });
  }
  return { units, states, contextIndex };
}

/**
 * Viterbi re-segmentation of each labelled run into its three states with
 * the context-independent state mixtures (every state keeps one frame).
 */
export function realignStates(items, model) {
  const ci = new Map();
  model.states.forEach((st) => {
    if (!st.context) {
      ci.set(`${st.unit}#${st.s}`, st.model);
    }
  });
  let moved = 0;
  let total = 0;
  const out = items.map((item) => {
    const f = decodeFeats(item.feats);
    const D = f.length / item.frames;
    const states = Int8Array.from(item.states);
    let from = 0;
    for (let t = 1; t <= item.frames; t++) {
      if (t < item.frames && item.labels[t] === item.labels[from]) {
        continue;
      }
      const length = t - from;
      const label = item.labels[from];
      const gmms = [0, 1, 2].map((k) => ci.get(`${label}#${k}`));
      if (length >= 3 && gmms.every(Boolean)) {
        const score = Array.from({ length }, () => new Float64Array(3));
        const back = Array.from({ length }, () => new Int8Array(3));
        for (let i = 0; i < length; i++) {
          const x = f.subarray((from + i) * D, (from + i + 1) * D);
          for (let k = 0; k < 3; k++) {
            const stay = i ? score[i - 1][k] : k === 0 ? 0 : -Infinity;
            const step = i && k ? score[i - 1][k - 1] : -Infinity;
            back[i][k] = step > stay ? k - 1 : k;
            score[i][k] = Math.max(stay, step) + gmmScore(gmms[k], x);
          }
        }
        let k = 2;
        for (let i = length - 1; i >= 0; i--) {
          total++;
          if (states[from + i] !== k) {
            moved++;
          }
          states[from + i] = k;
          k = back[i][k];
        }
      }
      from = t;
    }
    return { ...item, states };
  });
  console.log(
    'realigned',
    (moved / Math.max(1, total)).toFixed(3),
    'of frames moved'
  );
  return out;
}
