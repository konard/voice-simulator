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

function attachMeasurements(token, chunk) {
  token.start = chunk.start;
  token.end = chunk.end;
  token.confidence = chunk.confidence;
  if (chunk.whispered) {
    token.whispered = true;
    token.voicing = chunk.voicing;
  }
  if (token.kind !== 'vowel') {
    return;
  }
  if (Object.hasOwn(chunk, 'tones')) {
    token.tones = chunk.tones;
  }
  if (Number.isFinite(chunk.prominence)) {
    token.prominence = chunk.prominence;
  }
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
      } else if (token.kind === 'vowel' || token.kind === 'consonant') {
        attachMeasurements(token, chunk);
        tokens.push(token);
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
