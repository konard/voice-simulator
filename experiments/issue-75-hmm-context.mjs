/* eslint-disable complexity */
/**
 * Context-dependent HMM states: the entry state of a phone depends on the
 * broad class of the previous phone and the exit state on the next one.
 * Classes come from the IPA inventory (place for consonants, backness for
 * vowels). Unlicense.
 */
import { CONSONANTS, VOWELS } from '../src/ipa/inventory.js';
import { decodeFeats, fitGmm, itemDim } from './issue-75-hmm-model.mjs';

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

/** Broad context class of a unit symbol ("sil", "k_r", "tʲ", "aː" …). */
export function contextClass(unit) {
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
  const pools = new Map();
  const durations = new Map();
  const D = itemDim(items[0]);
  const add = (key, x) => {
    let p = pools.get(key);
    if (!p) {
      p = [];
      pools.set(key, p);
    }
    p.push(x);
  };
  for (const item of items) {
    const f = decodeFeats(item.feats);
    const { left, right } = frameContexts(item.labels);
    let prev = null;
    let run = 0;
    for (let t = 0; t < item.frames; t++) {
      const label = item.labels[t];
      const s = item.states[t];
      const x = f.subarray(t * D, t * D + D);
      add(`${label}#${s}`, x);
      const key = contextKey(label, s, left[t], right[t]);
      if (key) {
        add(key, x);
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
  const fit = (key, k) => fitGmm(pools.get(key), k);
  for (const u of units) {
    const [frames, n] = durations.get(u) ?? [9, 3];
    const mean = Math.max(3, frames / n);
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
  for (const [key, frames] of [...pools].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!/[<>]/u.test(key) || frames.length < minFrames) {
      continue;
    }
    const ci = states[ciIndex.get(key.split(/[<>]/u)[0])];
    contextIndex.set(key, states.length);
    states.push({ ...ci, context: key, model: fit(key, Kcd) });
  }
  return { units, states, contextIndex };
}
