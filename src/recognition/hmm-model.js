/**
 * Gaussian mixture HMM states estimated from the simulator's own renders
 * (scripts/build-hmm-model.mjs). Every phone unit has three left-to-right
 * states; entry and exit states may have versions for the neighbouring
 * phone ("p:k") or, with fewer training frames, its broad class ("dor").
 * Mandarin vowels carry a tone class ("a@4").
 * Unlicense.
 */
import { CONSONANTS, VOWELS } from '../ipa/inventory.js';
import { HMM_MODEL } from './data/hmm-model.js';

const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const SEXTETS = new Uint8Array(128);
for (let i = 0; i < 64; i++) {
  SEXTETS[BASE64.charCodeAt(i)] = i;
}

/** Bytes of a padded base64 string, in a fresh (aligned) buffer. */
function bytes(base64) {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((base64.length / 4) * 3 - padding);
  let o = 0;
  for (let i = 0; i < base64.length; i += 4) {
    const n =
      (SEXTETS[base64.charCodeAt(i)] << 18) |
      (SEXTETS[base64.charCodeAt(i + 1)] << 12) |
      (SEXTETS[base64.charCodeAt(i + 2)] << 6) |
      SEXTETS[base64.charCodeAt(i + 3)];
    out[o++] = n >> 16;
    if (o < out.length) {
      out[o++] = (n >> 8) & 255;
    }
    if (o < out.length) {
      out[o++] = n & 255;
    }
  }
  return out;
}

const float32 = (base64) => new Float32Array(bytes(base64).buffer);
const int8 = (base64) => new Int8Array(bytes(base64).buffer);

/** Unpack quantised mixtures into flat arrays for scoring. */
export function unpackHmmModel(data) {
  const { lda, units, contexts, durations, mixtures } = data;
  const contextUnits = contexts.map((key) => units.indexOf(key.split('#')[0]));
  const dims = lda.dims;
  const counts = bytes(mixtures.counts);
  const weights = int8(mixtures.weights);
  const means = int8(mixtures.means);
  const logVars = int8(mixtures.logVars);
  const [meanScale, meanOffset, varScale, varOffset] = [
    mixtures.meanScale,
    mixtures.meanOffset,
    mixtures.varScale,
    mixtures.varOffset,
  ].map(float32);
  const total = weights.length;
  const mu = new Float32Array(total * dims);
  const inv = new Float32Array(total * dims);
  const norm = new Float64Array(total);
  for (let c = 0; c < total; c++) {
    let sum = (weights[c] / 127) * mixtures.weightRange;
    for (let d = 0; d < dims; d++) {
      const i = c * dims + d;
      mu[i] = meanOffset[d] + meanScale[d] * means[i];
      const logVar = varOffset[d] + varScale[d] * logVars[i];
      inv[i] = 0.5 * Math.exp(-logVar);
      sum -= 0.5 * (Math.log(2 * Math.PI) + logVar);
    }
    norm[c] = sum;
  }
  const first = new Int32Array(counts.length + 1);
  counts.forEach((n, i) => {
    first[i + 1] = first[i] + n;
  });
  const ciIndex = new Map();
  units.forEach((unit, u) => {
    for (let s = 0; s < 3; s++) {
      ciIndex.set(`${unit}#${s}`, 3 * u + s);
    }
  });
  const contextIndex = new Map(
    contexts.map((key, i) => [key, 3 * units.length + i])
  );
  const stateUnit = Int32Array.from({ length: counts.length }, (_, i) =>
    i < 3 * units.length
      ? Math.floor(i / 3)
      : contextUnits[i - 3 * units.length]
  );
  // Mean phone durations in frames give the left-to-right transitions.
  const stay = Float64Array.from(stateUnit, (u) =>
    Math.log(1 - 3 / durations[u])
  );
  const go = Float64Array.from(stateUnit, (u) => Math.log(3 / durations[u]));
  return {
    lda: {
      ...lda,
      rows: float32(lda.rows),
      mean: float32(lda.mean),
    },
    dims,
    units,
    expansions: new Map(
      data.expansions.map(([symbol, release, optional]) => [
        symbol,
        { release, optional },
      ])
    ),
    states: counts.length,
    first,
    mu,
    inv,
    norm,
    stay,
    go,
    ciIndex,
    contextIndex,
  };
}

let model;
/** The shipped model, unpacked on first use. */
export function getHmmModel() {
  model ??= unpackHmmModel(HMM_MODEL);
  return model;
}

/** Log likelihood of frame x (offset in feats) for state m. */
export function stateScore(m, feats, offset, model) {
  const { first, mu, inv, norm, dims } = model;
  let max = -Infinity;
  let sum = 0;
  for (let c = first[m]; c < first[m + 1]; c++) {
    let s = norm[c];
    const base = c * dims;
    for (let d = 0; d < dims; d++) {
      const e = feats[offset + d] - mu[base + d];
      s -= e * e * inv[base + d];
    }
    if (s > max) {
      sum = sum * Math.exp(max - s) + 1;
      max = s;
    } else {
      sum += Math.exp(s - max);
    }
  }
  return max + Math.log(sum);
}

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

/** Broad context class of a phone symbol ("sil", "k_r", "tʲ", "aː" …). */
export function contextClass(unit) {
  if (unit === 'sil' || unit === undefined) {
    return 'sil';
  }
  const symbol = unit.endsWith('_r') ? unit.slice(0, -2) : unit;
  let c = classes.get(symbol);
  if (c) {
    return c;
  }
  // Affricates take the place of their release (t͡ʃ → postalveolar).
  const base = [...symbol].filter((ch) => VOWELS[ch] || CONSONANTS[ch]).at(-1);
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

/** Phone context of a unit symbol: "p:k" for "k", "k_r" and "k@4". */
export const phoneContext = (unit) =>
  unit === 'sil' || unit === undefined || unit === null
    ? 'sil'
    : `p:${unit.replace(/_r$|@\d$/u, '')}`;

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
 * State index of unit state s between the neighbouring phone symbols
 * (null at a word edge): the phone-context state, else the broad-class
 * state, else the context-independent one.
 */
export function stateIndex(model, unit, s, left, right) {
  // Networks ask for the same states many times: cache them by unit,
  // state, left and right phone without building string keys.
  let byUnit = stateCaches.get(model);
  if (!byUnit) {
    byUnit = new Map();
    stateCaches.set(model, byUnit);
  }
  let byState = byUnit.get(unit);
  if (!byState) {
    byState = [new Map(), new Map(), new Map()];
    byUnit.set(unit, byState);
  }
  const l = left ?? null;
  const r = right ?? null;
  let byLeft = byState[s].get(l);
  if (!byLeft) {
    byLeft = new Map();
    byState[s].set(l, byLeft);
  }
  let index = byLeft.get(r);
  if (index === undefined) {
    index = findState(model, unit, s, l, r);
    byLeft.set(r, index);
  }
  return index;
}

const stateCaches = new WeakMap();

function findState(model, unit, s, l, r) {
  const phone = contextKey(unit, s, l && phoneContext(l), r && phoneContext(r));
  const byPhone = phone ? model.contextIndex.get(phone) : undefined;
  if (byPhone !== undefined) {
    return byPhone;
  }
  const broad = contextKey(unit, s, l && contextClass(l), r && contextClass(r));
  const byClass = broad ? model.contextIndex.get(broad) : undefined;
  return byClass ?? model.ciIndex.get(`${unit}#${s}`);
}

/** Tone class of token tone levels: 1 level, 2 rising, 3 low, 4 falling. */
export function toneClass(tone) {
  if (!tone?.length) {
    return 0;
  }
  const [a] = tone;
  const b = tone.at(-1);
  if (tone.length === 3 || (a <= 2 && b <= 2)) {
    return 3;
  }
  return b > a ? 2 : b < a ? 4 : 1;
}

/**
 * Unit names of a token list: the vowels of a toned syllable (the toned
 * vowel and the vowels right before it) take its tone class, as "a@4".
 */
export function toneUnits(tokens) {
  const units = tokens.map((t) => t.symbol);
  for (let i = 0; i < tokens.length; i++) {
    const c = toneClass(tokens[i].tone);
    if (!c) {
      continue;
    }
    for (let j = i; j >= 0 && tokens[j].kind === 'vowel'; j--) {
      if (j < i && tokens[j].tone?.length) {
        break;
      }
      units[j] = `${tokens[j].symbol}@${c}`;
    }
  }
  return units;
}
