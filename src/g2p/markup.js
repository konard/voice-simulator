/**
 * The markup side of `textToIpa()`: the parsed markup of a text
 * (`parseMarkup()`, src/markup/index.js) becomes word, break and sound
 * items in reading order, each word with its mode and its range in the
 * input; then the modes of the words become spans in IPA word indexes and
 * the IPA string gets its ExtIPA/VoQS marks. See docs/markup.md.
 */

import { parseIpa } from '../ipa/parse.js';
import { wordSpans, writeMarks } from '../ipa/marks.js';
import { MODE_DEFAULTS } from '../markup/modes.js';

/** The IPA of a pause of `seconds`: `(.)`, `(..)`, `(...)` or `(N)`. */
export function pauseIpa(seconds) {
  const named = { 0.2: '(.)', 0.4: '(..)', 0.8: '(...)' }[seconds];
  return named ?? `(${Number(seconds.toFixed(3))})`;
}

/** The IPA of a sound: `⸨laugh⸩`, or `⸨laugh 0.5⸩` with a length. */
export function soundIpa(name, duration) {
  return duration === null || duration === undefined
    ? `⸨${name}⸩`
    : `⸨${name} ${Number(duration.toFixed(3))}⸩`;
}

/** The span of `spans` (sorted, not overlapping) that holds `index`. */
function spanAt(spans, index) {
  let low = 0;
  let high = spans.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const span = spans[middle];
    if (index < span.start) {
      high = middle - 1;
    } else if (index >= span.end) {
      low = middle + 1;
    } else {
      return span;
    }
  }
  return null;
}

/** Breaks and sounds by their position in the text, breaks first. */
function eventsOf(parsed) {
  const events = [
    ...parsed.breaks.map((item) => ({
      at: item.at,
      item: {
        text: '',
        ipa: pauseIpa(item.seconds),
        break: true,
        timed: true,
        seconds: item.seconds,
      },
    })),
    ...parsed.sounds.map((item) => ({
      at: item.at,
      item: {
        text: '',
        ipa: soundIpa(item.name, item.duration),
        break: true,
        sound: item.name,
      },
    })),
  ];
  return events.sort((left, right) => left.at - right.at);
}

/** The positions where the text is cut: events, overrides, languages. */
function cutPoints(parsed, length, events) {
  const cuts = new Set([0, length]);
  for (const event of events) {
    cuts.add(event.at);
  }
  for (const override of parsed.overrides) {
    cuts.add(override.start);
    cuts.add(override.end);
  }
  for (const span of parsed.spans) {
    if (span.mode.lang) {
      cuts.add(span.start);
      cuts.add(span.end);
    }
  }
  return [...cuts]
    .filter((cut) => cut >= 0 && cut <= length)
    .sort((left, right) => left - right);
}

/**
 * Point the text range of an item (`sourceStart`/`sourceEnd` in the
 * text the front end read) into the input: the element content of a
 * `sub` or `say-as`, or the input characters of the range.
 */
function mapSource(item, parsed, input) {
  const start = item.sourceStart;
  const end = item.sourceEnd ?? start;
  const { offsets } = parsed;
  const replaced = parsed.sources.find(
    (source) => source.start <= start && end <= source.end && start < end
  );
  if (replaced) {
    return {
      ...item,
      sourceStart: replaced.sourceStart,
      sourceEnd: replaced.sourceEnd,
      original: replaced.original,
    };
  }
  const sourceStart = offsets[start] ?? input.length;
  if (item.break || item.sourceEnd === undefined) {
    return { ...item, sourceStart };
  }
  const sourceEnd = end > start ? offsets[end - 1] + 1 : sourceStart;
  return {
    ...item,
    sourceStart,
    sourceEnd,
    original: input.slice(sourceStart, sourceEnd),
  };
}

/**
 * The items of a marked-up text, in reading order. `transcribe(items,
 * text, lang, offset)` appends the words and breaks of a stretch of text
 * in a language (null: the language of the whole text).
 * @param {object} parsed the result of `parseMarkup()`
 * @param {string} source the text the front end reads (`parsed.text`)
 * @param {string} input the marked-up input
 * @param {{transcribe: Function, lang: string}} context
 */
export function markupItems(parsed, source, input, context) {
  const events = eventsOf(parsed);
  const cuts = cutPoints(parsed, source.length, events);
  const items = [];
  let next = 0;
  for (let index = 0; index < cuts.length; index++) {
    const at = cuts[index];
    while (next < events.length && events[next].at <= at) {
      items.push({ ...events[next].item, sourceStart: events[next].at });
      next++;
    }
    const end = cuts[index + 1];
    if (end === undefined || end <= at) {
      continue;
    }
    const override = parsed.overrides.find((item) => item.start === at);
    const mode = spanAt(parsed.spans, at)?.mode ?? MODE_DEFAULTS;
    if (override) {
      items.push({
        text: source.slice(override.start, override.end).trim(),
        ipa: override.ipa,
        lang: mode.lang ?? context.lang,
        source: 'markup',
        sourceStart: override.start,
        sourceEnd: override.end,
      });
      // An override runs to its end, over any cut inside it.
      while (cuts[index + 1] !== undefined && cuts[index + 1] < override.end) {
        index++;
      }
      continue;
    }
    const text = source.slice(at, end);
    if (text.trim()) {
      context.transcribe(items, text, mode.lang, at);
    }
  }
  for (; next < events.length; next++) {
    items.push({ ...events[next].item, sourceStart: events[next].at });
  }
  return items.map((item) => ({
    ...mapSource(item, parsed, input),
    mode: spanAt(parsed.spans, item.sourceStart)?.mode ?? MODE_DEFAULTS,
  }));
}

/** The number of IPA words in the IPA of one item. */
function wordCount(ipa) {
  const words = new Set();
  for (const token of parseIpa(ipa).tokens) {
    if (token.kind !== 'pause' && token.word >= 0) {
      words.add(token.word);
    }
  }
  return words.size;
}

/**
 * The IPA string and the mode spans (in IPA word indexes) of the items
 * of `markupItems()` after the passes of `textToIpa()`. Each item keeps
 * its `mode`, which is removed here.
 */
export function markupModes(items) {
  const pieces = [];
  const wordModes = new Map();
  const emphasized = new Set();
  let word = 0;
  for (const item of items) {
    const { mode } = item;
    delete item.mode;
    if (!item.ipa) {
      continue;
    }
    const count = wordCount(item.ipa);
    pieces.push({ text: item.ipa, word: count ? word : -1, count });
    for (let index = word; index < word + count; index++) {
      wordModes.set(index, mode);
      if (mode.emphasis === 1) {
        emphasized.add(index);
      }
    }
    word += count;
  }
  const modes = wordSpans(wordModes, emphasized);
  return {
    ipa: writeMarks(pieces, modes).join(' '),
    modes,
  };
}
