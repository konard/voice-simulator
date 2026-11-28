/**
 * Gaussian mixture HMM states estimated from the simulator's own renders
 * (scripts/build-hmm-model.mjs). Every phone unit has three left-to-right
 * states; entry and exit states may have versions for the neighbouring
 * phone ("p:k") or, with fewer training frames, its broad class ("dor").
 * Mandarin vowels carry a tone class ("a@4").
 * Unlicense.
 */
import { CONSONANTS, VOWELS } from '../ipa/inventory.js';
import { readHmmModel } from './data/hmm-model.js';
import { HMM_TONE } from './data/hmm-tone.js';
import { unpackHmmTone } from './hmm-tone.js';

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
const VALUES_PER_DIMENSION = 256;

/** Keep mixture codes and expand each distinct value only once per dimension. */
export function unpackHmmModel(data) {
  const { lda, units, contexts, durations, mixtures } = data;
  const contextUnits = contexts.map((key) => units.indexOf(key.split('#')[0]));
  const dims = lda.dims;
  const counts = bytes(mixtures.counts);
  const weights = int8(mixtures.weights);
  const meanCodes = bytes(mixtures.means);
  const varCodes = bytes(mixtures.logVars);
  const [meanScale, meanOffset, varScale, varOffset] = [
    mixtures.meanScale,
    mixtures.meanOffset,
    mixtures.varScale,
    mixtures.varOffset,
  ].map(float32);
  const total = weights.length;
  const muTable = new Float32Array(dims * VALUES_PER_DIMENSION);
  const invTable = new Float32Array(muTable.length);
  const normalizers = new Float64Array(muTable.length);
  const gaussian = Math.log(2 * Math.PI);
  for (let d = 0; d < dims; d++) {
    for (let code = 0; code < VALUES_PER_DIMENSION; code++) {
      const signed = code < 128 ? code : code - VALUES_PER_DIMENSION;
      const k = d * VALUES_PER_DIMENSION + code;
      muTable[k] = meanOffset[d] + meanScale[d] * signed;
      const logVar = varOffset[d] + varScale[d] * signed;
      invTable[k] = 0.5 * Math.exp(-logVar);
      normalizers[k] = 0.5 * (gaussian + logVar);
    }
  }
  const norm = new Float64Array(total);
  for (let c = 0; c < total; c++) {
    let sum = (weights[c] / 127) * mixtures.weightRange;
    for (let d = 0; d < dims; d++) {
      sum -= normalizers[d * VALUES_PER_DIMENSION + varCodes[c * dims + d]];
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
    parameters: { meanCodes, varCodes, muTable, invTable },
    norm,
    stay,
    go,
    ciIndex,
    contextIndex,
  };
}

/** Expand mixtures directly into the caller's buffers, such as linear memory. */
export function writeGaussianParameters(model, mu, inv) {
  const { dims, parameters } = model;
  if (!parameters) {
    mu.set(model.mu);
    inv.set(model.inv);
    return;
  }
  const { meanCodes, varCodes, muTable, invTable } = parameters;
  for (let base = 0; base < meanCodes.length; base += dims) {
    for (let d = 0; d < dims; d++) {
      const i = base + d;
      const k = d * VALUES_PER_DIMENSION;
      mu[i] = muTable[k + meanCodes[i]];
      inv[i] = invTable[k + varCodes[i]];
    }
  }
}

let model;
/** The shipped model, unpacked on first use. */
export function getHmmModel() {
  if (!model) {
    model = unpackHmmModel(readHmmModel());
    model.tone = unpackHmmTone(HMM_TONE, model.units, model.contextIndex);
  }
  return model;
}

/** Log likelihood of a frame for state m, optionally written to scores[m]. */
export function stateScore(m, feats, offset, model, scores) {
  const { first, norm, dims, parameters } = model;
  let max = -Infinity;
  let sum = 0;
  for (let c = first[m]; c < first[m + 1]; c++) {
    let s = norm[c];
    const base = c * dims;
    if (parameters) {
      const { meanCodes, varCodes, muTable, invTable } = parameters;
      for (let d = 0; d < dims; d++) {
        const i = base + d;
        const k = d * VALUES_PER_DIMENSION;
        const e = feats[offset + d] - muTable[k + meanCodes[i]];
        s -= e * e * invTable[k + varCodes[i]];
      }
    } else {
      const { mu, inv } = model;
      for (let d = 0; d < dims; d++) {
        const e = feats[offset + d] - mu[base + d];
        s -= e * e * inv[base + d];
      }
    }
    if (s > max) {
      sum = sum * Math.exp(max - s) + 1;
      max = s;
    } else {
      sum += Math.exp(s - max);
    }
  }
  const score = max + Math.log(sum);
  if (scores) {
    scores[m] = score;
  } else {
    return score;
  }
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
  // An entry state depends only on the left phone; an exit state only
  // on the right phone. The middle state has no context variants.
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
  const context = (s === 0 ? left : s === 2 ? right : null) ?? null;
  const states = byState[s];
  let index = states.get(context);
  if (index === undefined && !states.has(context)) {
    index = findState(
      model,
      unit,
      s,
      s === 0 ? context : null,
      s === 2 ? context : null
    );
    states.set(context, index);
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
