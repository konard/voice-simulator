/**
 * Contextual Mandarin tones for recognised words. The lexicon stores
 * citation tones per word, while speech realises third-tone sandhi and
 * half-third tones across word boundaries. Re-reading the recognised
 * characters as one text gives the realised tone of every syllable, the
 * same way synthesis plans them. Unlicense.
 */
import { textToIpa } from '../g2p/index.js';

const HAN = /\p{Script=Han}/gu;
const TONE = /[˥˦˧˨˩]+/gu;
/** Shortest silence (s) between words that separates two phrases. */
const PHRASE_PAUSE = 0.15;

function contextualSyllables(text) {
  const syllables = new Map();
  for (const { ipa, sourceStart, original } of textToIpa(text, { lang: 'zh' })
    .words) {
    const parts = ipa.split(/\s+/u);
    const characters = [...original.matchAll(HAN)];
    if (characters.length === parts.length) {
      characters.forEach(({ index }, i) => {
        syllables.set(sourceStart + index, parts[i]);
      });
    }
  }
  return syllables;
}

/** Keep the heard segments and replace only their tone letters. */
function withTone(heard, realised) {
  const tone = realised.match(TONE)?.join('') ?? '';
  const base = heard.replace(TONE, '');
  return heard.match(TONE)
    ? heard.replace(TONE, () => tone)
    : tone && base === realised.replace(TONE, '')
      ? realised
      : heard;
}

/**
 * Give Mandarin syllables of a recognition result their tones in context.
 * Syllables whose characters cannot be matched keep their tones.
 */
export function realiseChineseTones(result) {
  if (!result.words.some((word) => word.language === 'zh')) {
    return result;
  }
  // Chinese words join without spaces; other words are separate. A pause
  // ends a phrase, so tones do not change across it.
  const starts = [];
  let text = '';
  result.words.forEach((word, i) => {
    const previous = result.words[i - 1];
    if (previous && word.start - previous.end >= PHRASE_PAUSE) {
      text += '，';
    } else if (
      previous &&
      !(word.language === 'zh' && previous.language === 'zh')
    ) {
      text += ' ';
    }
    starts.push(text.length);
    text += word.text;
  });
  const syllables = contextualSyllables(text);
  const words = result.words.map((word, w) => {
    const start = starts[w];
    const characters = [...word.text.matchAll(HAN)];
    if (
      word.language !== 'zh' ||
      characters.length !== word.syllables.length ||
      !characters.length
    ) {
      return word;
    }
    const mapped = word.syllables.map((syllable, i) => {
      const realised = syllables.get(start + characters[i].index);
      return realised
        ? { ...syllable, ipa: withTone(syllable.ipa, realised) }
        : syllable;
    });
    return {
      ...word,
      ipa: mapped.map((syllable) => syllable.ipa).join(' '),
      syllables: mapped,
    };
  });
  return {
    ...result,
    ipa: words.map((word) => word.ipa).join(' '),
    words,
  };
}
