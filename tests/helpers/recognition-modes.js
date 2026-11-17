/** Small deterministic fixtures shared by acceptance tests. Unlicense. */
import {
  synthesize,
  prepareUtterance,
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
  if (!label) {
    return synthesize(text, options);
  }
  // Only the neutral transcription is needed to wrap a labelled fixture.
  // Every labelled recording still gets a fresh physical render.
  const { ipa } = prepareUtterance(text, options);
  return synthesize(`{${label} ${ipa} ${label}}`, { ...options, ipa: true });
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
