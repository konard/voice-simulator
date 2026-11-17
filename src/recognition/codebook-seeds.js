/** Phonetic seeds and independently seeded row proposals (issue 64). */
import {
  VOWELS,
  CONSONANTS,
  getPhoneme,
  listSymbols,
} from '../ipa/inventory.js';
import { CHANNEL_DEFAULTS } from '../articulation/plan.js';
import {
  vowelTarget,
  vowelChannels,
  consonantTarget,
} from '../articulation/phones.js';
import { createRandom, randomNormal } from '../random.js';
import { CODEBOOK_CHANNELS } from './codebook-features.js';

export function codebookSeeds() {
  const symbols = listSymbols();
  const rows = [
    { state: { ...CHANNEL_DEFAULTS }, phone: 0xffff, kind: 'neutral' },
  ];
  function vowel(symbol, nasalized = false) {
    const token = { phoneme: getPhoneme(symbol), nasalized };
    return {
      ...CHANNEL_DEFAULTS,
      ...vowelChannels(token),
      ...vowelTarget(token),
    };
  }
  for (const symbol of Object.keys(VOWELS)) {
    rows.push({
      state: vowel(symbol),
      phone: symbols.indexOf(symbol),
      kind: 'vowel',
    });
  }
  for (const symbol of Object.keys(VOWELS)) {
    rows.push({
      state: vowel(symbol, true),
      phone: symbols.indexOf(symbol),
      kind: 'nasalVowel',
    });
  }
  for (const symbol of Object.keys(CONSONANTS)) {
    for (const base of ['a', 'i', 'u', null]) {
      rows.push({
        state: {
          ...(base ? vowel(base) : CHANNEL_DEFAULTS),
          ...consonantTarget({ phoneme: getPhoneme(symbol) }),
        },
        phone: symbols.indexOf(symbol),
        kind: 'consonant',
      });
    }
  }
  // The table's other channels are defaults, including the source. Extract
  // only the twelve table channels, then put the source defaults back.
  return rows.map((row) => ({ ...row, state: clipState(row.state) }));
}

export function clipState(state) {
  const out = { ...CHANNEL_DEFAULTS };
  for (const { name, min, max } of CODEBOOK_CHANNELS) {
    out[name] = Math.max(
      min,
      Math.min(max, Number(state[name] ?? CHANNEL_DEFAULTS[name]))
    );
  }
  return out;
}

/** Each proposal owns a PRNG seeded by its number. */
export function proposeRow(seeds, seed, number) {
  const random = createRandom(seed + number);
  const pick = () => seeds[Math.floor(random() * seeds.length)].state;
  const kind = number % 4;
  let state;
  if (kind === 0) {
    const a = pick(),
      b = pick(),
      weight = [0.25, 0.5, 0.75][Math.floor(random() * 3)];
    state = {};
    for (const { name } of CODEBOOK_CHANNELS) {
      state[name] = a[name] * (1 - weight) + b[name] * weight;
    }
  } else if (kind <= 2) {
    const base = pick();
    state = {};
    for (const { name, min, max } of CODEBOOK_CHANNELS) {
      state[name] = base[name] + randomNormal(random) * 0.1 * (max - min);
    }
  } else {
    state = {
      ...CHANNEL_DEFAULTS,
      height: random(),
      backness: random(),
      rounding: random(),
      rhotic: random() < 0.1 ? 1 : 0,
    };
  }
  return {
    state: clipState(state),
    phone: 0xffff,
    kind: kind === 0 ? 'mixture' : kind <= 2 ? 'perturbed' : 'randomVowel',
  };
}
