/** Small deterministic fixtures shared by acceptance tests. Unlicense. */
import {
  synthesize,
  presetHeadConfig,
  recognizeModes,
} from '../../src/index.js';
import { BASELINE_TEXT } from '../../src/recognition/mode-baseline.js';
export const LANGUAGES = ['en', 'ru', 'hi', 'zh'];
export const LABELS = [
  'pp',
  'p',
  'f',
  'ff',
  'W',
  'V̤',
  'V̰',
  'C',
  'V͈',
  'V͉',
  'F',
  'V!',
  'Ṿ',
  'allegro',
  'lento',
];
export const HEAD = presetHeadConfig('male');
export const VOICE = { head: HEAD };
export function render(lang, label = null, text = BASELINE_TEXT[lang]) {
  const options = {
    lang,
    head: HEAD,
    tier: 'minimal',
    seed: 1,
    engine: 'js',
    markup: true,
  };
  const plain = synthesize(text, options);
  return label
    ? synthesize(`{${label} ${plain.ipa} ${label}}`, { ...options, ipa: true })
    : plain;
}
export function recognize(audio, lang, options = {}) {
  return recognizeModes(
    audio.samples,
    audio.sampleRate,
    {
      ipa: audio.ipa,
      lang,
      words: audio.timeline.words,
    },
    { voice: VOICE, ...options }
  );
}
export function dominant(modes, field = 'quality') {
  const spans = modes.filter((s) =>
    field === 'tempo'
      ? s.rate !== undefined
      : s.effort !== undefined || s.phonation
  );
  const counts = new Map();
  for (const span of spans) {
    counts.set(
      span.notation,
      (counts.get(span.notation) ?? 0) + span.to - span.from
    );
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
