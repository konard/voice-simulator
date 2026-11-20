/** Measure lexical Mandarin tone errors with known phone labels and timing. Unlicense. */
import {
  analyzeFrames,
  errorRate,
  ipaToText,
  parseIpa,
  textToIpa,
} from '../src/index.js';
import { syllablesWithWhisper } from '../src/recognition/decode-pipeline.js';
import {
  DECODE_SENTENCES,
  plannedPhones,
} from '../tests/helpers/decoder-material.js';
import { renderWhisper } from './issue-72-whisper-robustness.mjs';

const toneSymbols = new Map([
  ['5', 'a'],
  ['35', 'e'],
  ['214', 'i'],
  ['21', 'i'],
  ['51', 'u'],
]);

function toneStream(words) {
  return words.map((ipa) => {
    const token = parseIpa(ipa).tokens.find(({ tone }) => tone?.length);
    return toneSymbols.get(token?.tone.join('')) ?? 'o';
  });
}

function correctTones(expected, heard) {
  const comparison = errorRate(expected.join(' '), heard.join(' '), 'phone');
  return expected.length - comparison.substitutions - comparison.deletions;
}

const lexical = (input) => ipaToText(input, { language: 'zh' }).words;
const lexicalTones = (words) =>
  toneStream(words.flatMap(({ syllables }) => syllables.map(({ ipa }) => ipa)));
const totals = {
  syllables: 0,
  withoutTones: 0,
  inferredTones: 0,
  referenceTones: 0,
};
for (const text of DECODE_SENTENCES.zh) {
  const { samples, sampleRate, plan } = renderWhisper(
    `[whisper] ${text}`,
    'zh'
  );
  const frames = analyzeFrames(samples, sampleRate);
  const pronunciation = textToIpa(text, { lang: 'zh' });
  const expected = toneStream(
    pronunciation.words.flatMap(({ ipa }) => ipa.split(/\s+/u))
  );
  totals.syllables += expected.length;
  const phones = plannedPhones(plan).map(({ ipa, start, end }) => {
    const { kind } = parseIpa(ipa).tokens[0];
    return {
      start,
      end,
      kind,
      confidence: 1,
      ipa: ipa.replace(/[˥˦˧˨˩]/gu, ''),
    };
  });
  // Both timed hypotheses receive the reference phone labels and boundaries.
  // Only the second receives the acoustic whisper tone costs.
  const reference = lexical(pronunciation.ipa);
  const bare = lexical(phones);
  syllablesWithWhisper(
    phones,
    'zh',
    [{ start: 0, end: samples.length / sampleRate }],
    frames
  );
  const inferred = lexical(phones);
  totals.withoutTones += correctTones(expected, lexicalTones(bare));
  totals.inferredTones += correctTones(expected, lexicalTones(inferred));
  totals.referenceTones += correctTones(expected, lexicalTones(reference));
  console.log({
    text,
    expected,
    withoutTones: lexicalTones(bare),
    inferredTones: lexicalTones(inferred),
  });
}
console.log(totals);
