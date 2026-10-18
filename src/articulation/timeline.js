/**
 * Word and syllable timeline of a planned utterance, in seconds of the
 * rendered audio, so a reader can highlight the word being spoken and
 * the syllable inside it.
 *
 * The plan's tokens carry the index of the IPA word they belong to; each
 * transcribed word (`textToIpa(...).words`) spans one or more IPA words
 * (a Chinese word has one per character). Words that verbalise the same
 * source text ("3/5/2024" as "March fifth ...") form one timeline word.
 * Syllables come from `syllabifyTokens` and are mapped back to the
 * letters that spell them by `syllableSpans`.
 */

import { syllableSpans } from '../g2p/orthography.js';
import { parseIpa } from '../ipa/parse.js';
import { syllabifyTokens, syllableIpa } from '../ipa/syllables.js';

/** Time range of every token: the union of its segments. */
function tokenTimes(segments) {
  const times = new Map();
  for (const segment of segments) {
    if (!segment.token) {
      continue;
    }
    const time = times.get(segment.token);
    if (time) {
      time.start = Math.min(time.start, segment.start);
      time.end = Math.max(time.end, segment.end);
    } else {
      times.set(segment.token, { start: segment.start, end: segment.end });
    }
  }
  return times;
}

/** Non-pause tokens grouped by IPA word, in order. */
function ipaWords(tokens) {
  const words = new Map();
  for (const token of tokens) {
    if (token.kind !== 'pause' && token.word >= 0) {
      words.set(token.word, [...(words.get(token.word) ?? []), token]);
    }
  }
  return [...words.values()];
}

/** Number of IPA words in an IPA string. */
function ipaWordCount(ipa) {
  return ipaWords(parseIpa(String(ipa ?? '')).tokens).length;
}

/** Whitespace-separated chunks of raw IPA input, as source words. */
function ipaSourceWords(ipa, lang) {
  return [...String(ipa ?? '').matchAll(/\S+/gu)].map((match) => ({
    text: match[0],
    original: match[0],
    ipa: match[0],
    lang,
    sourceStart: match.index,
    sourceEnd: match.index + match[0].length,
  }));
}

/**
 * The source word of each IPA word, or null when the transcription and
 * the planned tokens disagree on the number of words.
 */
function sourceOfEachWord(words, count) {
  const sources = words.flatMap((word) =>
    Array.from({ length: ipaWordCount(word.ipa) }, () => word)
  );
  return sources.length === count ? sources : null;
}

const sameSource = (a, b) =>
  a === b ||
  (a?.sourceStart !== undefined &&
    a.sourceStart === b?.sourceStart &&
    a.sourceEnd === b?.sourceEnd);

/** Consecutive IPA words that spell the same source text, merged. */
function groupWords(groups, sources) {
  const merged = [];
  groups.forEach((tokens, index) => {
    const source = sources?.[index] ?? null;
    const last = merged.at(-1);
    if (last && source && sameSource(last.sources.at(-1), source)) {
      last.chunks.push(tokens);
      if (!last.sources.includes(source)) {
        last.sources.push(source);
      }
    } else {
      merged.push({ chunks: [tokens], sources: source ? [source] : [] });
    }
  });
  return merged;
}

/** Phone counts of a syllable for the orthographic mapping. */
function phoneCounts(tokens) {
  const first = tokens.findIndex((token) => token.syllabic);
  const last = tokens.findLastIndex((token) => token.syllabic);
  return {
    onset: Math.max(first, 0),
    coda: last < 0 ? 0 : tokens.length - 1 - last,
    size: tokens.length,
  };
}

/** Whether a source word is read as written (not verbalised). */
function readAsWritten(source) {
  return (
    typeof source?.original === 'string' &&
    String(source.text ?? '').toLowerCase() === source.original.toLowerCase()
  );
}

function spellSyllables(syllables, tokens, sources) {
  const [source] = sources;
  if (sources.length !== 1 || !readAsWritten(source)) {
    return;
  }
  const spans = syllableSpans(source.original, tokens.map(phoneCounts));
  spans?.forEach((span, index) => {
    Object.assign(syllables[index], {
      text: source.original.slice(span.start, span.end),
      sourceStart: source.sourceStart + span.start,
      sourceEnd: source.sourceStart + span.end,
    });
  });
}

function timedSyllable(tokens, times) {
  return {
    ipa: syllableIpa(tokens),
    stress: Math.max(0, ...tokens.map((token) => token.stress ?? 0)),
    start: Math.min(
      ...tokens.map((token) => times.get(token)?.start ?? Infinity)
    ),
    end: Math.max(...tokens.map((token) => times.get(token)?.end ?? -Infinity)),
  };
}

function timelineWord(group, times, language) {
  const lang = group.sources[0]?.lang ?? language;
  const split = group.chunks.map((chunk) =>
    syllabifyTokens(chunk, { language: lang })
  );
  const syllables = split.flat().map((tokens) => timedSyllable(tokens, times));
  if (!syllables.length || !syllables.every((s) => s.start < s.end)) {
    return null;
  }
  spellSyllables(syllables, split.flat(), group.sources);
  let next = 0;
  const ipa = split
    .map((chunk) => chunk.map(() => syllables[next++].ipa).join(''))
    .join(' ');
  const first = group.sources[0];
  return {
    text: first ? (first.original ?? first.text) : ipa,
    lang,
    ipa,
    start: syllables[0].start,
    end: syllables.at(-1).end,
    sourceStart: first?.sourceStart ?? null,
    sourceEnd: group.sources.at(-1)?.sourceEnd ?? null,
    syllables,
  };
}

/**
 * Words and syllables of a planned utterance with their times.
 * @param {{tokens: object[], segments: object[], duration: number}} plan
 *   The result of `planUtterance`.
 * @param {{words?: object[], ipa?: string, language?: string}} [options]
 *   `words` from `textToIpa` map the timeline to the source text; with
 *   no words, the whitespace-separated chunks of `ipa` are the source.
 * @returns {{duration: number, words: {text: string, lang: string, ipa: string, start: number, end: number, sourceStart: number|null, sourceEnd: number|null, syllables: {ipa: string, stress: number, start: number, end: number, text?: string, sourceStart?: number, sourceEnd?: number}[]}[]}}
 */
export function utteranceTimeline(plan, options = {}) {
  const times = tokenTimes(plan.segments);
  const groups = ipaWords(plan.tokens);
  const words = options.words?.length
    ? options.words
    : ipaSourceWords(options.ipa, options.language);
  const sources = sourceOfEachWord(words, groups.length);
  const language = options.language ?? '';
  return {
    duration: plan.duration,
    words: groupWords(groups, sources)
      .map((group) => timelineWord(group, times, language))
      .filter(Boolean),
  };
}

/**
 * The word and syllable being spoken at `time`.
 * @param {ReturnType<typeof utteranceTimeline>} timeline
 * @param {number} time Seconds since the start of the utterance.
 * @returns {{word: number, syllable: number}|null} Indices, or null in a
 *   pause.
 */
export function timelineAt(timeline, time) {
  const words = timeline?.words ?? [];
  let low = 0;
  let high = words.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const word = words[middle];
    if (time < word.start) {
      high = middle - 1;
    } else if (time >= word.end) {
      low = middle + 1;
    } else {
      const syllable = word.syllables.findIndex(
        (candidate) => time >= candidate.start && time < candidate.end
      );
      return { word: middle, syllable: Math.max(syllable, 0) };
    }
  }
  return null;
}
