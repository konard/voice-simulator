/**
 * The common result of the markup readers: the text the front end reads,
 * where each of its characters came from, and the composed mode of each
 * character, turned into sorted spans that do not overlap.
 */

import { MODE_DEFAULTS, composeMode, isDefaultMode, modeKey } from './modes.js';

/** Markup that cannot be read; `position` is the offset in the input. */
export class MarkupError extends Error {
  constructor(message, position) {
    super(position === undefined ? message : `${message} at ${position}`);
    this.name = 'MarkupError';
    this.position = position ?? 0;
  }
}

/**
 * Size limits of a markup input; going over one throws `MarkupError`.
 * `maxLength` is in UTF-16 characters, `maxPauseSeconds` limits a break.
 */
export const MARKUP_LIMITS = Object.freeze({
  maxLength: 20000,
  maxDepth: 32,
  maxElements: 2000,
  maxPauseSeconds: 10,
});

/** Accumulates the text, offsets and events of a markup reader. */
export class MarkupBuilder {
  constructor(kind) {
    this.kind = kind;
    this.text = '';
    this.offsets = [];
    this.modes = [];
    this.stack = [MODE_DEFAULTS];
    this.breaks = [];
    this.sounds = [];
    this.overrides = [];
    this.sources = [];
    this.warnings = [];
  }

  get mode() {
    return this.stack.at(-1);
  }

  get depth() {
    return this.stack.length - 1;
  }

  /** Enter a span with a change of mode. */
  push(change) {
    this.stack.push(change ? composeMode(this.mode, change) : this.mode);
  }

  pop() {
    if (this.stack.length > 1) {
      this.stack.pop();
    }
  }

  /**
   * Append text; `position` is the input offset of its first character,
   * or of every character when `step` is 0 (inserted text).
   */
  append(text, position, step = 1) {
    for (let index = 0; index < text.length; index++) {
      this.text += text[index];
      this.offsets.push(position + index * step);
      this.modes.push(this.mode);
    }
  }

  /** Append a space unless the text is empty or already ends in one. */
  separate(position) {
    if (this.text && !/\s$/u.test(this.text)) {
      this.append(' ', position, 0);
    }
  }

  /** Replace the text from `start` with `text`, all from `position`. */
  replaceFrom(start, text, position) {
    const mode = this.modes[start] ?? this.mode;
    this.text = this.text.slice(0, start) + text;
    this.offsets.length = start;
    this.modes.length = start;
    for (let index = 0; index < text.length; index++) {
      this.offsets.push(position);
      this.modes.push(mode);
    }
  }

  addBreak(seconds) {
    this.breaks.push({ at: this.text.length, seconds });
  }

  /** A sound at the end of the text, in the mode open there. */
  addSound(name, duration = null) {
    this.sounds.push({ at: this.text.length, name, duration, mode: this.mode });
  }

  warn(position, message) {
    this.warnings.push({ position, message });
  }

  /** Composed spans of characters with a mode other than the default. */
  spans() {
    const spans = [];
    let key = null;
    this.modes.forEach((mode, index) => {
      if (isDefaultMode(mode)) {
        key = null;
        return;
      }
      const next = mode === spans.at(-1)?.mode ? key : modeKey(mode);
      if (next === key && spans.at(-1)?.end === index) {
        spans.at(-1).end = index + 1;
      } else {
        spans.push({ start: index, end: index + 1, mode });
      }
      key = next;
    });
    return spans;
  }

  result() {
    return {
      markup: this.kind,
      text: this.text,
      offsets: this.offsets,
      spans: this.spans(),
      breaks: this.breaks,
      sounds: this.sounds,
      overrides: this.overrides,
      sources: this.sources,
      warnings: this.warnings,
    };
  }
}
