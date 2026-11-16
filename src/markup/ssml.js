/**
 * A subset of SSML 1.1 (https://www.w3.org/TR/speech-synthesis11/) with
 * the project elements of the namespace `urn:voice-simulator:markup:1`
 * (prefix `vs:`), read by a small hand-written reader: elements,
 * attributes, text, comments, the five XML entities and numeric character
 * references. Document type declarations, entity declarations, CDATA
 * sections and processing instructions are refused (`MarkupError`), so an
 * input cannot expand or include anything. See docs/markup.md.
 */

import { MarkupBuilder, MarkupError, MARKUP_LIMITS } from './builder.js';
import {
  DEFAULT_DEGREE,
  EFFORT_LEVELS,
  LOMBARD_EFFORT,
  EMOTIONS,
  PHONATIONS,
  SOUND_NAMES,
  emotionOf,
} from './modes.js';

/** The namespace of the `vs:` elements and attributes. */
export const MARKUP_NAMESPACE = 'urn:voice-simulator:markup:1';

/** Seconds of the `break` strengths. */
const BREAK_STRENGTHS = Object.freeze({
  none: 0,
  'x-weak': 0.05,
  weak: 0.2,
  medium: 0.4,
  strong: 0.8,
  'x-strong': 1.2,
});

const RATES = {
  'x-slow': 0.5,
  slow: 0.75,
  medium: 1,
  fast: 1.3,
  'x-fast': 1.6,
};
const PITCHES = { 'x-low': -6, low: -3, medium: 0, high: 3, 'x-high': 6 };
const RANGES = { 'x-low': 0.25, low: 0.5, medium: 1, high: 1.5, 'x-high': 2 };
const VOLUMES = { 'x-soft': -12, soft: -6, medium: 0, loud: 6, 'x-loud': 12 };
const EMPHASIS = { strong: 1, moderate: 0.5, none: 0, reduced: -0.5 };

/** Pitch of the default voice when no head is given (DEFAULT_HEAD). */
const BASE_PITCH = 120;

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** Elements that never have content. */
const EMPTY_ELEMENTS = new Set(['break', 'vs:sound']);

/** Elements that change the mode: (parser, element) => change. */
const CHANGES = new Map([
  ['prosody', (parser, element) => parser.prosody(element)],
  ['emphasis', (parser, element) => parser.emphasis(element)],
  ['vs:effort', (parser, element) => parser.effort(element)],
  ['vs:phonation', (parser, element) => parser.phonation(element)],
  ['vs:emotion', (parser, element) => parser.emotion(element)],
]);

/** The other known elements: the handler of the opening tag, or null. */
const STARTS = new Map([
  ['speak', (parser, element) => parser.startSpeak(element)],
  ['p', (parser, element) => parser.startParagraph(element)],
  ['s', (parser, element) => parser.startParagraph(element)],
  ['lang', (parser, element) => parser.startLang(element)],
  ['break', (parser, element) => parser.startBreak(element)],
  ['vs:sound', (parser, element) => parser.startSound(element)],
  ['phoneme', (parser, element) => parser.startPhoneme(element)],
  ['say-as', null],
  ['sub', null],
]);

/** The handler of the closing tag of an element. */
const CLOSES = new Map([
  ['speak', (parser, element, position) => parser.closeRoot(element, position)],
  [
    'p',
    (parser, element, position) => parser.closeParagraph(element, position),
  ],
  [
    's',
    (parser, element, position) => parser.closeParagraph(element, position),
  ],
  [
    'break',
    (parser, element, position) => parser.closeEmpty(element, position),
  ],
  [
    'vs:sound',
    (parser, element, position) => parser.closeEmpty(element, position),
  ],
  [
    'phoneme',
    (parser, element, position) => parser.closePhoneme(element, position),
  ],
  ['say-as', (parser, element, position) => parser.replace(element, position)],
  ['sub', (parser, element, position) => parser.replace(element, position)],
]);

/** Final punctuation: a `p` or `s` that ends without one gets a `.`. */
const FINAL_PUNCTUATION = /[.!?…。！？।]["'”’»)\]]*\s*$/u;

const NAME = /[A-Za-z_][\w.:-]*/y;
const SPACE = /\s*/y;
const NUMBER = String.raw`[+-]?(?:\d+(?:\.\d+)?|\.\d+)`;

const round = (value) => Math.round(value * 1e6) / 1e6;

/** A duration such as `300ms` or `1.5s` in seconds, or null. */
export function parseTime(value) {
  const found = new RegExp(`^(${NUMBER})\\s*(ms|s)$`, 'u').exec(
    String(value).trim()
  );
  if (!found || Number(found[1]) < 0) {
    return null;
  }
  return round(Number(found[1]) / (found[2] === 'ms' ? 1000 : 1));
}

/** `+2st`, `-10%`, `1.5`: the number and the unit, or null. */
function quantity(value, units) {
  const found = new RegExp(`^(${NUMBER})\\s*(${units})$`, 'iu').exec(
    String(value).trim()
  );
  return found
    ? { value: Number(found[1]), unit: found[2].toLowerCase() }
    : null;
}

/** The change of a `rate` attribute, or null if it cannot be read. */
function rateChange(value) {
  if (Object.hasOwn(RATES, value)) {
    return { rate: RATES[value], absolute: ['rate'] };
  }
  const found = quantity(value, '%|');
  if (!found || found.value <= 0) {
    return null;
  }
  return { rate: found.unit === '%' ? found.value / 100 : found.value };
}

function pitchChange(value, basePitch) {
  if (Object.hasOwn(PITCHES, value)) {
    return { pitch: PITCHES[value], absolute: ['pitch'] };
  }
  const found = quantity(value, 'st|%|hz');
  if (!found) {
    return null;
  }
  const signed = /^[+-]/u.test(String(value).trim());
  if (found.unit === 'st') {
    return { pitch: found.value };
  }
  if (found.unit === '%') {
    return found.value > -100
      ? { pitch: round(12 * Math.log2(1 + found.value / 100)) }
      : null;
  }
  // Hertz: `200Hz` is an absolute pitch, `+20Hz` a step from the voice.
  const hertz = signed ? basePitch + found.value : found.value;
  if (hertz <= 0) {
    return null;
  }
  const pitch = round(12 * Math.log2(hertz / basePitch));
  return signed ? { pitch } : { pitch, absolute: ['pitch'] };
}

function rangeChange(value) {
  if (Object.hasOwn(RANGES, value)) {
    return { range: RANGES[value], absolute: ['range'] };
  }
  const found = quantity(value, '%');
  return found && found.value >= -100 ? { range: 1 + found.value / 100 } : null;
}

/** `volume`: effort moves by dB/40 (labels from the normal effort). */
function volumeChange(value) {
  if (value === 'silent') {
    return { gain: -120, absolute: ['gain'] };
  }
  if (Object.hasOwn(VOLUMES, value)) {
    return { effort: round(0.5 + VOLUMES[value] / 40) };
  }
  const found = quantity(value, 'db');
  return found ? { effortBy: round(found.value / 40) } : null;
}

function gainChange(value) {
  const found = quantity(value, 'db');
  return found ? { gain: found.value } : null;
}

/** A number in [low, high], or null. */
function bounded(value, low, high) {
  if (value === undefined || String(value).trim() === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) && number >= low && number <= high
    ? number
    : null;
}

/** English, Russian, Hindi and Chinese ordinal forms the normalizer reads. */
function ordinalText(digits, lang) {
  const base = String(lang ?? 'en')
    .toLowerCase()
    .split(/[-_]/u)[0];
  if (base === 'ru') {
    return `${digits}-й`;
  }
  if (base === 'hi') {
    return `${digits}वाँ`;
  }
  if (base === 'zh') {
    return `第${digits}`;
  }
  const tens = Number(digits.slice(-2));
  const last = Number(digits.slice(-1));
  const suffix =
    tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][last] ?? 'th');
  return `${digits}${suffix}`;
}

/**
 * The text `say-as` reads for its content, or null for an unknown kind.
 * `characters` spells: runs of letters become dotted acronyms (`A.B.C.`),
 * which the text normalizer reads letter by letter.
 */
function sayAs(kind, content, lang) {
  const text = content.trim();
  switch (kind) {
    case 'cardinal':
    case 'number':
      return text;
    case 'ordinal':
      return /^\d+$/u.test(text) ? ordinalText(text, lang) : text;
    case 'digits':
      return [...text.replace(/\s+/gu, '')].join(' ');
    case 'characters':
    case 'spell-out':
      return (text.match(/\p{L}+|\P{L}/gu) ?? [])
        .filter((piece) => piece.trim())
        .map((piece) =>
          /\p{L}/u.test(piece) && piece.length > 1
            ? `${[...piece.toUpperCase()].join('.')}.`
            : piece.toUpperCase()
        )
        .join(' ');
    default:
      return null;
  }
}

class SsmlReader {
  constructor(input, options) {
    this.input = input;
    this.index = 0;
    this.limits = { ...MARKUP_LIMITS, ...options.limits };
    this.basePitch = options.head?.pitch ?? BASE_PITCH;
    this.lang = null;
    this.builder = new MarkupBuilder('ssml');
    this.elements = [];
    this.count = 0;
    this.prefixes = new Set(['vs']);
    this.closedRoot = false;
  }

  fail(message, position = this.index) {
    throw new MarkupError(message, position);
  }

  read() {
    const { input } = this;
    if (input.length > this.limits.maxLength) {
      this.fail(
        `markup longer than ${this.limits.maxLength} characters`,
        this.limits.maxLength
      );
    }
    while (this.index < input.length) {
      if (input[this.index] === '<') {
        this.readMarkup();
      } else {
        this.readText();
      }
    }
    if (this.elements.length > 0) {
      const open = this.elements.at(-1);
      this.fail(`<${open.name}> is not closed`, open.position);
    }
    if (!this.closedRoot) {
      this.fail('no <speak> element', 0);
    }
    return { ...this.builder.result(), lang: this.lang };
  }

  readText() {
    const end = this.input.indexOf('<', this.index);
    const stop = end < 0 ? this.input.length : end;
    const inside = this.elements.length > 0;
    let index = this.index;
    while (index < stop) {
      const char = this.input[index];
      if (!inside && !/\s/u.test(char)) {
        this.fail('text outside <speak>', index);
      }
      if (char === '&') {
        const [value, next] = this.entity(index);
        if (inside) {
          this.builder.append(value, index, 0);
        }
        index = next;
        continue;
      }
      if (inside) {
        this.builder.append(/\s/u.test(char) ? ' ' : char, index);
      }
      index++;
    }
    this.index = stop;
  }

  /** Decode the entity or character reference at `index`. */
  entity(index) {
    const end = this.input.indexOf(';', index);
    const body = end < 0 ? '' : this.input.slice(index + 1, end);
    if (!/^(?:#\d+|#x[\da-f]+|[A-Za-z][\w.-]*)$/iu.test(body)) {
      this.fail('bare & (write &amp;)', index);
    }
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      if (
        !(code > 0 && code <= 0x10ffff) ||
        (code >= 0xd800 && code < 0xe000)
      ) {
        this.fail(`invalid character reference &${body};`, index);
      }
      return [String.fromCodePoint(code), end + 1];
    }
    if (!Object.hasOwn(ENTITIES, body)) {
      this.fail(`unknown entity &${body};`, index);
    }
    return [ENTITIES[body], end + 1];
  }

  readMarkup() {
    const { input, index } = this;
    if (input.startsWith('<!--', index)) {
      const end = input.indexOf('-->', index + 4);
      if (end < 0) {
        this.fail('comment is not closed');
      }
      this.index = end + 3;
      return;
    }
    if (input.startsWith('<!DOCTYPE', index)) {
      this.fail('document type declarations are not allowed');
    }
    if (input.startsWith('<!ENTITY', index)) {
      this.fail('entity declarations are not allowed');
    }
    if (input.startsWith('<![CDATA[', index)) {
      this.fail('CDATA sections are not allowed');
    }
    if (input.startsWith('<!', index)) {
      this.fail('declarations are not allowed');
    }
    if (input.startsWith('<?', index)) {
      this.fail('processing instructions are not allowed');
    }
    if (input.startsWith('</', index)) {
      this.readClosingTag();
    } else {
      this.readOpeningTag();
    }
  }

  name(at) {
    NAME.lastIndex = at;
    const found = NAME.exec(this.input);
    if (!found) {
      this.fail('expected a name', at);
    }
    return found[0];
  }

  skipSpace(at) {
    SPACE.lastIndex = at;
    SPACE.exec(this.input);
    return SPACE.lastIndex;
  }

  readClosingTag() {
    const position = this.index;
    const name = this.name(position + 2);
    const at = this.skipSpace(position + 2 + name.length);
    if (this.input[at] !== '>') {
      this.fail(`expected > after </${name}`, at);
    }
    this.index = at + 1;
    const open = this.elements.at(-1);
    if (!open || open.name !== name) {
      this.fail(
        open ? `</${name}> closes <${open.name}>` : `unexpected </${name}>`,
        position
      );
    }
    this.close(open, position);
  }

  readOpeningTag() {
    const position = this.index;
    const name = this.name(position + 1);
    let at = position + 1 + name.length;
    const attributes = Object.create(null);
    for (;;) {
      const next = this.skipSpace(at);
      const char = this.input[next];
      if (char === '>' || this.input.startsWith('/>', next)) {
        at = next + (char === '>' ? 1 : 2);
        this.index = at;
        this.open(name, attributes, position, char !== '>');
        return;
      }
      if (next === at || char === undefined) {
        this.fail(`expected > to end <${name}`, next);
      }
      const attribute = this.name(next);
      const equals = this.skipSpace(next + attribute.length);
      if (this.input[equals] !== '=') {
        this.fail(`attribute ${attribute} has no value`, equals);
      }
      const quoteAt = this.skipSpace(equals + 1);
      const quote = this.input[quoteAt];
      if (quote !== '"' && quote !== "'") {
        this.fail(`value of ${attribute} must be quoted`, quoteAt);
      }
      const end = this.input.indexOf(quote, quoteAt + 1);
      if (end < 0) {
        this.fail(`value of ${attribute} is not closed`, quoteAt);
      }
      if (Object.hasOwn(attributes, attribute)) {
        this.fail(`attribute ${attribute} given twice`, next);
      }
      attributes[attribute] = this.attributeValue(quoteAt + 1, end);
      at = end + 1;
    }
  }

  attributeValue(start, end) {
    let value = '';
    let index = start;
    while (index < end) {
      const char = this.input[index];
      if (char === '<') {
        this.fail('< in an attribute value', index);
      }
      if (char === '&') {
        const [decoded, next] = this.entity(index);
        value += decoded;
        index = next;
      } else {
        value += /\s/u.test(char) ? ' ' : char;
        index++;
      }
    }
    return value;
  }

  /** The element name without a prefix of the project namespace. */
  localName(name) {
    const colon = name.indexOf(':');
    if (colon < 0) {
      return name;
    }
    const prefix = name.slice(0, colon);
    return this.prefixes.has(prefix) ? `vs:${name.slice(colon + 1)}` : name;
  }

  /** Read an attribute named with or without the `vs:` prefix. */
  attribute(attributes, name) {
    for (const [key, value] of Object.entries(attributes)) {
      if (this.localName(key) === name) {
        return value;
      }
    }
    return undefined;
  }

  open(rawName, attributes, position, selfClosing) {
    for (const [key, value] of Object.entries(attributes)) {
      if (key.startsWith('xmlns:') && value === MARKUP_NAMESPACE) {
        this.prefixes.add(key.slice(6));
      }
    }
    const name = this.localName(rawName);
    if (this.elements.length === 0) {
      if (name !== 'speak' || this.closedRoot) {
        this.fail('the root element must be one <speak>', position);
      }
    }
    this.count++;
    if (this.count > this.limits.maxElements) {
      this.fail(`more than ${this.limits.maxElements} elements`, position);
    }
    if (this.elements.length + 1 > this.limits.maxDepth) {
      this.fail(
        `elements nested deeper than ${this.limits.maxDepth}`,
        position
      );
    }
    const element = {
      name: rawName,
      local: name,
      attributes,
      position,
      contentStart: this.index,
      textStart: this.builder.text.length,
      pushed: false,
    };
    this.elements.push(element);
    this.start(element);
    if (selfClosing) {
      this.close(element, this.index);
    } else if (EMPTY_ELEMENTS.has(name)) {
      const end = this.skipSpace(this.index);
      if (!this.input.startsWith(`</${rawName}`, end)) {
        this.fail(`<${rawName}> must be empty`, this.index);
      }
      this.index = end;
    }
  }

  push(element, change) {
    this.builder.push(change);
    element.pushed = true;
  }

  warn(element, message) {
    this.builder.warn(element.position, message);
  }

  /** Act on an opening tag. */
  start(element) {
    const change = CHANGES.get(element.local);
    if (typeof change === 'function') {
      this.push(element, change(this, element));
      return;
    }
    if (!STARTS.has(element.local)) {
      this.warn(element, `unknown element <${element.name}>`);
      return;
    }
    const handler = STARTS.get(element.local);
    if (typeof handler === 'function') {
      handler(this, element);
    }
  }

  startSpeak(element) {
    this.lang = element.attributes['xml:lang'] ?? null;
  }

  startParagraph(element) {
    this.builder.separate(element.position);
    const lang = element.attributes['xml:lang'];
    if (lang) {
      this.push(element, { lang });
    }
  }

  startLang(element) {
    const lang = element.attributes['xml:lang'];
    if (lang) {
      this.push(element, { lang });
    } else {
      this.warn(element, '<lang> without xml:lang');
    }
  }

  startPhoneme(element) {
    const { alphabet, ph } = element.attributes;
    if (alphabet && alphabet !== 'ipa') {
      this.warn(element, `alphabet ${alphabet} is not ipa`);
    } else if (!ph) {
      this.warn(element, '<phoneme> without ph');
    }
  }

  emphasis(element) {
    const level = element.attributes.level ?? 'strong';
    if (!Object.hasOwn(EMPHASIS, level)) {
      this.warn(element, `unknown emphasis level ${level}`);
      return { emphasis: 1 };
    }
    return { emphasis: EMPHASIS[level] };
  }

  startBreak(element) {
    const { attributes } = element;
    let seconds = BREAK_STRENGTHS.medium;
    if (attributes.time !== undefined) {
      seconds = parseTime(attributes.time);
      if (seconds === null) {
        this.warn(element, `cannot read time="${attributes.time}"`);
        seconds = BREAK_STRENGTHS.medium;
      }
    } else if (attributes.strength !== undefined) {
      if (Object.hasOwn(BREAK_STRENGTHS, attributes.strength)) {
        seconds = BREAK_STRENGTHS[attributes.strength];
      } else {
        this.warn(element, `unknown break strength ${attributes.strength}`);
      }
    }
    if (seconds > this.limits.maxPauseSeconds) {
      this.fail(
        `break longer than ${this.limits.maxPauseSeconds} s`,
        element.position
      );
    }
    this.builder.separate(element.position);
    this.builder.addBreak(seconds);
  }

  startSound(element) {
    const name = this.attribute(element.attributes, 'name');
    if (!SOUND_NAMES.includes(name)) {
      this.warn(element, `unknown sound ${name}`);
      return;
    }
    const given = this.attribute(element.attributes, 'duration');
    let duration = null;
    if (given !== undefined) {
      duration = parseTime(given);
      if (duration === null) {
        this.warn(element, `cannot read duration="${given}"`);
      } else if (duration > this.limits.maxPauseSeconds) {
        this.fail(
          `sound longer than ${this.limits.maxPauseSeconds} s`,
          element.position
        );
      }
    }
    this.builder.separate(element.position);
    this.builder.addSound(name, duration);
  }

  /** The change of the `prosody` attributes (unreadable ones warn). */
  prosody(element) {
    const { attributes } = element;
    const change = { absolute: [] };
    const readers = {
      rate: rateChange,
      pitch: (value) => pitchChange(value, this.basePitch),
      range: rangeChange,
      volume: volumeChange,
      'vs:gain': gainChange,
    };
    for (const [key, value] of Object.entries(attributes)) {
      const name = this.localName(key);
      if (!Object.hasOwn(readers, name)) {
        if (!key.startsWith('xmlns')) {
          this.warn(element, `unknown prosody attribute ${key}`);
        }
        continue;
      }
      const part = readers[name](value.trim());
      if (!part) {
        this.warn(element, `cannot read ${key}="${value}"`);
        continue;
      }
      change.absolute.push(...(part.absolute ?? []));
      Object.assign(change, { ...part, absolute: change.absolute });
    }
    return change;
  }

  effort(element) {
    const level = this.attribute(element.attributes, 'level');
    const value = this.attribute(element.attributes, 'value');
    const to = this.attribute(element.attributes, 'to');
    const change = {};
    if (level === 'whisper') {
      change.phonation = { whisper: 1 };
    } else if (level === 'lombard') {
      Object.assign(change, { effort: LOMBARD_EFFORT, lombard: true });
    } else if (Object.hasOwn(EFFORT_LEVELS, level ?? '')) {
      change.effort = EFFORT_LEVELS[level];
    } else if (level !== undefined) {
      this.warn(element, `unknown effort level ${level}`);
    }
    if (value !== undefined) {
      const effort = bounded(value, 0, 1);
      if (effort === null) {
        this.warn(element, `effort value must be 0..1, got ${value}`);
      } else {
        change.effort = effort;
      }
    }
    if (to !== undefined) {
      const end = bounded(to, 0, 1);
      if (end === null) {
        this.warn(element, `effort to must be 0..1, got ${to}`);
      } else {
        change.effortEnd = end;
      }
    }
    return change;
  }

  phonation(element) {
    const name = this.attribute(element.attributes, 'name');
    const given = this.attribute(element.attributes, 'degree');
    if (!Object.hasOwn(PHONATIONS, name ?? '')) {
      this.warn(element, `unknown phonation ${name}`);
      return {};
    }
    const degree = given === undefined ? DEFAULT_DEGREE : bounded(given, 0, 1);
    if (degree === null) {
      this.warn(element, `phonation degree must be 0..1, got ${given}`);
    }
    return PHONATIONS[name](degree ?? DEFAULT_DEGREE);
  }

  emotion(element) {
    const read = (key, low, high) => {
      const value = this.attribute(element.attributes, key);
      if (value === undefined) {
        return undefined;
      }
      const number = bounded(value, low, high);
      if (number === null) {
        this.warn(element, `${key} must be ${low}..${high}, got ${value}`);
      }
      return number ?? undefined;
    };
    const name = this.attribute(element.attributes, 'name');
    if (name !== undefined && !Object.hasOwn(EMOTIONS, name)) {
      this.warn(element, `unknown emotion ${name}`);
      return {};
    }
    return {
      emotion: emotionOf({
        name,
        intensity: read('intensity', 0, 1),
        arousal: read('arousal', -1, 1),
        valence: read('valence', -1, 1),
        dominance: read('dominance', -1, 1),
      }),
    };
  }

  /** Act on a closing tag at `position` (or the end of an empty tag). */
  close(element, position) {
    this.elements.pop();
    const handler = CLOSES.get(element.local);
    if (typeof handler === 'function') {
      handler(this, element, position);
    }
    if (element.pushed) {
      this.builder.pop();
    }
    if (element.local === 'p' || element.local === 's') {
      this.builder.separate(position);
    }
  }

  closeRoot() {
    this.closedRoot = true;
  }

  /** A `p` or `s` with text and no final punctuation ends with `.`. */
  closeParagraph(element, position) {
    const builder = this.builder;
    if (
      builder.text.slice(element.textStart).trim() &&
      !FINAL_PUNCTUATION.test(builder.text)
    ) {
      const trailing = builder.text.length - builder.text.trimEnd().length;
      builder.text = builder.text.trimEnd();
      builder.offsets.length -= trailing;
      builder.modes.length -= trailing;
      builder.append('.', position, 0);
    }
  }

  closeEmpty(element, position) {
    this.builder.separate(position);
  }

  closePhoneme(element) {
    const { attributes, textStart } = element;
    if (attributes.ph && (attributes.alphabet ?? 'ipa') === 'ipa') {
      this.builder.overrides.push({
        start: textStart,
        end: this.builder.text.length,
        ipa: attributes.ph.trim(),
      });
    }
  }

  /** `sub` and `say-as`: read another text for the content. */
  replace(element, position) {
    const builder = this.builder;
    const { attributes, local, textStart } = element;
    const original = builder.text.slice(textStart);
    let text;
    if (local === 'sub') {
      text = attributes.alias;
      if (text === undefined) {
        this.warn(element, '<sub> without alias');
        return;
      }
    } else {
      const kind = attributes['interpret-as'];
      const lang = builder.mode.lang ?? this.lang;
      text = sayAs(kind, original, lang);
      if (text === null) {
        this.warn(element, `say-as ${kind} is read as plain text`);
        return;
      }
    }
    const lead = original.length - original.trimStart().length;
    const sourceStart = original.trim()
      ? builder.offsets[textStart + lead]
      : element.contentStart;
    const sourceEnd = original.trim()
      ? builder.offsets[textStart + original.trimEnd().length - 1] + 1
      : position;
    builder.replaceFrom(textStart, text, sourceStart);
    builder.sources.push({
      start: textStart,
      end: builder.text.length,
      sourceStart,
      sourceEnd,
      original: original.trim(),
    });
  }
}

/**
 * Read the SSML subset. Malformed input and inputs over `MARKUP_LIMITS`
 * throw `MarkupError`; unknown elements and unreadable values add warnings.
 * @param {string} input
 * @param {{head?: {pitch?: number}, limits?: object}} [options]
 */
export function parseSsml(input, options = {}) {
  return new SsmlReader(String(input), options).read();
}
