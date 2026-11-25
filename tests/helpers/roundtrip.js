/** Metrics for the simulator's text-to-audio-to-text benchmark. Unlicense. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { URL } from 'node:url';
import {
  errorRate,
  levelForTier,
  recognize as recognizeAudio,
  synthesize,
  textToIpa,
  tokenize,
} from '../../src/index.js';
import { modeLabels } from '../../src/ipa/marks.js';
import { alignEdits } from '../../src/metrics/text.js';

export const sentences = JSON.parse(
  readFileSync(
    new URL('../fixtures/roundtrip/sentences.json', import.meta.url),
    'utf8'
  )
);

export function sentenceMark(text) {
  const last = text.match(/[.?!।。？！]/gu)?.at(-1);
  const marks = { '।': '.', '。': '.', '？': '?', '！': '!' };
  return marks[last] ?? last ?? null;
}

function soundTokens(text, lang) {
  const source = text.normalize('NFC');
  const { words } = textToIpa(source, { lang });
  if (lang !== 'zh') {
    return words.map(({ ipa }) => ipa);
  }
  // Use full-text pronunciations for Han characters, including tone sandhi
  // across word boundaries. Count unread or foreign characters individually.
  const contextual = new Map();
  for (const { ipa, sourceStart, original } of words) {
    const syllables = ipa.split(/\s+/u);
    const characters = [...original.matchAll(/\p{Script=Han}/gu)];
    if (characters.length === syllables.length) {
      characters.forEach(({ index }, i) => {
        contextual.set(sourceStart + index, syllables[i]);
      });
    }
  }
  return Array.from(source.matchAll(/[^\s\p{P}\p{S}]/gu), (match) => {
    const [character] = match;
    return (
      contextual.get(match.index) ??
      textToIpa(character, { lang }).words[0]?.ipa ??
      character.toLowerCase()
    );
  });
}

function tone({ ipa }) {
  return ipa.match(/[˥˦˧˨˩]/gu)?.join('') ?? '';
}

function compareStress(reference, hypothesis) {
  const phones = (words) =>
    words.map(({ ipa }) => tokenize(ipa, 'phone').join(' '));
  let hits = 0;
  let count = 0;
  const { pairs } = alignEdits(phones(reference), phones(hypothesis));
  for (const [ref, hyp] of pairs) {
    const expected = reference[ref].syllables;
    const actual = hypothesis[hyp].syllables;
    if (expected.length >= 2 && expected.length === actual.length) {
      count++;
      const primary = expected.findIndex(({ stress }) => stress === 1);
      hits += Number(primary >= 0 && actual[primary].stress === 1);
    }
  }
  return { hits, count, rate: count ? hits / count : null };
}

function compareTimes(reference, hypothesis) {
  const { pairs } = alignEdits(
    reference.map(({ ipa }) => ipa),
    hypothesis.map(({ ipa }) => ipa)
  );
  const errors = [];
  for (const [ref, hyp] of pairs) {
    if (reference[ref].ipa === hypothesis[hyp].ipa) {
      errors.push(
        1000 * Math.abs(reference[ref].start - hypothesis[hyp].start),
        1000 * Math.abs(reference[ref].end - hypothesis[hyp].end)
      );
    }
  }
  const total = errors.reduce((sum, error) => sum + error, 0);
  return { errors, total, mean: errors.length ? total / errors.length : null };
}

const overlap = (a, b) => Math.min(a.end, b.end) - Math.max(a.start, b.start);

function compareModes(expected, actual, label) {
  return expected.map(({ start, end }) => ({
    start,
    end,
    label,
    matched: actual.some(
      (span) =>
        span.notation === label &&
        overlap(span, { start, end }) >= (end - start) / 2
    ),
  }));
}

/** The recognizer's own threshold for a heard arousal (classifyEmotion). */
export const AROUSAL_RISE = 0.3;
const EFFORT_NOTATIONS = new Set(['pp', 'p', 'f', 'ff']);

/** Duration-weighted heard arousal over a span; unmarked time counts 0. */
function heardArousal(actual, span) {
  let total = 0;
  for (const heard of actual) {
    const shared = overlap(heard, span);
    if (shared > 0 && Number.isFinite(heard.emotion?.arousal)) {
      total += heard.emotion.arousal * shared;
    }
  }
  return total / (span.end - span.start);
}

/**
 * Score a relative effort event (issue 168): the same voice speaks a neutral
 * span and then the planned span. Without a voice baseline the recognizer
 * places no constant effort label, so the event counts when the heard
 * arousal of the planned span rises by at least AROUSAL_RISE over the
 * neutral span before it, or when a span with the expected label covers half
 * of it.
 */
function compareRelative(expected, actual, label, utteranceStart) {
  return expected.map(({ start, end }) => {
    const neutral = { start: utteranceStart, end: start };
    assert.ok(neutral.end > neutral.start, `no neutral span before ${label}`);
    const rise =
      heardArousal(actual, { start, end }) - heardArousal(actual, neutral);
    return {
      start,
      end,
      label,
      neutral,
      rise,
      matched:
        rise >= AROUSAL_RISE ||
        compareModes([{ start, end }], actual, label)[0].matched,
    };
  });
}

/**
 * The negative control: a planned constant effort that the audio-only
 * recognizer must not report, since it has no neutral baseline of the voice
 * (issue 71). A span passes when no heard effort label overlaps it.
 */
function compareAbsent(expected, actual, label) {
  return expected.map(({ start, end }) => {
    const unexpected = actual.filter(
      (span) =>
        EFFORT_NOTATIONS.has(span.notation) && overlap(span, { start, end }) > 0
    );
    return {
      start,
      end,
      label,
      unexpected: unexpected.map((span) => span.notation),
      matched: !unexpected.length,
    };
  });
}

const modeScorers = {
  overlap: compareModes,
  relative: compareRelative,
  absent: compareAbsent,
};

/** Score the planned spans; the lane of the mode report (issue 168) is
 * 'calibrated' when the recognizer heard the voice, else 'audio-only'. */
function scoreModes(planned, heard, spoken, { mode, modeScoring, knownVoice }) {
  const lane = knownVoice ? 'calibrated' : 'audio-only';
  return modeScorers[modeScoring](
    planned,
    heard.modes ?? [],
    mode,
    spoken.timeline.words[0]?.start ?? 0
  ).map((span) => ({ ...span, lane, scoring: modeScoring }));
}

export function roundTrip(text, options) {
  const {
    lang,
    tier,
    preset,
    seed,
    mode,
    referenceText = text,
    recognize = recognizeAudio,
    // Pass the speaking voice, so effort is measured against its rendered
    // baseline (issue 71); without it a constant effort is never reported.
    knownVoice = false,
    // How the planned `mode` spans are scored: 'overlap' (a heard span with
    // the label covers half of each), 'relative' (a heard rise over the
    // neutral speech before it) or 'absent' (no heard effort label).
    modeScoring = 'overlap',
  } = options;
  assert.ok(modeScorers[modeScoring], `unknown mode scoring ${modeScoring}`);
  // Experiments may pass a cached render of the same text and options.
  const spoken =
    options.spoken ??
    synthesize(text, {
      lang,
      tier,
      head: 'random',
      preset,
      seed,
      markup: Boolean(mode),
    });
  const plannedModes = mode
    ? spoken.plan.modes.filter(
        (span) => span.end > span.start && modeLabels(span).includes(mode)
      )
    : null;
  if (plannedModes) {
    assert.ok(plannedModes.length, `no planned ${mode} span`);
  }
  const level = levelForTier(tier);
  const start = performance.now();
  const heard = recognize(spoken.samples, spoken.sampleRate, {
    level,
    ...(knownVoice && { voice: spoken.head }),
  });
  const seconds = (performance.now() - start) / 1000;
  const referenceWords = spoken.timeline.words;
  const syllables = (words) => words.flatMap((word) => word.syllables);
  const reference = syllables(referenceWords);
  const hypothesis = syllables(heard.words);
  const languages = [...heard.languages].sort((a, b) => b.share - a.share);

  return {
    spoken,
    heard,
    seconds,
    per: errorRate(spoken.ipa, heard.ipa, 'phone'),
    ...(lang !== 'zh' && { wer: errorRate(referenceText, heard.text, 'word') }),
    cer: errorRate(referenceText, heard.text, 'char'),
    soundWer: errorRate(
      soundTokens(referenceText, lang),
      soundTokens(heard.text, lang)
    ),
    ...(lang === 'zh' && {
      toneErrors: errorRate(reference.map(tone), hypothesis.map(tone)),
    }),
    ...(['en', 'ru'].includes(lang) && {
      stressHits: compareStress(referenceWords, heard.words),
    }),
    timeErrors: compareTimes(reference, hypothesis),
    languageRight: languages[0]?.language === lang,
    sentenceMark: sentenceMark(heard.text),
    ...(plannedModes && {
      modeSpans: scoreModes(plannedModes, heard, spoken, {
        mode,
        modeScoring,
        knownVoice,
      }),
    }),
  };
}
