/** IPA → text through a pronunciation trie and a discounted bigram model. */
import { getLexicon } from './lexicon.js';
import { checkLanguage } from './languages.js';
import { wordCost } from './data/index.js';
import { candidatesAt, exactCandidates, distanceCache } from './candidates.js';
import { recognitionInput } from './input.js';
import { withWordSearch } from './word-search.js';
import { spellSounds } from './phones-to-letters.js';
import { resultFromPath, heardIpa } from './result.js';

// Calibrated separately from the bounded per-phone metric: otherwise the
// word penalty lets a few long, unrelated words beat an almost exact phrase.
export const ACOUSTIC_WEIGHT = 10;
export const UNKNOWN_SOUND_COST = 2;
// Final calibrated mixed-language costs; see experiments/issue-69-word-boundaries.mjs.
export const MIXED_LANGUAGE_COSTS = { spanMismatch: 1, switch: 1 };

function integerOption(value, name, fallback) {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return n;
}

function prune(paths, beam) {
  paths.sort((a, b) => a.cost - b.cost);
  const seen = new Set();
  const result = [];
  for (const path of paths) {
    if (!seen.has(path.text)) {
      seen.add(path.text);
      result.push(path);
    }
    if (result.length === beam) {
      break;
    }
  }
  return result;
}

function unknownCandidates(tokens, from, end, options, knownSuffix) {
  const to = Math.min(end, from + 12);
  if (options.given && to !== end) {
    return [];
  }
  const ends = [to];
  if (!options.given) {
    // A known suffix proposes a boundary that preserves following words.
    const suffix = knownSuffix(end);
    for (let j = from + 1; j < to; j++) {
      if (suffix.has(j)) {
        ends.push(j);
        break;
      }
    }
  }
  return ends.map((to) => {
    const heard = tokens.slice(from, to);
    return {
      from,
      to,
      word: spellSounds(heard, options.language),
      ipa: heardIpa(heard),
      cost: 3 + UNKNOWN_SOUND_COST * heard.length,
      unknown: true,
    };
  });
}

function decoderCandidates(from, end, context) {
  const { input, lexicons, options, exact, wordSearches, knownSuffix } =
    context;
  const { tokens } = input;
  const { beam, given } = options;
  const candidates = [];
  for (const [language, lexicon] of lexicons) {
    let found = exact
      ? exactCandidates(tokens, from, end, lexicon, language)
      : candidatesAt(tokens, from, end, lexicon, {
          beam,
          language,
          wordSearch: wordSearches.get(language),
        });
    if (given) {
      found = found.filter((c) => c.to === end);
    }
    found = found.map((c) => ({ ...c, cost: c.cost * ACOUSTIC_WEIGHT }));
    if (!exact || (given && !found.length)) {
      found.push(
        ...unknownCandidates(
          tokens,
          from,
          end,
          { ...options, language },
          (end) => knownSuffix(end, lexicon, language)
        )
      );
    }
    candidates.push(...found.map((c) => ({ ...c, language })));
  }
  return candidates;
}

function continuationCost(input, lexicons, spans, candidate, partial) {
  const from = candidate.from;
  const lexicon = lexicons.get(candidate.language);
  const changed =
    partial.lastLanguage && partial.lastLanguage !== candidate.language;
  const span = spans?.find((span) => span.from <= from && from < span.to);
  const languageCost =
    Number(Boolean(span && span.language !== candidate.language)) *
      MIXED_LANGUAGE_COSTS.spanMismatch +
    Number(Boolean(changed && !input.pauses.has(from))) *
      MIXED_LANGUAGE_COSTS.switch;
  return (
    partial.cost +
    candidate.cost +
    wordCost(lexicon, changed ? null : partial.last, candidate.word) +
    languageCost
  );
}

function searchPaths(input, lexicon, options, exact, wordSearches) {
  const { tokens, boundaries } = input;
  const { beam, language, given } = options;
  const lexicons = options.lexicons ?? new Map([[language, lexicon]]);
  const ends = [...boundaries].sort((a, b) => a - b);
  const best = Array.from({ length: tokens.length + 1 }, () => []);
  best[0] = [{ path: [], last: null, text: '', cost: 0 }];
  const suffixes = new Map();
  function knownSuffix(end, lexicon, language) {
    const key = `${end}:${language}`;
    if (!suffixes.has(key)) {
      const reachable = new Set([end]);
      for (let start = end - 1; start >= 0; start--) {
        if (
          exactCandidates(tokens, start, end, lexicon, language).some((c) =>
            reachable.has(c.to)
          )
        ) {
          reachable.add(start);
        }
      }
      suffixes.set(key, reachable);
    }
    return suffixes.get(key);
  }
  let boundaryIndex = 1;
  for (let from = 0; from < tokens.length; from++) {
    while (ends[boundaryIndex] <= from) {
      boundaryIndex++;
    }
    const end = ends[boundaryIndex];
    if (!best[from].length || (given && !boundaries.has(from))) {
      continue;
    }
    best[from] = prune(best[from], beam);
    const candidates = decoderCandidates(from, end, {
      input,
      lexicons,
      options,
      exact,
      wordSearches,
      knownSuffix,
    });
    for (const candidate of candidates) {
      for (const partial of best[from]) {
        const cost = continuationCost(
          input,
          lexicons,
          options.spans,
          candidate,
          partial
        );
        best[candidate.to].push({
          cost,
          last: candidate.word,
          lastLanguage: candidate.language,
          text: `${partial.text}\t${candidate.language}:${candidate.word}`,
          path: [...partial.path, candidate],
        });
      }
      // Bound retained partial results at each input position by the beam.
      if (best[candidate.to].length > beam * 4) {
        best[candidate.to] = prune(best[candidate.to], beam);
      }
    }
  }
  return prune(best[tokens.length], beam);
}

export function decode(input, lexicon, options, exact) {
  const searches = new Map();
  const run = () => searchPaths(input, lexicon, options, exact, searches);
  if (exact) {
    return run();
  }
  const sources = [
    ...(options.lexicons ?? new Map([[options.language, lexicon]])),
  ];
  const distance = distanceCache();
  function load(index) {
    if (index === sources.length) {
      return run();
    }
    const [language, source] = sources[index];
    return withWordSearch(
      source,
      input.tokens,
      language,
      distance,
      options.module,
      (search) => {
        searches.set(language, search);
        return load(index + 1);
      }
    );
  }
  return load(0);
}

function decoderLanguages(options) {
  const spans = options.spans;
  if (spans !== undefined && !Array.isArray(spans)) {
    throw new TypeError('spans must be an array');
  }
  const languages = [...new Set((spans ?? []).map((span) => span.language))];
  languages.forEach(checkLanguage);
  const language =
    languages.length === 1 ? languages[0] : (options.language ?? 'en');
  checkLanguage(language);
  return { spans, languages, language };
}

function validateSpans(spans, input) {
  if (spans?.length) {
    let from = 0;
    for (const span of spans) {
      if (
        span.from !== from ||
        !Number.isSafeInteger(span.to) ||
        span.to <= from ||
        span.to > input.tokens.length
      ) {
        throw new RangeError(
          'spans must cover all sounds in order, without gaps or overlaps'
        );
      }
      from = span.to;
    }
    if (from !== input.tokens.length) {
      throw new RangeError(
        'spans must cover all sounds in order, without gaps or overlaps'
      );
    }
  }
}

function decodeReadings(input, lexicon, settings, nbest) {
  const weakCues = input.tokens.some((token) => token.whispered);
  const paths = weakCues ? [] : decode(input, lexicon, settings, true);
  if (paths.length < nbest) {
    const exactTexts = new Set(paths.map((path) => path.text));
    paths.push(
      ...decode(input, lexicon, settings, false).filter(
        (path) => !exactTexts.has(path.text)
      )
    );
  }
  return paths;
}

/**
 * Turn IPA sounds into lower-case words of one language or supplied language spans.
 * An exact full decoding takes precedence over a decoding that changes
 * sounds. This preserves the forward pronunciation on noiseless input and
 * also makes the common exact path linear in input length × word length.
 * Approximate decoding is used when no exact full path exists.
 */
export function ipaToText(ipa, options = {}) {
  const { spans, languages, language } = decoderLanguages(options);
  const nbest = integerOption(options.nbest, 'nbest', 1);
  const beam = integerOption(options.beam, 'beam', 32);
  const boundaries =
    options.boundaries ??
    (typeof ipa === 'string' &&
    /\s/u.test(ipa) &&
    language !== 'zh' &&
    !languages.includes('zh')
      ? 'given'
      : 'search');
  if (!['given', 'search'].includes(boundaries)) {
    throw new RangeError('boundaries must be "given" or "search"');
  }
  const input = recognitionInput(ipa, boundaries);
  validateSpans(spans, input);
  if (!input.tokens.length) {
    return {
      text: '',
      ipa: '',
      words: [],
      ...(nbest > 1 ? { alternatives: [] } : {}),
    };
  }
  const lexicon = getLexicon(language);
  const settings = {
    language,
    module: options.kernels?.module,
    beam: Math.max(beam, nbest),
    given: boundaries === 'given',
    ...(languages.length > 1
      ? {
          spans,
          lexicons: new Map(languages.map((lang) => [lang, getLexicon(lang)])),
        }
      : {}),
  };
  const paths = decodeReadings(input, lexicon, settings, nbest);
  if (!paths.length) {
    throw new Error('no IPA decoding path');
  }
  const result = resultFromPath(paths[0].path, input.tokens, language);
  if (nbest > 1) {
    result.alternatives = paths.slice(1, nbest).map((path) => {
      const alternative = resultFromPath(path.path, input.tokens, language);
      return {
        text: alternative.text,
        ipa: alternative.ipa,
        confidence: Math.exp(-path.cost / input.tokens.length),
      };
    });
  }
  if (typeof options.trace === 'function') {
    options.trace({
      sounds: input.tokens.length,
      paths: paths.length,
      cost: paths[0].cost,
      words: paths[0].path.map(({ from, to, word, cost }) => ({
        from,
        to,
        word,
        cost,
      })),
    });
  }
  return result;
}
