/**
 * Pure helpers that split the spoken text and its IPA into pieces tagged
 * with word and syllable indices of an utterance timeline (see
 * `utteranceTimeline`), and find the piece being spoken at a time.
 */

/** Seconds a word stays highlighted in the short pause after it. */
export const HOLD = 0.3;

const STRESS_MARKS = /^[ˈˌ]/u;

const painted = new WeakMap();

const every = (word, field) =>
  word.syllables.length > 0 &&
  word.syllables.every((syllable) => syllable[field] !== undefined);

/**
 * Ranges of the parts of a verbalised token (`3`, `4` and `2024` of
 * `3/4/2024`), each with the first and last syllable that read it. Text
 * of the token outside every part is lit with the word only.
 */
function partRanges(word, index) {
  const parts = new Map();
  word.syllables.forEach((syllable, position) => {
    const key = `${syllable.partStart}:${syllable.partEnd}`;
    const part = parts.get(key) ?? {
      start: syllable.partStart,
      end: syllable.partEnd,
      word: index,
      syllable: position,
    };
    part.lastSyllable = position;
    parts.set(key, part);
  });
  const ranges = [...parts.values()].sort((a, b) => a.start - b.start);
  const gap = (start, end) =>
    start < end ? [{ start, end, word: index, syllable: null }] : [];
  return [
    ...gap(word.sourceStart, ranges[0].start),
    ...ranges,
    ...gap(ranges.at(-1).end, word.sourceEnd),
  ];
}

/**
 * Source ranges of one timeline word: one per syllable when spelled, one
 * per part when the token is verbalised by parts (a date, a time, a sum),
 * else the whole word.
 * @param {object} word A word of `utteranceTimeline`.
 * @param {number} index Its index in the timeline.
 * @returns {{start: number, end: number, word: number, syllable: number|null, lastSyllable?: number}[]}
 */
export function wordRanges(word, index) {
  if (every(word, 'sourceStart')) {
    return word.syllables.map((syllable, position) => ({
      start: syllable.sourceStart,
      end: syllable.sourceEnd,
      word: index,
      syllable: position,
    }));
  }
  if (every(word, 'partStart')) {
    return partRanges(word, index);
  }
  return [
    {
      start: word.sourceStart,
      end: word.sourceEnd,
      word: index,
      syllable: null,
    },
  ];
}

/**
 * Split `text` into pieces; spoken pieces carry their word and syllable
 * index, everything else (spaces, punctuation) has `word: null`. A part
 * of a verbalised token read by several syllables also carries the index
 * of its last syllable (`lastSyllable`).
 * @param {string} text The text passed to `textToIpa`.
 * @param {{words: object[]}|null} timeline
 * @returns {{text: string, word: number|null, syllable: number|null, lastSyllable?: number}[]}
 */
export function textPieces(text, timeline) {
  const ranges = (timeline?.words ?? [])
    .flatMap((word, index) =>
      word.sourceStart === null || word.sourceStart === undefined
        ? []
        : wordRanges(word, index)
    )
    .sort((a, b) => a.start - b.start);
  const pieces = [];
  let cursor = 0;
  const push = (end, word, syllable, lastSyllable) => {
    if (end > cursor) {
      const piece = { text: text.slice(cursor, end), word, syllable };
      if (lastSyllable !== undefined && lastSyllable !== syllable) {
        piece.lastSyllable = lastSyllable;
      }
      pieces.push(piece);
      cursor = end;
    }
  };
  for (const range of ranges) {
    if (range.start < cursor || range.end > text.length) {
      continue;
    }
    const previous = pieces.at(-1);
    const inside =
      previous?.word === range.word && range.syllable !== null
        ? range.word
        : null;
    push(range.start, inside, null);
    push(range.end, range.word, range.syllable, range.lastSyllable);
  }
  push(text.length, null, null);
  return pieces;
}

/**
 * The IPA of the timeline split into syllables: words are separated by
 * spaces and syllables by dots (a stress mark takes the place of the dot).
 * @param {{words: object[]}|null} timeline
 * @returns {{text: string, word: number|null, syllable: number|null}[]}
 */
export function ipaPieces(timeline) {
  const pieces = [];
  (timeline?.words ?? []).forEach((word, index) => {
    if (index > 0) {
      pieces.push({ text: ' ', word: null, syllable: null });
    }
    word.syllables.forEach((syllable, position) => {
      if (position > 0 && !STRESS_MARKS.test(syllable.ipa)) {
        pieces.push({ text: '.', word: index, syllable: null });
      }
      pieces.push({ text: syllable.ipa, word: index, syllable: position });
    });
  });
  return pieces;
}

/**
 * What a verbalised word says, syllable by syllable: the `spoken` letters
 * of each syllable, with a space between spoken words (`twen`, `ty`, ` `,
 * `five` for 25). Empty for words read as written.
 * @param {object} word A word of `utteranceTimeline`.
 * @returns {{text: string, syllable: number|null}[]}
 */
export function spokenPieces(word) {
  if (!word?.spoken) {
    return [];
  }
  const pieces = [];
  let previous = null;
  word.syllables.forEach((syllable, position) => {
    if (!syllable.spoken) {
      return;
    }
    if (previous !== null && syllable.spokenWord !== previous) {
      pieces.push({ text: ' ', syllable: null });
    }
    pieces.push({ text: syllable.spoken, syllable: position });
    previous = syllable.spokenWord;
  });
  return pieces;
}

/** Index of the last entry that starts at or before `time`, or -1. */
function lastStarted(entries, time) {
  let low = 0;
  let high = entries.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (entries[middle].start <= time) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/**
 * The word and syllable to highlight at `time`. A word stays highlighted
 * through the pause after it for up to `hold` seconds, so the highlight
 * does not flicker between words.
 * @param {{words: object[]}|null} timeline
 * @param {number} time Seconds since the start of the utterance.
 * @param {number} [hold]
 * @returns {{word: number, syllable: number}|null}
 */
export function highlightAt(timeline, time, hold = HOLD) {
  const words = timeline?.words ?? [];
  const index = lastStarted(words, time);
  if (index < 0 || time >= words[index].end + hold) {
    return null;
  }
  const syllable = lastStarted(words[index].syllables, time);
  return { word: index, syllable: Math.max(0, syllable) };
}

/** True when two highlights point at the same word and syllable. */
export function sameHighlight(a, b) {
  return a?.word === b?.word && a?.syllable === b?.syllable;
}

/**
 * Highlight the word and syllable spoken at the current frame time. The
 * spans keep their React-managed attributes; only classes and
 * `aria-current` change, so the live region is not re-announced.
 * @param {HTMLElement|null} root The element rendered by `SpokenText`.
 * @param {{speaking: boolean, time: number, timeline?: object|null}} frame
 */
export function paintHighlight(root, frame) {
  if (!root) {
    return;
  }
  const current = frame.speaking
    ? highlightAt(frame.timeline, frame.time)
    : null;
  const last = painted.get(root);
  if (last && sameHighlight(last.current, current)) {
    return;
  }
  painted.set(root, { current });
  for (const span of root.querySelectorAll('[data-word]')) {
    const word = current !== null && Number(span.dataset.word) === current.word;
    const first = Number(span.dataset.syllable);
    const last = Number(span.dataset.syllableLast ?? first);
    const syllable =
      word &&
      span.dataset.syllable !== undefined &&
      current.syllable >= first &&
      current.syllable <= last;
    span.classList.toggle('word-current', word);
    span.classList.toggle('syllable-current', syllable);
    if (word) {
      span.setAttribute('aria-current', 'true');
    } else {
      span.removeAttribute('aria-current');
    }
  }
}
