/** Apply measured prosody to a timed recognition result. */
import { formatIpa, parseIpa } from '../ipa/parse.js';
import {
  ALTERNATIVE_CONJUNCTIONS,
  emphasizedIpa,
  englishAuxiliary,
  hasZhQuestionWord,
} from '../g2p/phrasing.js';
import { VERBALIZERS } from '../g2p/normalize.js';
import { POLAR_PARTICLE } from '../g2p/verbalize-hi.js';
import { BOUNDARIES } from '../articulation/prosody.js';
import { quantile } from './mode-features.js';
import { whisperAt } from './whisper.js';
import { whisperModeSpans } from './whisper-result.js';
import {
  bestTone,
  frameSlice,
  mean,
  span,
  voicedBetween,
} from './prosody-features.js';

/**
 * Shortest gap (s) between two words heard as a phrase break: the comma
 * pause of articulation/prosody.js (0.2 s) less the word edges the decoder
 * lets into it (measured gaps 0.18–0.19 s at telephone).
 */
const PHRASE_GAP = 0.15;

function phraseRanges(words, sounds, whispered) {
  const ranges = [];
  const pauses = sounds.filter(
    (s) => parseIpa(s.ipa).tokens[0]?.kind === 'pause'
  );
  let from = 0;
  let pauseIndex = 0;
  for (let to = 1; to < words.length; to++) {
    const end = words[to - 1].end;
    const start = words[to].start;
    while (pauses[pauseIndex]?.end <= end) {
      pauseIndex++;
    }
    const pause = pauses[pauseIndex];
    const duration =
      pause && pause.start < start
        ? Math.max(
            start - end,
            Math.min(start, pause.end) - Math.max(end, pause.start)
          )
        : start - end;
    if (duration >= PHRASE_GAP || whispered[to] !== whispered[to - 1]) {
      ranges.push({ from, to, pause: duration });
      from = to;
    }
  }
  ranges.push({ from, to: words.length, pause: Infinity });
  return ranges;
}

function mostProminent(sounds) {
  return sounds.reduce(
    (best, sound) =>
      (sound?.prominence ?? -Infinity) > (best?.prominence ?? -Infinity)
        ? sound
        : best,
    undefined
  );
}

function markUnknown(word, nuclei, language) {
  const choices = word.syllables.map((syllable) =>
    mostProminent(
      nuclei.filter((n) => n.start < syllable.end && n.end > syllable.start)
    )
  );
  const accent = word.syllables.length > 1 ? mostProminent(choices) : undefined;
  const syllables = word.syllables.map((syllable, i) => {
    const tokens = parseIpa(syllable.ipa).tokens;
    let stress = syllable.stress;
    if (language === 'zh' && choices[i]?.tones) {
      const last = tokens.findLast((token) => token.kind === 'vowel');
      if (last) {
        tokens.forEach((token) => {
          token.tone = null;
        });
        last.tone = Array.from(
          bestTone(choices[i].tones),
          (c) => '˩˨˧˦˥'.indexOf(c) + 1
        );
      }
    }
    if (accent) {
      stress = choices[i] === accent && choices.indexOf(accent) === i ? 1 : 0;
      tokens.forEach((token, j) => {
        token.stress = j === 0 ? stress : 0;
      });
    }
    return { ...syllable, stress, ipa: formatIpa(tokens) };
  });
  return { ...word, syllables, ipa: syllables.map((s) => s.ipa).join('') };
}

function phraseLanguage(words, fallback) {
  const counts = new Map();
  for (const word of words) {
    const language = word.language ?? word.lang ?? fallback;
    counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
}

function hasWh(words, language) {
  if (language === 'zh') {
    const text = words.map((word) => word.text).join('');
    return hasZhQuestionWord(text);
  }
  const isWh = VERBALIZERS[language]?.isWhWord;
  return words.some(
    ({ text }, i) =>
      !(language === 'hi' && !i && text === POLAR_PARTICLE) && isWh?.(text)
  );
}

function whisperedMark(words, phrase, language) {
  if (
    hasWh(words, language) ||
    (language === 'zh' && words.at(-1).text.endsWith('吗')) ||
    (language === 'hi' && words[0].text === POLAR_PARTICLE)
  ) {
    return '?';
  }
  return Number.isFinite(phrase.pause) ? '' : '.';
}

function russianRise(words, pitch, endTime, endPitch) {
  return words.some((word) =>
    word.syllables.some((syllable) => {
      if (syllable.stress !== 1) {
        return false;
      }
      const values = voicedBetween(pitch, syllable.start, syllable.end);
      const start = quantile(values.slice(0, 3));
      const peak = values.reduce(
        (highest, pitch) => Math.max(highest, pitch),
        -Infinity
      );
      // IK3 retains its peak when there is no post-stress vowel for the fall.
      const finalStress =
        word === words.at(-1) && syllable === word.syllables.at(-1);
      const coda = voicedBetween(pitch, syllable.end, endTime);
      return (
        values.length >= 3 &&
        peak - start >= 5 &&
        (endPitch < start ||
          (finalStress && coda.length < 16 && endPitch >= peak - 2))
      );
    })
  );
}

const dbDifference = (a, b) =>
  10 * Math.log10(Math.max(a, 1e-20) / Math.max(b, 1e-20));

export function phraseCues(
  voiced,
  tail,
  phraseEnergy,
  utteranceEnergy,
  otherPitch
) {
  const third = Math.max(1, Math.floor(voiced.length / 3));
  return {
    rise: quantile(tail.slice(-3)) - quantile(tail.slice(0, 3)),
    level: quantile(voiced),
    span: span(voiced),
    loud: dbDifference(phraseEnergy, utteranceEnergy),
    thirds: mean(voiced.slice(-third)) - mean(voiced.slice(0, third)),
    reset: quantile(voiced, 0.95) - quantile(otherPitch, 0.95),
  };
}

/**
 * Shortest pause after a sentence (s): halfway between the synthesiser's
 * comma and sentence pauses (BOUNDARIES in articulation/prosody.js).
 */
const SENTENCE_PAUSE = (BOUNDARIES.comma.pause + BOUNDARIES.period.pause) / 2;

function phraseMark(
  words,
  phrase,
  language,
  measured,
  utteranceEnergy,
  otherPitch
) {
  const { pitch, range } = measured;
  const start = words[0].start;
  const end = words.at(-1).end;
  const tail = voicedBetween(pitch, Math.max(start, end - 0.25), end);
  // First rule that fits (semitones, except for loudness in dB):
  // fewer than five tail frames → final period only
  // after a rise before the conjunction of an alternative question → `↘ ?`
  // wh-word → falling question; zh 吗 or initial hi क्या → question
  // en tail rise ≥ 3, hi ≥ 4; ru stressed rise ≥ 5 followed by a fall
  //   (before the last phrase opening with or, или, या, 还是 → `↗ |`)
  // zh mean pitch rises ≥ 2 between the outer thirds → question
  // level ≥ 1, span ≥ 1.2 × range, loud ≥ 2 with other phrases → exclamation
  // nonfinal pause < 0.31 s → continuation (no question or exclamation)
  // nonfinal pause < 0.5 s → continuation; otherwise → statement
  if (phrase.alternative === 'last') {
    return '↘ ?';
  }
  if (tail.length < 5) {
    return Number.isFinite(phrase.pause) ? '' : '.';
  }
  if (hasWh(words, language)) {
    return '↘ ?';
  }
  const voiced = voicedBetween(pitch, start, end);
  const cues = phraseCues(
    voiced,
    tail,
    mean(frameSlice(pitch, pitch.energy, start, end)),
    utteranceEnergy,
    otherPitch
  );
  // A shorter pause than a sentence's ends a clause: its rise or raised
  // register is a continuation (a Russian comma is a weaker IK3).
  const clause = phrase.pause < SENTENCE_PAUSE;
  const polar = risingMark(words, phrase, language, cues, pitch, tail);
  if (polar) {
    return polar;
  }
  const expanded = cues.level >= 1 && cues.span >= 1.2 * range;
  // Some of the forward tunes fall sharply or narrow despite a raised
  // register (IK2). Compare the upper register with other speech as well.
  if (
    !clause &&
    otherPitch.length >= 5 &&
    cues.loud >= 2 &&
    (expanded || cues.reset >= 1)
  ) {
    return '!';
  }
  return phrase.pause < 0.5 ? ',' : '.';
}

/** The mark of a phrase's rise: a question, an alternative's `↗ |` or ''. */
function risingMark(words, phrase, language, cues, pitch, tail) {
  const rise = polarMark(words, language, cues, pitch, tail);
  if (rise && phrase.alternative === 'before') {
    return '↗ |';
  }
  return phrase.pause < SENTENCE_PAUSE ? '' : rise;
}

function polarMark(words, language, cues, pitch, tail) {
  if (language === 'en' && cues.rise >= 3) {
    return englishAuxiliary(words[0].text) ? '?' : '↗ ?';
  }
  if (
    language === 'hi' &&
    (words[0].text === POLAR_PARTICLE || cues.rise >= 4)
  ) {
    return '?';
  }
  if (
    language === 'ru' &&
    russianRise(words, pitch, words.at(-1).end, quantile(tail.slice(-3)))
  ) {
    return '?';
  }
  if (language === 'zh') {
    const trend = toneTrend(words, pitch);
    if (
      words.at(-1).text.endsWith('吗') ||
      (trend ?? cues.thirds) >= ZH_QUESTION_TREND
    ) {
      return '?';
    }
  }
  return '';
}

const CHAO = '˩˨˧˦˥';

/**
 * Semitones of tone-free rise over a Mandarin phrase from which it is
 * heard as a question (experiments/issue-75-zh-marks.mjs: statements
 * reach 1.4, the A-not-A question 远不远 1.7 at telephone).
 */
const ZH_QUESTION_TREND = 1.6;

/** Mean Chao level of the tone letters of a syllable, or null (neutral). */
function chaoLevel(ipa) {
  const levels = [...ipa]
    .map((c) => CHAO.indexOf(c) + 1)
    .filter((level) => level > 0);
  return levels.length ? mean(levels) : null;
}

/** Solve the 3 × 3 system `a x = b` (Cramer's rule); null if singular. */
function solve3(a, b) {
  const det = (m) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const d = det(a);
  if (Math.abs(d) < 1e-9) {
    return null;
  }
  return [0, 1, 2].map(
    (k) => det(a.map((row, i) => row.map((v, j) => (j === k ? b[i] : v)))) / d
  );
}

/**
 * Pitch trend of a Mandarin phrase in semitones over its toned syllables:
 * the time slope of a least-squares fit of each syllable's mean pitch to
 * an offset, a slope and a multiple of its mean Chao tone level, times the
 * time from the first to the last syllable. The lexical tones are thereby
 * taken out: a statement declines, a question without a particle is
 * raised towards its end (TUNES.zh.question in articulation/intonation.js).
 * Null with fewer than four toned syllables.
 */
export function toneTrend(words, pitch) {
  const rows = [];
  for (const syllable of words.flatMap((word) => word.syllables ?? [])) {
    const level = chaoLevel(syllable.ipa ?? '');
    const values = voicedBetween(pitch, syllable.start, syllable.end);
    if (level !== null && values.length >= 3) {
      rows.push([(syllable.start + syllable.end) / 2, level, mean(values)]);
    }
  }
  if (rows.length < 4) {
    return null;
  }
  const a = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const b = [0, 0, 0];
  for (const [time, level, value] of rows) {
    const x = [1, time, level];
    for (let i = 0; i < 3; i++) {
      b[i] += x[i] * value;
      for (let j = 0; j < 3; j++) {
        a[i][j] += x[i] * x[j];
      }
    }
  }
  const fit = solve3(a, b);
  return fit && fit[1] * (rows.at(-1)[0] - rows[0][0]);
}

function pitchPeak(syllable, pitch) {
  const values = voicedBetween(pitch, syllable.start, syllable.end);
  return values.length
    ? {
        value: values.reduce((a, b) => Math.max(a, b)),
        time: (syllable.start + syllable.end) / 2,
      }
    : null;
}

export function expectedPeak(peaks, time) {
  const x = mean(peaks.map((peak) => peak.time));
  const y = mean(peaks.map((peak) => peak.value));
  const variance = mean(peaks.map((peak) => (peak.time - x) ** 2));
  const slope = variance
    ? mean(peaks.map((peak) => (peak.time - x) * (peak.value - y))) / variance
    : 0;
  return y + slope * (time - x);
}

function emphasisOf(words, language, pitch) {
  if (!['en', 'zh'].includes(language) || words.length < 3) {
    return [];
  }
  const peaks = words.map((word) => {
    const stressed = word.syllables.filter((syllable) => syllable.stress === 1);
    return (stressed.length || language === 'en' ? stressed : word.syllables)
      .map((syllable) => pitchPeak(syllable, pitch))
      .filter(Boolean)
      .sort((a, b) => b.value - a.value)[0];
  });
  return peaks.flatMap((peak, i) => {
    const other = peaks.filter((value, j) => j !== i && value);
    if (
      !peak ||
      other.length < 2 ||
      peak.value - expectedPeak(other, peak.time) < 2
    ) {
      return [];
    }
    const before = voicedBetween(pitch, words[0].start, words[i].start);
    const after = voicedBetween(pitch, words[i].end, words.at(-1).end);
    return before.length >= 3 &&
      after.length >= 3 &&
      span(after) <= 0.5 * span(before)
      ? [i]
      : [];
  });
}

const TUNES = {
  ',': 'continuation',
  '?': 'yesno',
  '↗ ?': 'yesno',
  '↘ ?': 'wh',
  '↗ |': 'alt-rise',
  '!': 'exclamation',
};
const CHINESE = { ',': '，', '.': '。', '?': '？', '!': '！' };

function mode(words, from, to, notation, fields) {
  const confidence = mean(
    words.slice(from, to).map((word) => word.confidence ?? 1)
  );
  return {
    start: words[from].start,
    end: words[to - 1].end,
    from,
    to,
    notation,
    confidence,
    ...fields,
  };
}

function markedText(words, mark, language, sentenceStart) {
  let text = words
    .map((word, i) => {
      const current = word.language ?? word.lang ?? language;
      const previous = words[i - 1]?.language ?? words[i - 1]?.lang ?? language;
      return `${i && (current !== 'zh' || previous !== 'zh') ? ' ' : ''}${word.text}`;
    })
    .join('');
  if (sentenceStart && ['en', 'ru'].includes(language)) {
    text = text.replace(/\p{L}/u, (letter) => letter.toUpperCase());
  }
  // `↗ |` (an alternative question's rise) is not written.
  const punctuation = mark.endsWith('|') ? '' : (mark.at(-1) ?? '');
  return (
    text +
    (language === 'zh'
      ? (CHINESE[punctuation] ?? '')
      : language === 'hi' && punctuation === '.'
        ? '।'
        : punctuation)
  );
}

function appendPhraseIpa(
  words,
  phrase,
  whisperModes,
  measured,
  { fallback, whisper, energy, otherPitch },
  { ipa, modes }
) {
  const { from, to } = phrase;
  const part = words.slice(from, to);
  const language = phraseLanguage(part, fallback);
  const mark = whisper
    ? whisperedMark(part, phrase, language)
    : phraseMark(part, phrase, language, measured, energy, otherPitch);
  const emphasized = new Set(
    whisper ? [] : emphasisOf(part, language, measured.pitch)
  );
  part.forEach((word, i) => {
    const at = from + i;
    if (whisperModes.some(({ from }) => from === at)) {
      ipa.push('{W');
    }
    ipa.push(emphasized.has(i) ? emphasizedIpa(word.ipa) : word.ipa);
    if (whisperModes.some(({ to }) => to === at + 1)) {
      ipa.push('W}');
    }
    if (emphasized.has(i)) {
      modes.push(mode(words, at, at + 1, 'ˈˈ', { emphasis: 1 }));
    }
  });
  if (mark) {
    ipa.push(mark);
  }
  if (Object.hasOwn(TUNES, mark)) {
    const tune = whisper && hasWh(part, language) ? 'wh' : TUNES[mark];
    modes.push(mode(words, from, to, mark, { tune }));
  }
  return { part, language, mark };
}

/**
 * The phrase before the last one is 'before' an alternative question when
 * the last opens with the language's conjunction (or, или, या, 还是), as
 * markPhrasing() writes `A ↗ | or B ↘ ?`.
 */
function markAlternative(words, phrases, fallback) {
  const last = phrases.at(-1);
  const first = words[last.from];
  const language = first.language ?? first.lang ?? fallback;
  if (
    phrases.length > 1 &&
    first.text.toLowerCase() === ALTERNATIVE_CONJUNCTIONS[language] &&
    last.to - last.from > 1
  ) {
    phrases.at(-2).alternative = 'before';
  }
}

/** Restore IPA and text marks from a measured, word-aligned recording. */
export function markProsody(result, measured, options = {}) {
  const modes = [...(result.modes ?? [])];
  if (!result.words.length) {
    return { ...result, words: [], modes };
  }
  const nuclei = measured.sounds.filter(
    (sound) => sound.prominence !== undefined
  );
  const fallback = options.language ?? 'en';
  const words = result.words.map((word) =>
    word.unknown
      ? markUnknown(word, nuclei, word.language ?? word.lang ?? fallback)
      : word
  );
  const priorWhisper = modes.filter(({ notation }) => notation === 'W');
  const spans = measured.whisperSpans ?? options.whisperSpans ?? priorWhisper;
  const whisperModes = whisperModeSpans(words, spans);
  if (!priorWhisper.length) {
    modes.push(...whisperModes);
  }
  const whispered = words.map(({ start, end }) =>
    whisperAt(spans, (start + end) / 2)
  );
  const phrases = phraseRanges(words, measured.sounds, whispered);
  const energy = mean(measured.pitch.energy);
  const ipa = [];
  const text = [];
  let sentenceStart = true;
  let previousLanguage;
  markAlternative(words, phrases, fallback);
  for (const [index, phrase] of phrases.entries()) {
    const { from, to } = phrase;
    const otherPitch =
      phrases.length > 1
        ? [
            ...voicedBetween(measured.pitch, words[0].start, words[from].start),
            ...voicedBetween(
              measured.pitch,
              words[to - 1].end,
              words.at(-1).end
            ),
          ]
        : [];
    const { part, language, mark } = appendPhraseIpa(
      words,
      phrase,
      whisperModes,
      measured,
      { fallback, whisper: whispered[from], energy, otherPitch },
      { ipa, modes }
    );
    const separator =
      text.length && (language !== 'zh' || previousLanguage !== 'zh')
        ? ' '
        : '';
    text.push(`${separator}${markedText(part, mark, language, sentenceStart)}`);
    sentenceStart = ['.', '!', '?'].includes(mark.at(-1));
    if (mark === '↗ |' && phrases[index + 1]) {
      phrases[index + 1].alternative = 'last';
    }
    previousLanguage = language;
  }
  return { ...result, words, modes, text: text.join(''), ipa: ipa.join(' ') };
}
