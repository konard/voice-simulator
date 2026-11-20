/** Held-out decoder material, independent of the weight-tuning sentences. Unlicense. */
import { presetHeadConfig, synthesize } from '../../src/index.js';
import { LANDMARK_SENTENCES } from '../../scripts/landmark-material.mjs';

export const DECODE_SENTENCES = {
  en: [
    LANDMARK_SENTENCES[0][1],
    'The quick brown fox jumps over the lazy dog.',
    'She will bring fresh bread tomorrow.',
    'Please close both of the blue doors.',
  ],
  ru: [
    LANDMARK_SENTENCES[1][1],
    'Дети гуляли в парке.',
    'На улице светит солнце.',
    'В комнате тепло и тихо.',
  ],
  hi: [
    LANDMARK_SENTENCES[2][1],
    'मेरी बहन स्कूल जाती है।',
    'हम हर दिन दूध पीते हैं।',
    'सूरज पूर्व में उगता है।',
  ],
  zh: [
    LANDMARK_SENTENCES[3][1],
    '妈妈在厨房做饭。',
    '她每天早上跑步。',
    '请把门轻轻关上。',
  ],
};

export const DECODER_VOICES = {
  male: presetHeadConfig('male'),
  female: presetHeadConfig('female'),
};

export function renderDecoderText(
  text,
  voice,
  sampleRate,
  language,
  options = {}
) {
  return synthesize(text, {
    head: voice,
    sampleRate,
    language,
    solver: 'waveguide',
    engine: 'js',
    seed: 1,
    ...options,
  });
}

/** Join affricate and release pieces that belong to one planned phone. */
export function plannedPhones(plan) {
  const phones = [];
  let previous;
  for (const segment of plan.segments) {
    const { token, kind } = segment;
    if (
      (kind !== 'vowel' && kind !== 'consonant' && kind !== 'release') ||
      !token
    ) {
      previous = null;
      continue;
    }
    if (token === previous) {
      phones.at(-1).end = segment.end;
    } else {
      phones.push({
        ipa: token.symbol,
        start: segment.start,
        end: segment.end,
      });
    }
    previous = token;
  }
  return phones;
}

export function mean(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}
