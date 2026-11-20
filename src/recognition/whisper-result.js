/** Post-decoding whispered consonant cues and VoQS notation. Unlicense. */
import { levelDb } from '../analysis/mode-features.js';
import { parseIpa } from '../ipa/parse.js';
import { WHISPER_CUES } from './data/whisper-cues.js';
import { whisperAt } from './whisper.js';

const cuePairs = new Map(
  WHISPER_CUES.flatMap((pair) => pair.map(([ipa]) => [ipa, pair]))
);

export function whisperVoicingProbability(ratio, relativeDb, pair) {
  const distance = ([, [duration, spread], [db, dbSpread]]) =>
    Math.hypot(
      (ratio - duration) / Math.max(spread, 1e-6),
      (relativeDb - db) / Math.max(dbSpread, 1e-6)
    );
  return 1 / (1 + Math.exp(distance(pair[1]) - distance(pair[0])));
}

function scoreVoice(frames, sound, vowel, pair) {
  const { samples, startTime, rate } = frames;
  const level = ({ start, end }) =>
    levelDb(samples, (start - startTime) * rate, (end - startTime) * rate);
  return whisperVoicingProbability(
    (sound.end - sound.start) / (vowel.end - vowel.start),
    level(sound) - level(vowel),
    pair
  );
}

function nextVowel(segments, index, end) {
  for (let i = index + 1; i < segments.length; i++) {
    const next = segments[i];
    if (next.start >= end || next.kind === 'pause') {
      break;
    }
    if (next.kind === 'vowel') {
      return next;
    }
  }
}

function scoreConsonant(sound, vowel, frames) {
  const token = parseIpa(sound.ipa).tokens[0];
  if (
    !token ||
    (!token.affricate &&
      !['plosive', 'fricative', 'lateral-fricative'].includes(
        token.phoneme?.manner
      ))
  ) {
    return;
  }
  const base = (
    token.affricate
      ? `${token.affricate.stop}͡${token.affricate.fricative}`
      : token.base
  ).replaceAll('g', 'ɡ');
  const pair = cuePairs.get(base);
  const voicing = pair && vowel ? scoreVoice(frames, sound, vowel, pair) : 0.5;
  Object.assign(sound, { whispered: true, voicing });
  if (pair && voicing !== 0.5) {
    const counterpart = pair[Number(voicing > 0.5)][0];
    sound.ipa = token.affricate
      ? sound.ipa.replace(/^.+?͡./u, counterpart)
      : sound.ipa.replace(token.base, counterpart);
  }
}

export function whisperVoicing(segments, frames, spans, from = 0) {
  if (!spans.length) {
    return segments;
  }
  let previousVowel;
  let previousSpan;
  for (const [i, sound] of segments.entries()) {
    const span = whisperAt(spans, (sound.start + sound.end) / 2);
    if (span !== previousSpan || sound.kind === 'pause') {
      previousVowel = undefined;
    }
    previousSpan = span;
    if (sound.kind === 'vowel') {
      previousVowel = sound;
    }
    if (i < from || !span || sound.kind !== 'consonant') {
      continue;
    }
    scoreConsonant(
      sound,
      previousVowel ?? nextVowel(segments, i, span.end),
      frames
    );
  }
  return segments;
}

export function whisperModeSpans(items, spans) {
  const selected = spans.map(({ start, end, confidence }) => {
    const inside = ({ start: a, end: b }) =>
      a < end && b > start && start <= (a + b) / 2 && (a + b) / 2 < end;
    const from = items.findIndex(inside);
    const to = items.findLastIndex(inside) + 1;
    return {
      start,
      end,
      from,
      to,
      confidence,
      phonation: { whisper: 1 },
      notation: 'W',
    };
  });
  return selected.filter(({ from }) => from >= 0);
}

export function wrapWhisperIpa(items, modes, separator = '') {
  let ipa = '';
  let i = 0;
  for (const span of modes) {
    const spoken = items
      .slice(span.from, span.to)
      .map((item) => item.ipa)
      .join(separator);
    const before = items
      .slice(i, span.from)
      .map((item) => item.ipa)
      .join(separator);
    ipa = [ipa, before, spoken && `{W ${spoken} W}`].filter(Boolean).join(' ');
    i = span.to;
  }
  const rest = items
    .slice(i)
    .map((item) => item.ipa)
    .join(separator);
  return [ipa, rest].filter(Boolean).join(' ');
}
