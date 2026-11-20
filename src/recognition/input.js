/** Parse string or timed-phone input while retaining boundary positions. */
import { parseIpa } from '../ipa/parse.js';

function timedSound(sound, previousStart) {
  if (
    !sound ||
    typeof sound.ipa !== 'string' ||
    !Number.isFinite(sound.start) ||
    !Number.isFinite(sound.end) ||
    sound.start < 0 ||
    sound.end < sound.start ||
    !Number.isFinite(sound.confidence) ||
    sound.confidence < 0 ||
    sound.confidence > 1 ||
    (sound.voicing !== undefined &&
      (!Number.isFinite(sound.voicing) ||
        sound.voicing < 0 ||
        sound.voicing > 1))
  ) {
    throw new TypeError(
      'sounds need IPA, finite start/end seconds and confidence in [0, 1]'
    );
  }
  if (sound.start < previousStart) {
    throw new RangeError('timed sounds must be ordered by start');
  }
  return parseIpa(sound.ipa);
}

function measuredFeatures(token, chunk) {
  const features = {};
  if (chunk.whispered) {
    features.whispered = true;
    features.voicing = chunk.voicing;
  }
  if (token.kind !== 'vowel') {
    return features;
  }
  if (Object.hasOwn(chunk, 'tones')) {
    features.tones = chunk.tones;
  }
  if (Number.isFinite(chunk.prominence)) {
    features.prominence = chunk.prominence;
  }
  return features;
}

export function recognitionInput(ipa, boundaries) {
  const tokens = [];
  const hard = new Set([0]);
  const given = new Set([0]);
  const timed = Array.isArray(ipa);
  if (!timed && typeof ipa !== 'string') {
    throw new TypeError('IPA must be a string or an array of timed sounds');
  }
  const chunks = timed ? ipa : [{ ipa, start: null, end: null, confidence: 1 }];
  let previousStart = 0;
  let previousWord;
  for (const chunk of chunks) {
    const parsed = timed
      ? timedSound(chunk, previousStart)
      : parseIpa(chunk.ipa);
    if (parsed.unknown.length) {
      throw new TypeError(`unknown IPA: ${parsed.unknown.join('')}`);
    }
    previousStart = chunk.start;
    if (chunk.modelWord > previousWord) {
      // The acoustic verifier has recovered the duration of the word gap.
      hard.add(tokens.length);
      given.add(tokens.length);
    }
    previousWord = chunk.modelWord;
    for (const token of parsed.tokens) {
      if (token.kind === 'pause') {
        given.add(tokens.length);
        if (token.strength > 0 || token.seconds !== undefined) {
          hard.add(tokens.length);
        }
      } else if (['vowel', 'consonant'].includes(token.kind)) {
        tokens.push({
          ...token,
          start: chunk.start,
          end: chunk.end,
          confidence: chunk.confidence,
          ...measuredFeatures(token, chunk),
        });
      } else {
        throw new TypeError('IPA-to-text accepts speech sounds and pauses');
      }
    }
  }
  hard.add(tokens.length);
  given.add(tokens.length);
  return {
    tokens,
    boundaries: boundaries === 'given' ? given : hard,
    pauses: hard,
    timed,
  };
}
