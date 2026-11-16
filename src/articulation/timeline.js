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
 * letters that spell them by `syllableSpans`. A verbalised word keeps its
 * written text and range, and tells what is spoken instead: `spoken` on
 * the word and `spoken`, `spokenWord`, `partStart`, `partEnd` on each
 * syllable (see `speakSyllables`).
 *
 * Sounds (`⸨laugh⸩`, issue 56) are no words: they are listed in `sounds`
 * with their times. A written sound (`um`, `hahaha`, a word of
 * `textToIpa()` with `sound` and `soundIndex`) is also a word, timed by
 * its sound, with one syllable that holds the whole word.
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

/**
 * Consecutive IPA words that spell the same source text, merged. Each
 * group keeps its IPA words (`chunks`), the source of every chunk
 * (`chunkSources`) and the distinct sources in order (`sources`).
 */
function groupWords(groups, sources) {
  const merged = [];
  groups.forEach((tokens, index) => {
    const source = sources?.[index] ?? null;
    const last = merged.at(-1);
    if (last && source && sameSource(last.sources.at(-1), source)) {
      last.chunks.push(tokens);
      last.chunkSources.push(source);
      if (!last.sources.includes(source)) {
        last.sources.push(source);
      }
    } else {
      merged.push({
        chunks: [tokens],
        chunkSources: [source],
        sources: source ? [source] : [],
      });
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

/** Whether a group is spoken in words other than the ones written. */
function isVerbalised(group) {
  const { sources } = group;
  return (
    sources.length > 1 || (sources.length === 1 && !readAsWritten(sources[0]))
  );
}

/**
 * The letters of a spoken word for each of its syllables: a Chinese word
 * gives one character per chunk (one Hanzi per IPA word), other words are
 * mapped by `syllableSpans`. When the letters cannot be mapped, the first
 * syllable gets the whole word.
 */
function spokenLetters(source, chunks) {
  const text = String(source.text ?? '');
  const tokens = chunks.flat();
  const characters = Array.from(text);
  if (source.lang === 'zh' && characters.length === chunks.length) {
    return chunks.flatMap((chunk, index) =>
      chunk.map((_, syllable) => (syllable === 0 ? characters[index] : ''))
    );
  }
  const spans =
    source.lang === 'zh' ? null : syllableSpans(text, tokens.map(phoneCounts));
  return spans
    ? spans.map((span) => text.slice(span.start, span.end))
    : tokens.map((_, index) => (index === 0 ? text : ''));
}

/**
 * Tell every syllable of a verbalised word what is spoken: `spoken` (its
 * letters), `spokenWord` (index of the spoken word, one per source) and,
 * when known, the part of the written token it reads (`partStart`,
 * `partEnd`).
 */
function speakSyllables(syllables, split, group) {
  if (!isVerbalised(group)) {
    return;
  }
  let next = 0;
  const chunksOf = new Map();
  split.forEach((chunk, index) => {
    const source = group.chunkSources[index];
    const entry = chunksOf.get(source) ?? { chunks: [], first: next };
    entry.chunks.push(chunk);
    chunksOf.set(source, entry);
    next += chunk.length;
  });
  group.sources.forEach((source, spokenWord) => {
    const { chunks, first } = chunksOf.get(source);
    const part =
      source.partStart !== undefined && source.partEnd !== undefined
        ? { partStart: source.partStart, partEnd: source.partEnd }
        : {};
    spokenLetters(source, chunks).forEach((spoken, index) => {
      Object.assign(syllables[first + index], { spoken, spokenWord, ...part });
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
  speakSyllables(syllables, split, group);
  let next = 0;
  const ipa = split
    .map((chunk) => chunk.map(() => syllables[next++].ipa).join(''))
    .join(' ');
  const first = group.sources[0];
  const spoken = isVerbalised(group)
    ? { spoken: group.sources.map((source) => source.text).join(' ') }
    : {};
  return {
    text: first ? (first.original ?? first.text) : ipa,
    ...spoken,
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
 * The time range of every sound of the IPA (`plan.tokens` of kind
 * `sound`, in order): the union of the segments of its parts.
 */
function soundTimes(plan) {
  const times = new Map();
  for (const segment of plan.segments) {
    const token = (segment.soundOf ?? segment).token;
    if (token?.kind !== 'sound') {
      continue;
    }
    const time = times.get(token);
    if (time) {
      time.end = Math.max(time.end, segment.end);
    } else {
      times.set(token, { start: segment.start, end: segment.end });
    }
  }
  return plan.tokens
    .filter((token) => token.kind === 'sound')
    .map((token) => times.get(token) ?? null);
}

/** The timeline words of the written sounds of `words`. */
function soundWords(plan, words, language) {
  const times = soundTimes(plan);
  return words.flatMap((word) => {
    const time = word.sound ? times[word.soundIndex] : null;
    if (!time || !(time.start < time.end)) {
      return [];
    }
    const text = word.original ?? word.text;
    const source = {
      sourceStart: word.sourceStart ?? null,
      sourceEnd: word.sourceEnd ?? null,
    };
    const { start, end } = time;
    return [
      {
        text,
        lang: word.lang ?? language,
        ipa: word.ipa,
        sound: word.sound,
        start,
        end,
        ...source,
        syllables: [{ ipa: word.ipa, stress: 0, start, end, text, ...source }],
      },
    ];
  });
}

/**
 * Words and syllables of a planned utterance with their times.
 * @param {{tokens: object[], segments: object[], duration: number}} plan
 *   The result of `planUtterance`.
 * @param {{words?: object[], ipa?: string, language?: string}} [options]
 *   `words` from `textToIpa` map the timeline to the source text; with
 *   no words, the whitespace-separated chunks of `ipa` are the source.
 *   `sounds` are the `{name, start, end}` of the sounds (`plan.sounds`,
 *   with the breaths); a word that is a written sound has `sound`.
 * @returns {{duration: number, words: {text: string, lang: string, ipa: string, start: number, end: number, sourceStart: number|null, sourceEnd: number|null, spoken?: string, sound?: string, syllables: {ipa: string, stress: number, start: number, end: number, text?: string, sourceStart?: number, sourceEnd?: number, spoken?: string, spokenWord?: number, partStart?: number, partEnd?: number}[]}[], sounds: {name: string, start: number, end: number}[]}}
 */
export function utteranceTimeline(plan, options = {}) {
  const times = tokenTimes(plan.segments);
  const groups = ipaWords(plan.tokens);
  const words = options.words?.length
    ? options.words
    : ipaSourceWords(options.ipa, options.language);
  const sources = sourceOfEachWord(words, groups.length);
  const language = options.language ?? '';
  const spoken = groupWords(groups, sources)
    .map((group) => timelineWord(group, times, language))
    .filter(Boolean);
  const written = soundWords(plan, words, language);
  return {
    duration: plan.duration,
    words: written.length
      ? [...spoken, ...written].sort((a, b) => a.start - b.start)
      : spoken,
    sounds: (plan.sounds ?? []).map(({ name, start, end }) => ({
      name,
      start,
      end,
    })),
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
