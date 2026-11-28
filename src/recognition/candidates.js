/** Bounded trie edit search; paths never cross a hard boundary. */
import { phoneDistance, voicingDistance } from './phone-distance.js';
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
  if (language !== 'zh' || (entry.word !== '一' && entry.word !== '不')) {
    return true;
  }
  const tone = entry.tokens.at(-1)?.tone?.join('');
  let next;
  for (let i = to; i < end && !next; i++) {
    next = heardTone(tokens[i]);
  }
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

function exactToneKeys(tokens, to, end) {
  const token = tokens[to];
  if (token.tones) {
    return MANDARIN_TONES.map((tone) => `${token.symbol}:${tone}`);
  }
  const keys = [soundKey(token, 'zh')];
  if (token.tone?.join('') === '35') {
    let nextTone;
    for (let i = to + 1; i < end && !nextTone; i++) {
      nextTone = tokens[i].tone?.length ? tokens[i].tone.join('') : undefined;
    }
    if (nextTone === '21' || nextTone === '214') {
      keys.push(`${token.symbol}:214`, `${token.symbol}:21`);
    }
  }
  return keys;
}

const pronunciationStress = new WeakMap();

function stressEvidence(heard, language) {
  if (!heard.some((token) => Number.isFinite(token.prominence))) {
    return { measured: false };
  }
  if (!['en', 'ru'].includes(language)) {
    return { measured: true };
  }
  const scores = syllabifyTokens(heard, { language }).map((syllable) =>
    syllable.reduce(
      (score, token) => Math.max(score, token.prominence ?? -Infinity),
      -Infinity
    )
  );
  return { measured: true, scores, peak: Math.max(...scores) };
}

function acousticStress(entry, evidence, language) {
  const { scores, peak } = evidence;
  if (!scores || scores.length < 2) {
    return 0;
  }
  let stress = pronunciationStress.get(entry);
  if (!stress) {
    const expected = syllabifyTokens(entry.tokens, { language });
    stress = {
      count: expected.length,
      primary: expected.findIndex((syllable) =>
        syllable.some((token) => token.stress === 1)
      ),
    };
    pronunciationStress.set(entry, stress);
  }
  const { count, primary } = stress;
  return count === scores.length && primary >= 0 && scores[primary] < peak
    ? 0.3
    : 0;
}

function stressCost(entry, heard, evidence, language) {
  if (evidence.measured) {
    return acousticStress(entry, evidence, language);
  }
  const { tokens } = entry;
  if (tokens.length !== heard.length) {
    return 0;
  }
  let cost = 0;
  for (let k = 0; k < heard.length; k++) {
    cost += 0.2 * Number(heard[k].stress !== tokens[k].stress);
  }
  return cost;
}

function voicingCost(token, target) {
  return Number.isFinite(token.voicing)
    ? 0.25 * voicingDistance(token, target)
    : 0;
}

function walkTonal(tokens, from, end, root, scored, visit) {
  let states = [{ node: root, sandhi: false, cost: 0 }];
  for (let to = from; to < end; to++) {
    const token = tokens[to];
    const keys = exactToneKeys(tokens, to, end);
    const next = [];
    for (const state of states) {
      for (const key of keys) {
        const node = state.node.children.get(key);
        if (!node) {
          continue;
        }
        const sandhi =
          scored && (state.sandhi || (!token.tones && key !== keys[0]));
        const cost = scored
          ? state.cost +
            (acousticTone(token, node.token, 'zh') ?? 0) +
            voicingCost(token, node.token)
          : 0;
        next.push({ node, sandhi, cost });
        if (visit(node, to + 1, sandhi, cost)) {
          return true;
        }
      }
    }
    states = next;
    if (!states.length) {
      break;
    }
  }
  return false;
}

function walkExact(tokens, from, end, root, language, { scored, visit }) {
  if (language === 'zh') {
    return walkTonal(tokens, from, end, root, scored, visit);
  }
  let node = root;
  let cost = 0;
  for (let i = from; i < end; i++) {
    const token = tokens[i];
    node = node.children.get(soundKey(token, language));
    if (!node) {
      break;
    }
    if (scored) {
      cost += voicingCost(token, node.token);
    }
    if (visit(node, i + 1, false, cost)) {
      return true;
    }
  }
  return false;
}

function hasPreparedSuffix(tokens, from, end, prepared, reachable) {
  const { root, table } = prepared;
  let id = 0;
  for (let i = from; i < end; i++) {
    id = root.childId(id, tokens[i].symbol);
    if (id === 0) {
      break;
    }
    if (table.terminal[id] && reachable.has(i + 1)) {
      return true;
    }
  }
  return false;
}

/** Whether an exact word can end at a position with a known suffix. */
export function hasExactSuffix(
  tokens,
  from,
  end,
  lexicon,
  language,
  reachable
) {
  if (language !== 'zh' && lexicon.prepared) {
    return hasPreparedSuffix(tokens, from, end, lexicon.prepared, reachable);
  }
  return walkExact(tokens, from, end, lexicon.root, language, {
    scored: false,
    visit: (node, to) =>
      reachable.has(to) &&
      node.entries.some((entry) => allowed(entry, tokens, to, end, language)),
  });
}

/** Exact paths are retained separately so homophones cannot consume the beam. */
export function exactCandidates(tokens, from, end, lexicon, language) {
  const result = [];
  let previousEnd = -1;
  let evidence;
  let sandhiIpa;
  walkExact(tokens, from, end, lexicon.root, language, {
    scored: true,
    visit(node, to, sandhi, cost) {
      if (to !== previousEnd) {
        previousEnd = to;
        evidence = undefined;
        sandhiIpa = undefined;
      }
      for (const entry of node.entries) {
        if (!allowed(entry, tokens, to, end, language)) {
          continue;
        }
        evidence ??= stressEvidence(tokens.slice(from, to), language);
        result.push({
          from,
          to,
          language,
          word: entry.word,
          ipa: sandhi
            ? (sandhiIpa ??= formatIpa(tokens.slice(from, to)))
            : entry.ipa,
          cost: cost + acousticStress(entry, evidence, language),
        });
      }
      return false;
    },
  });
  return result;
}

/** Per-call memoized feature comparisons avoid repeating work at trie forks. */
export function distanceCache() {
  const plain = new Map();
  const tonal = new Map();
  const heard = new WeakMap();
  const targets = new WeakMap();
  let size = 0;
  return (input, expected, language) => {
    // Stress is evaluated at the terminal: the trie shares stressed and
    // unstressed versions of the same segment path.
    if (!heard.has(input)) {
      heard.set(
        input,
        `${input.symbol}:${(input.tone ?? []).join('')}:${input.voicing ?? ''}:${input.whispered ?? ''}:${JSON.stringify(input.tones ?? null)}`
      );
    }
    const a = heard.get(input);
    let b = targets.get(expected);
    if (b === undefined) {
      b = `${expected.symbol}:${(expected.tone ?? []).join('')}`;
      targets.set(expected, b);
    }
    // Each heard signature shares one row of distances, so ordinary
    // comparisons can reuse the target key directly.
    const tone = acousticTone(input, expected, language);
    const cache = tone === undefined ? plain : tonal;
    const key = tone === undefined ? b : `${b}\t${tone}`;
    let row = cache.get(a);
    const previous = row?.get(key);
    if (previous !== undefined) {
      return previous;
    }
    if (size === 4096) {
      plain.clear();
      tonal.clear();
      row = undefined;
      size = 0;
    }
    if (!row) {
      row = new Map();
      cache.set(a, row);
    }
    const cost = phoneDistance(input, expected, tone, false);
    row.set(key, cost);
    size++;
    return cost;
  };
}

export function candidatesAt(tokens, from, end, lexicon, options) {
  const { beam, language, wordSearch } = options;
  if (typeof wordSearch !== 'function') {
    throw new TypeError('Approximate candidates need a word search');
  }
  const found = exactCandidates(tokens, from, end, lexicon, language);
  const { hits, entriesAt } = wordSearch(from, end, beam);
  const spans = new Map();
  for (let i = 0; i < hits.length; i += 3) {
    const to = from + hits[i];
    for (const entry of entriesAt(hits[i + 1])) {
      if (allowed(entry, tokens, to, end, language)) {
        if (!spans.has(to)) {
          const heard = tokens.slice(from, to);
          spans.set(to, { heard, evidence: stressEvidence(heard, language) });
        }
        const { heard, evidence } = spans.get(to);
        const cost = hits[i + 2] + stressCost(entry, heard, evidence, language);
        found.push({
          from,
          to,
          language,
          word: entry.word,
          ipa: entry.ipa,
          cost,
        });
      }
    }
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
