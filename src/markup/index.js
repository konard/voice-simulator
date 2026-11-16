/**
 * Speech markup: how a text is spoken. Three written forms mean the same
 * thing: an SSML subset (`<speak>…</speak>`), inline tags for plain text
 * (`[whisper]…[/whisper]`, read only with `markup: true`) and the
 * ExtIPA/VoQS marks of an IPA string (`{W … W}`, see src/ipa/parse.js).
 * All end in mode spans (src/markup/modes.js). See docs/markup.md.
 */

import { parseInline } from './inline.js';
import { parseSsml } from './ssml.js';

export { MarkupError, MARKUP_LIMITS } from './builder.js';
export { parseInline } from './inline.js';
export { MARKUP_NAMESPACE, parseSsml } from './ssml.js';
export {
  MODE_DEFAULTS,
  MODE_FIELDS,
  EFFORT_LEVELS,
  EMOTIONS,
  PHONATIONS,
  SOUND_NAMES,
  SOUND_DURATION,
  composeMode,
  createMode,
  effortDecibels,
  emotionOf,
  isDefaultMode,
  modeKey,
} from './modes.js';

/**
 * Whether a text is SSML: its trimmed form starts with `<speak`. A text
 * that starts with an XML declaration or a document type is read as SSML
 * too, so that `parseMarkup()` refuses it with `MarkupError`.
 */
export function isSsml(text) {
  return /^(?:<speak[\s>/]|<\?xml[\s?]|<!DOCTYPE[\s>])/iu.test(
    String(text).trimStart()
  );
}

/** The result for a plain text: the text itself, no spans. */
function plain(text) {
  return {
    markup: null,
    text,
    offsets: Array.from(text, (_, index) => index),
    spans: [],
    breaks: [],
    sounds: [],
    overrides: [],
    sources: [],
    warnings: [],
    lang: null,
  };
}

/**
 * Read the markup of a text.
 *
 * - `markup: false`: the text is plain;
 * - a text whose trimmed form starts with `<speak` is SSML (also `<?xml`
 *   and `<!DOCTYPE`, which are refused);
 * - otherwise inline tags are read only when `markup === true`.
 *
 * `text` is what the text front end reads; `offsets[i]` is the position in
 * the input of `text[i]`; `spans` are sorted, not overlapping ranges of
 * `text` with their composed mode; `breaks` and `sounds` are at character
 * indexes of `text`; `overrides` give the IPA of a range (`phoneme`,
 * `[ipa …]`); `sources` map the replaced text of `sub` and `say-as` back
 * to the element content. `markup` is 'ssml', 'inline' or null (plain).
 * SSML that cannot be read throws `MarkupError`; inline tags never throw.
 * @param {string} text
 * @param {{markup?: boolean, head?: {pitch?: number}, limits?: object}} [options]
 */
export function parseMarkup(text, options = {}) {
  const input = String(text ?? '');
  if (options.markup === false) {
    return plain(input);
  }
  if (isSsml(input)) {
    return parseSsml(input, options);
  }
  if (options.markup === true) {
    return { ...parseInline(input, options), lang: null };
  }
  return plain(input);
}
