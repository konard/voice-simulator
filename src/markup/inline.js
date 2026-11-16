/**
 * Inline tags for plain text: `[whisper]Hello[/whisper] world`, `[laugh]`,
 * `[pause 0.3]`, `*word*`. They are read only when asked for
 * (`markup: true`), so `[1]` or `2 * 3` in ordinary text stay text. Inline
 * parsing never throws: an unknown tag stays in the text, a tag that is
 * never closed runs to the end, and both add a warning. See docs/markup.md.
 */

import { MarkupBuilder, MARKUP_LIMITS } from './builder.js';
import {
  DEFAULT_DEGREE,
  EFFORT_LEVELS,
  EMOTIONS,
  LOMBARD_EFFORT,
  PHONATIONS,
  RATE_LEVELS,
  SOUND_NAMES,
  emotionOf,
} from './modes.js';

/** Effort change of `[crescendo]` and `[diminuendo]` (as `{crescendo …}`). */
const EFFORT_RAMP = 0.25;

/** Semitones of `[high]` and `[low]` (the SSML `high` and `low`). */
const PITCH_STEP = 3;

const number = (value) => {
  const text = String(value ?? '').trim();
  return /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/u.test(text) ? Number(text) : null;
};

const inUnit = (value) => {
  const found = number(value);
  return found !== null && found >= 0 && found <= 1 ? found : null;
};

const degreeOf = (value) =>
  value === undefined ? DEFAULT_DEGREE : inUnit(value);

/**
 * Span tags: name -> (value) => change, or null when the value cannot be
 * read. `value` is the text after the name (undefined without one). A Map,
 * so that names such as `constructor` are unknown tags.
 */
const SPAN_TAGS = new Map(
  Object.entries({
    whisper: () => ({ phonation: { whisper: 1 } }),
    ...Object.fromEntries(
      Object.entries(EFFORT_LEVELS)
        .filter(([name]) => name !== 'normal')
        .map(([name, effort]) => [name, () => ({ effort })])
    ),
    effort: (value) => {
      const effort = inUnit(value);
      return effort === null ? null : { effort };
    },
    lombard: () => ({ effort: LOMBARD_EFFORT, lombard: true }),
    crescendo: () => ({ effortRamp: EFFORT_RAMP }),
    diminuendo: () => ({ effortRamp: -EFFORT_RAMP }),
    fast: () => ({ rate: RATE_LEVELS.fast, absolute: ['rate'] }),
    slow: () => ({ rate: RATE_LEVELS.slow, absolute: ['rate'] }),
    rate: (value) => {
      const rate = number(value);
      return rate !== null && rate > 0 ? { rate } : null;
    },
    high: () => ({ pitch: PITCH_STEP }),
    low: () => ({ pitch: -PITCH_STEP }),
    pitch: (value) => {
      const pitch = number(value);
      return pitch === null ? null : { pitch };
    },
    ...Object.fromEntries(
      ['breathy', 'creaky', 'pressed', 'lax', 'falsetto', 'harsh'].map(
        (name) => [
          name,
          (value) => {
            const degree = degreeOf(value);
            return degree === null ? null : PHONATIONS[name](degree);
          },
        ]
      )
    ),
    ...Object.fromEntries(
      Object.keys(EMOTIONS).map((name) => [
        name,
        (value) => {
          const intensity = value === undefined ? undefined : inUnit(value);
          return intensity === null
            ? null
            : { emotion: emotionOf({ name, intensity }) };
        },
      ])
    ),
    lang: (value) =>
      /^[A-Za-z]{2,3}(?:[-_][A-Za-z\d]{2,8})*$/u.test(value ?? '')
        ? { lang: value }
        : null,
  })
);

/** A tag `[...]` at `index`: its name, value and end, or null. */
function readTag(text, index) {
  const end = findClose(text, index + 1);
  if (end < 0) {
    return null;
  }
  const body = text.slice(index + 1, end);
  const found = /^(\/?)([a-z][a-z-]*)(?:\s+([^]*?))?\s*$/u.exec(body);
  if (!found) {
    return null;
  }
  return {
    closing: found[1] === '/',
    name: found[2],
    value: found[3],
    end: end + 1,
  };
}

/** Index of the unescaped `]` after `from`, or -1. */
function findClose(text, from) {
  for (let index = from; index < text.length; index++) {
    if (text[index] === '\\') {
      index++;
    } else if (text[index] === '[') {
      return -1;
    } else if (text[index] === ']') {
      return index;
    }
  }
  return -1;
}

/** Remove the escapes of a tag value (`[ipa a\]b]`). */
const unescape = (value) => value.replace(/\\([[\]*\\])/gu, '$1');

class InlineReader {
  constructor(input, options) {
    this.input = input;
    this.limits = { ...MARKUP_LIMITS, ...options.limits };
    this.builder = new MarkupBuilder('inline');
    this.open = [];
    // `[ipa X]` is a span when `[/ipa]` follows before the next `[ipa`,
    // otherwise one word spoken as X.
    this.ipaTags = [...input.matchAll(/\[(\/?)ipa[\s\]]/gu)].map((found) => ({
      at: found.index,
      closing: found[1] === '/',
    }));
    this.ipaNext = 0;
  }

  /** Whether the `[ipa` tag at `index` is closed before the next one. */
  ipaClosed(index) {
    const tags = this.ipaTags;
    while (this.ipaNext < tags.length && tags[this.ipaNext].at <= index) {
      this.ipaNext++;
    }
    return tags[this.ipaNext]?.closing === true;
  }

  read() {
    const { input, builder } = this;
    let index = 0;
    while (index < input.length) {
      const char = input[index];
      if (char === '\\' && /[[\]*\\]/u.test(input[index + 1] ?? '')) {
        builder.append(input[index + 1], index + 1);
        index += 2;
      } else if (char === '[') {
        index = this.readTag(index);
      } else if (char === '*' && this.star(index)) {
        index++;
      } else {
        builder.append(/[\n\r\t]/u.test(char) ? ' ' : char, index);
        index++;
      }
    }
    for (const span of this.open.reverse()) {
      builder.warn(span.position, `[${span.name}] is not closed`);
      this.finish(span);
    }
    return builder.result();
  }

  /** Read `*` at `index` as an emphasis mark if it is one. */
  star(index) {
    const { input } = this;
    const before = input[index - 1];
    const after = input[index + 1];
    const top = this.open.at(-1);
    if (top?.name === '*' && before !== undefined && !/\s/u.test(before)) {
      this.open.pop();
      this.finish(top);
      return true;
    }
    if (
      (before === undefined || /\s/u.test(before)) &&
      after !== undefined &&
      !/[\s*]/u.test(after) &&
      this.closingStar(index + 1)
    ) {
      this.begin({ name: '*', position: index }, { emphasis: 1 });
      return true;
    }
    return false;
  }

  /** Whether a closing `*` (after a non-space) follows on the same text. */
  closingStar(from) {
    const { input } = this;
    for (let index = from; index < input.length; index++) {
      if (input[index] === '\\') {
        index++;
      } else if (input[index] === '*') {
        return index > from && !/\s/u.test(input[index - 1]);
      }
    }
    return false;
  }

  begin(span, change) {
    this.builder.push(change);
    this.open.push({ ...span, textStart: this.builder.text.length });
  }

  finish(span) {
    this.builder.pop();
    if (span.name === 'ipa') {
      this.builder.overrides.push({
        start: span.textStart,
        end: this.builder.text.length,
        ipa: span.ipa,
      });
    }
  }

  /** Read the tag at `index`; returns the index after it. */
  readTag(index) {
    const { builder, input } = this;
    const tag = readTag(input, index);
    if (!tag) {
      builder.append('[', index);
      return index + 1;
    }
    const keep = (message) => {
      builder.warn(index, message);
      builder.append(input.slice(index, tag.end), index);
      return tag.end;
    };
    if (tag.closing) {
      const at = this.open.findLastIndex((span) => span.name === tag.name);
      if (at < 0) {
        return keep(`[/${tag.name}] closes nothing`);
      }
      for (const span of this.open.splice(at).reverse()) {
        if (span.name !== tag.name) {
          builder.warn(span.position, `[${span.name}] is not closed`);
        }
        this.finish(span);
      }
      return tag.end;
    }
    const value = tag.value === undefined ? undefined : unescape(tag.value);
    if (SOUND_NAMES.includes(tag.name)) {
      return this.sound(tag, value, index);
    }
    if (tag.name === 'pause') {
      return this.pause(tag, value, index);
    }
    if (tag.name === 'ipa') {
      if (!value) {
        return keep('[ipa] needs the IPA of the words');
      }
      if (!this.ipaClosed(index)) {
        return this.ipaWord(tag, value, index);
      }
      this.begin({ name: 'ipa', position: index, ipa: value });
      return tag.end;
    }
    const reader = SPAN_TAGS.get(tag.name);
    if (typeof reader !== 'function') {
      return keep(`unknown tag [${tag.name}]`);
    }
    const change = reader(value);
    if (!change) {
      return keep(`cannot read [${tag.name} ${value ?? ''}]`);
    }
    this.begin({ name: tag.name, position: index }, change);
    return tag.end;
  }

  /** `[ipa X]` alone: a word spoken as X, written as X in the text. */
  ipaWord(tag, value, index) {
    const { builder } = this;
    builder.separate(index);
    const start = builder.text.length;
    builder.append(value, index, 0);
    builder.overrides.push({ start, end: builder.text.length, ipa: value });
    builder.sources.push({
      start,
      end: builder.text.length,
      sourceStart: index,
      sourceEnd: tag.end,
      original: this.input.slice(index, tag.end),
    });
    builder.separate(tag.end - 1);
    return tag.end;
  }

  sound(tag, value, index) {
    let duration = null;
    if (value !== undefined) {
      duration = number(value);
      if (duration === null || duration < 0) {
        this.builder.warn(index, `cannot read [${tag.name} ${value}]`);
        duration = null;
      }
    }
    this.builder.separate(index);
    this.builder.addSound(tag.name, duration && this.clamp(duration, index));
    this.builder.separate(tag.end - 1);
    return tag.end;
  }

  pause(tag, value, index) {
    const seconds = number(value);
    if (seconds === null || seconds < 0) {
      this.builder.warn(index, `cannot read [pause ${value ?? ''}]`);
      this.builder.append(this.input.slice(index, tag.end), index);
      return tag.end;
    }
    this.builder.separate(index);
    this.builder.addBreak(this.clamp(seconds, index));
    this.builder.separate(tag.end - 1);
    return tag.end;
  }

  clamp(seconds, index) {
    const limit = this.limits.maxPauseSeconds;
    if (seconds > limit) {
      this.builder.warn(index, `${seconds} s is longer than ${limit} s`);
      return limit;
    }
    return seconds;
  }
}

/**
 * Read the inline tags of a plain text; never throws.
 * @param {string} input
 * @param {{limits?: object}} [options]
 */
export function parseInline(input, options = {}) {
  return new InlineReader(String(input), options).read();
}
