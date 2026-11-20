/** Parse string or timed-phone input while retaining boundary positions. */
import { parseIpa } from '../ipa/parse.js';

function timedSound(sound) {
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
    (sound.whispered &&
      (!Number.isFinite(sound.voicing) ||
        sound.voicing < 0 ||
        sound.voicing > 1))
  ) {
    throw new TypeError(
      'sounds need IPA, finite start/end seconds and confidence in [0, 1]'
    );
  }
  return parseIpa(sound.ipa);
}

function whisperEvidence(chunk, token) {
  return {
    ...(chunk.whispered && { whispered: true, voicing: chunk.voicing }),
    ...(chunk.tones && token.kind === 'vowel' && { tones: chunk.tones }),
  };
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
  for (const chunk of chunks) {
    const parsed = timed ? timedSound(chunk) : parseIpa(chunk.ipa);
    if (parsed.unknown.length) {
      throw new TypeError(`unknown IPA: ${parsed.unknown.join('')}`);
    }
    if (timed && chunk.start < previousStart) {
      throw new RangeError('timed sounds must be ordered by start');
    }
    previousStart = chunk.start;
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
          ...whisperEvidence(chunk, token),
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
