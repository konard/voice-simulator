/** Metrics for the simulator's text-to-audio-to-text benchmark. Unlicense. */
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
import { alignedTokenPairs } from '../../src/metrics/text.js';

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
  const tokens = textToIpa(text, { lang }).words.map(({ ipa }) => ipa);
  // Mandarin G2P emits one space-separated IPA syllable per Han character,
  // including in multi-character words where the context affects pronunciation.
  return lang === 'zh' ? tokens.flatMap((ipa) => ipa.split(/\s+/u)) : tokens;
}

function tone({ ipa }) {
  return ipa.match(/[˥˦˧˨˩]/gu)?.join('') ?? '';
}

function compareStress(reference, hypothesis) {
  const phones = (words) =>
    words.map(({ ipa }) => tokenize(ipa, 'phone').join(' '));
  let hits = 0;
  let count = 0;
  for (const { ref, hyp } of alignedTokenPairs(
    phones(reference),
    phones(hypothesis)
  )) {
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
  const pairs = alignedTokenPairs(
    reference.map(({ ipa }) => ipa),
    hypothesis.map(({ ipa }) => ipa)
  );
  const errors = [];
  for (const { ref, hyp, same } of pairs) {
    if (same) {
      errors.push(
        1000 * Math.abs(reference[ref].start - hypothesis[hyp].start),
        1000 * Math.abs(reference[ref].end - hypothesis[hyp].end)
      );
    }
  }
  const total = errors.reduce((sum, error) => sum + error, 0);
  return { errors, total, mean: errors.length ? total / errors.length : null };
}

export function roundTrip(text, options) {
  const {
    lang,
    tier,
    preset,
    seed,
    markup,
    referenceText = text,
    recognize = recognizeAudio,
  } = options;
  const spoken = synthesize(text, { lang, tier, preset, seed, markup });
  const level = levelForTier(tier);
  const start = performance.now();
  const heard = recognize(spoken.samples, spoken.sampleRate, { level });
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
  };
}
