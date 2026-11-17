/** Language and language changes from IPA alone; no stored pronunciation data. */
import { parseIpa, formatIpa } from '../ipa/parse.js';
import { syllabifyTokens } from '../ipa/syllables.js';
import { LANGUAGES } from '../g2p/index.js';
import { checkLanguage } from './languages.js';
import { recognitionInput } from './input.js';
import { ipaToText } from './ipa-to-text.js';
import {
  LANGUAGE_MODEL,
  getLanguageModel,
  phoneProbability,
  languagePath,
} from './language-model.js';

function nonnegative(value, name, fallback) {
  const result = value ?? fallback;
  if (!Number.isFinite(result) || result < 0) {
    throw new RangeError(`${name} must be finite and nonnegative`);
  }
  return result;
}

export function languageUnits(input, languages) {
  const { tokens, boundaries, pauses } = input;
  const models = languages.map(getLanguageModel);
  const units = [];
  const ends = [...boundaries].sort((a, b) => a - b);
  for (let i = 1; i < ends.length; i++) {
    let from = ends[i - 1];
    let a = '#';
    let b = '#';
    for (const syllable of syllabifyTokens(tokens.slice(from, ends[i]))) {
      const scores = Object.fromEntries(
        languages.map((language) => [language, 0])
      );
      for (const token of syllable) {
        for (let l = 0; l < languages.length; l++) {
          scores[languages[l]] += Math.log(
            phoneProbability(models[l], a, b, token.symbol)
          );
        }
        a = b;
        b = token.symbol;
      }
      if (syllable.some((t) => t.tone?.length) && languages.includes('zh')) {
        scores.zh += LANGUAGE_MODEL.tone;
      }
      const to = from + syllable.length;
      units.push({ from, to, pause: pauses.has(from), scores });
      from = to;
    }
  }
  return units;
}

function collectSpans(units, path) {
  const spans = [];
  for (let u = 0; u < units.length; u++) {
    const last = spans.at(-1);
    if (last?.language === path[u]) {
      last.to = units[u].to;
      last.units.push(units[u]);
    } else {
      spans.push({
        language: path[u],
        from: units[u].from,
        to: units[u].to,
        units: [units[u]],
      });
    }
  }
  return spans;
}

function rankedScores(span, languages) {
  return languages
    .map((language) => ({
      language,
      score: span.units.reduce((sum, unit) => sum + unit.scores[language], 0),
    }))
    .sort((a, b) => b.score - a.score);
}

function lexicalLanguage(span, input, ranked) {
  const tokens = input.tokens.slice(span.from, span.to);
  // Reinsert boundaries: otherwise adjacent words silently become one word
  // during the lexical comparison, especially for timed input.
  const parts = [];
  for (let i = 0; i < tokens.length; i++) {
    if (i && input.boundaries.has(span.from + i)) {
      const hard = input.pauses.has(span.from + i);
      parts.push({
        kind: 'pause',
        strength: Number(hard),
        symbol: hard ? '|' : ' ',
      });
    }
    parts.push(tokens[i]);
  }
  const ipa = formatIpa(parts);
  const costs = ranked.slice(0, 2).map(({ language }) => {
    let cost;
    ipaToText(ipa, {
      language,
      trace: (event) => {
        cost = event.cost;
      },
    });
    return { language, cost: cost / tokens.length };
  });
  return costs[1].cost < costs[0].cost ? costs[1].language : costs[0].language;
}

/** Sorted shares of speech time (when timed), otherwise of speech sounds. */
export function languageShares(words) {
  if (!Array.isArray(words)) {
    throw new TypeError('words must be an array');
  }
  const records = words.map((word) => {
    checkLanguage(word.language);
    const count =
      Number.isFinite(word.from) && Number.isFinite(word.to)
        ? Math.max(0, word.to - word.from)
        : parseIpa(word.ipa ?? '').tokens.filter((t) =>
            ['vowel', 'consonant'].includes(t.kind)
          ).length;
    const timed =
      Number.isFinite(word.start) &&
      Number.isFinite(word.end) &&
      word.start >= 0 &&
      word.end >= word.start;
    return {
      language: word.language,
      count,
      duration: timed ? word.end - word.start : null,
    };
  });
  const timed =
    records.every((r) => r.duration !== null) &&
    records.some((r) => r.duration > 0);
  const totals = new Map();
  let total = 0;
  for (const record of records) {
    const weight = timed ? record.duration : record.count;
    totals.set(record.language, (totals.get(record.language) ?? 0) + weight);
    total += weight;
  }
  return total
    ? [...totals]
        .filter(([, weight]) => weight > 0)
        .map(([language, weight]) => ({ language, share: weight / total }))
        .sort((a, b) => b.share - a.share)
    : [];
}

/** Identify the supported languages, with sound offsets and optional seconds. */
export function identifyLanguage(ipa, options = {}) {
  const languages = options.languages ?? Object.keys(LANGUAGES);
  if (
    !Array.isArray(languages) ||
    !languages.length ||
    new Set(languages).size !== languages.length
  ) {
    throw new RangeError(
      'languages must be a nonempty array of distinct supported codes'
    );
  }
  languages.forEach(checkLanguage);
  const penalty = nonnegative(
    options.switchPenalty,
    'switchPenalty',
    LANGUAGE_MODEL.switchPenalty
  );
  const minSounds = nonnegative(options.minSounds, 'minSounds', 8);
  const input = recognitionInput(ipa, 'given');
  if (!input.tokens.length) {
    return { languages: [], spans: [], scores: {} };
  }
  const units = languageUnits(input, languages);
  const path = languagePath(units, languages, penalty);
  const initial = collectSpans(units, path);
  let lexicalChecks = 0;
  for (const span of initial) {
    const ranked = rankedScores(span, languages);
    if (
      ranked.length > 1 &&
      (ranked[0].score - ranked[1].score) / (span.to - span.from) <
        LANGUAGE_MODEL.lexicalGap
    ) {
      span.language = lexicalLanguage(span, input, ranked);
      lexicalChecks++;
    }
  }
  const labels = initial.flatMap((span) => span.units.map(() => span.language));
  const spans = collectSpans(units, labels).map((span) => {
    const ranked = rankedScores(span, languages);
    const count = span.to - span.from;
    const gap =
      ranked.length > 1 ? ranked[0].score - ranked[1].score : Infinity;
    const confidence =
      (1 - Math.exp(-gap / 4)) * Math.min(1, count / (minSounds || 1));
    return {
      language: span.language,
      from: span.from,
      to: span.to,
      start: input.tokens[span.from].start,
      end: input.tokens[span.to - 1].end,
      confidence,
    };
  });
  const words = spans.flatMap((span) =>
    input.tokens.slice(span.from, span.to).map((token) => ({
      language: span.language,
      ipa: token.symbol,
      start: token.start,
      end: token.end,
    }))
  );
  const scores = Object.fromEntries(
    languages.map((language) => [
      language,
      units.reduce((sum, unit) => sum + unit.scores[language], 0) /
        input.tokens.length,
    ])
  );
  const result = { languages: languageShares(words), spans, scores };
  options.trace?.({ units, path, lexicalChecks });
  return result;
}
