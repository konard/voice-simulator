/** Bounded trie edit search; paths never cross a hard boundary. */
import { phoneDistance, gapCost, voicingDistance } from './phone-distance.js';
import { soundKey } from './lexicon.js';
import { formatIpa } from '../ipa/parse.js';
import { syllabifyTokens } from '../ipa/syllables.js';
import { bestTone } from './prosody-features.js';

const TONE_LEVELS = '˩˨˧˦˥';
const MANDARIN_TONES = ['5', '35', '214', '51', '', '21'];
const toneLetters = (token) =>
  (token.tone ?? []).map((level) => TONE_LEVELS[level - 1]).join('');

function acousticTone(input, expected, language) {
  if (language === 'zh' && input.tones) {
    const cost = input.tones[toneLetters(expected)];
    if (Number.isFinite(cost)) {
      return 0.5 * cost;
    }
  }
  return undefined;
}

function heardTone(token) {
  if (token.tone?.length) {
    return token.tone.join('');
  }
  return Array.from(
    bestTone(token.tones),
    (letter) => TONE_LEVELS.indexOf(letter) + 1
  ).join('');
}

function allowed(entry, tokens, to, end, language) {
  if (language !== 'zh') {
    return true;
  }
  const tone = entry.tokens.at(-1)?.tone?.join('');
  const next = tokens.slice(to, end).map(heardTone).find(Boolean);
  if (entry.word === '一' && tone === '35') {
    return next === '51';
  }
  if (entry.word === '一' && tone === '51') {
    return Boolean(next) && next !== '51';
  }
  if (entry.word === '不' && tone === '35') {
    return next === '51';
  }
  return true;
}

function cheapest(states, beam) {
  const seen = new Map();
  for (const state of states) {
    if (!seen.has(state.node) || state.cost < seen.get(state.node).cost) {
      seen.set(state.node, state);
    }
  }
  return [...seen.values()].sort((a, b) => a.cost - b.cost).slice(0, beam);
}

/** Insert missing input sounds, with a finite cost threshold and beam. */
function insertions(states, limit, beam) {
  let all = cheapest(states, beam);
  let frontier = all;
  while (frontier.length) {
    const next = [];
    const known = new Map(all.map((s) => [s.node, s.cost]));
    for (const state of frontier) {
      for (const node of state.node.children.values()) {
        const cost = state.cost + gapCost(node.token);
        if (cost <= limit && cost < (known.get(node) ?? Infinity)) {
          next.push({ node, cost });
        }
      }
    }
    const kept = cheapest([...all, ...next], beam);
    const old = new Map(all.map((s) => [s.node, s.cost]));
    frontier = kept.filter((s) => s.cost < (old.get(s.node) ?? Infinity));
    all = kept;
  }
  return all;
}

function exactKeys(tokens, to, end, language) {
  const token = tokens[to];
  const keys = [soundKey(token, language)];
  if (language === 'zh' && token.tones) {
    return MANDARIN_TONES.map((tone) => `${token.symbol}:${tone}`);
  }
  const nextTone = tokens
    .slice(to + 1, end)
    .find((t) => t.tone?.length)
    ?.tone?.join('');
  if (
    language === 'zh' &&
    token.tone?.join('') === '35' &&
    ['21', '214'].includes(nextTone)
  ) {
    keys.push(
      soundKey({ ...token, tone: [2, 1, 4] }, language),
      soundKey({ ...token, tone: [2, 1] }, language)
    );
  }
  return keys;
}

function acousticStress(entry, heard, language) {
  if (
    !['en', 'ru'].includes(language) ||
    !heard.some((token) => Number.isFinite(token.prominence))
  ) {
    return 0;
  }
  const expected = syllabifyTokens(entry.tokens, { language });
  const primary = expected.findIndex((syllable) =>
    syllable.some((token) => token.stress === 1)
  );
  const nuclei = syllabifyTokens(heard, { language });
  if (expected.length < 2 || nuclei.length !== expected.length || primary < 0) {
    return 0;
  }
  const scores = nuclei.map((syllable) =>
    syllable.reduce(
      (score, token) => Math.max(score, token.prominence ?? -Infinity),
      -Infinity
    )
  );
  return scores[primary] < Math.max(...scores) ? 0.3 : 0;
}

function stressCost(entry, tokens, from, used, language) {
  const heard = tokens.slice(from, from + used);
  if (heard.some((token) => Number.isFinite(token.prominence))) {
    return acousticStress(entry, heard, language);
  }
  if (entry.tokens.length !== used) {
    return 0;
  }
  let cost = 0;
  for (let k = 0; k < used; k++) {
    cost += 0.2 * Number(tokens[from + k].stress !== entry.tokens[k].stress);
  }
  return cost;
}

/** Exact paths are retained separately so homophones cannot consume the beam. */
export function exactCandidates(tokens, from, end, lexicon, language) {
  const result = [];
  let states = [{ node: lexicon.root, sandhi: false, cost: 0 }];
  for (let to = from; to < end; to++) {
    const keys = exactKeys(tokens, to, end, language);
    const next = [];
    for (const state of states) {
      for (const key of keys) {
        const node = state.node.children.get(key);
        if (!node) {
          continue;
        }
        const token = tokens[to];
        const sandhi = state.sandhi || (!token.tones && key !== keys[0]);
        const cost =
          state.cost +
          (acousticTone(token, node.token, language) ?? 0) +
          (Number.isFinite(token.voicing)
            ? 0.25 * voicingDistance(token, node.token)
            : 0);
        next.push({ node, sandhi, cost });
        for (const entry of node.entries) {
          if (!allowed(entry, tokens, to + 1, end, language)) {
            continue;
          }
          result.push({
            from,
            to: to + 1,
            ...entry,
            ...(sandhi ? { ipa: formatIpa(tokens.slice(from, to + 1)) } : {}),
            cost:
              cost +
              acousticStress(entry, tokens.slice(from, to + 1), language),
          });
        }
      }
    }
    states = next;
    if (!states.length) {
      break;
    }
  }
  return result;
}

/** Per-call memoized feature comparisons avoid repeating work at trie forks. */
export function distanceCache() {
  const cache = new Map();
  return (input, expected, language) => {
    // Stress is evaluated at the terminal: the trie shares stressed and
    // unstressed versions of the same segment path.
    const a = `${input.symbol}:${(input.tone ?? []).join('')}:${input.voicing ?? ''}:${JSON.stringify(input.tones ?? null)}`;
    const b = `${expected.symbol}:${(expected.tone ?? []).join('')}`;
    const tone = acousticTone(input, expected, language);
    const key = `${a}\t${b}\t${tone ?? ''}`;
    if (!cache.has(key)) {
      cache.set(
        key,
        phoneDistance({ ...input, stress: 0 }, { ...expected, stress: 0 }, tone)
      );
    }
    return cache.get(key);
  };
}

export function candidatesAt(tokens, from, end, lexicon, options) {
  const { beam, language, distance } = options;
  const found = exactCandidates(tokens, from, end, lexicon, language);
  let states = insertions([{ node: lexicon.root, cost: 0 }], 0.6, beam);
  for (let index = from; index < end && states.length; index++) {
    const used = index - from + 1;
    const limit = 0.6 * (used + 1);
    const next = [];
    for (const state of states) {
      const deletion = state.cost + gapCost(tokens[index]);
      if (deletion <= limit) {
        next.push({ node: state.node, cost: deletion });
      }
      for (const node of state.node.children.values()) {
        const cost = state.cost + distance(tokens[index], node.token, language);
        if (cost <= limit) {
          next.push({ node, cost });
        }
      }
    }
    states = insertions(cheapest(next, beam), limit, beam);
    for (const state of states) {
      for (const entry of state.node.entries) {
        if (!allowed(entry, tokens, index + 1, end, language)) {
          continue;
        }
        const cost =
          state.cost + stressCost(entry, tokens, from, used, language);
        found.push({ from, to: index + 1, ...entry, cost });
      }
    }
    // No word in the trie can use a longer path than its longest word
    // plus the allowed deletion budget. The positive gap costs and input
    // length also bound the insertion closure.
  }
  const unique = new Map();
  for (const item of found) {
    const key = `${item.to}\t${item.word}\t${item.ipa}`;
    if (item.cost < (unique.get(key)?.cost ?? Infinity)) {
      unique.set(key, item);
    }
  }
  return [...unique.values()];
}
