/** Physics-only neutral and emotion references; bounded LRU by voice/rate/lang.
 * Unlicense. Texts are mirrored in tests/fixtures/recognition/baseline.txt. */
import { synthesize } from '../synthesize.js';
import { loadVoice } from '../voice-file.js';
import { presetHeadConfig } from '../head-config.js';
import {
  measureWords,
  relativeF1,
  summarize,
  vowelReferences,
} from './mode-features.js';
import { emotionVector } from './mode-rules.js';
import { EMOTIONS } from '../articulation/emotion.js';

export const BASELINE_TEXT = Object.freeze({
  en: 'The train leaves at seven.',
  ru: 'Мама мыла раму.',
  hi: 'नमस्ते दुनिया।',
  zh: '你好世界。',
});
const cache = new Map();
const contexts = new Map();

export function baselineHead(voice) {
  if (
    typeof voice === 'string' &&
    !voice.startsWith('{') &&
    !voice.includes('=')
  ) {
    return presetHeadConfig(voice);
  }
  return voice.head ?? loadVoice(voice).head;
}
export function voiceBaseline(voice, sampleRate, language, trace) {
  const head = baselineHead(voice);
  const lang = Object.hasOwn(BASELINE_TEXT, language) ? language : 'en';
  const tier =
    sampleRate <= 8000
      ? 'telephone'
      : sampleRate <= 11025
        ? 'narrowband'
        : sampleRate <= 16000
          ? 'wideband'
          : 'minimal';
  const key = JSON.stringify([
    Object.keys(head)
      .sort()
      .map((k) => [k, head[k]]),
    tier,
    lang,
  ]);
  if (cache.has(key)) {
    const value = cache.get(key);
    cache.delete(key);
    cache.set(key, value);
    trace?.({ stage: 'baseline', cached: true, language: lang, tier });
    return value;
  }
  const options = { head, lang, tier, seed: 1, engine: 'js' };
  const neutral = synthesize(BASELINE_TEXT[lang], options);
  const words = measureWords(
    neutral.samples,
    neutral.sampleRate,
    { words: neutral.timeline.words },
    head
  );
  const features = summarize(words);
  const vowels = vowelReferences(words);
  const value = {
    head,
    features,
    vowels,
    references: null,
    options,
    language: lang,
  };
  cache.set(key, value);
  if (cache.size > 8) {
    cache.delete(cache.keys().next().value);
  }
  trace?.({ stage: 'baseline', cached: false, language: lang, tier, features });
  return value;
}

export function emotionReferences(baseline, trace) {
  if (baseline.references) {
    return baseline.references;
  }
  baseline.references = Object.keys(EMOTIONS).map((name) => {
    const rendered = synthesize(
      `[${name}]${BASELINE_TEXT[baseline.language]}[/${name}]`,
      { ...baseline.options, markup: true }
    );
    const words = measureWords(
      rendered.samples,
      rendered.sampleRate,
      { words: rendered.timeline.words },
      baseline.head
    );
    words.forEach((w) => {
      w.f1 = relativeF1(w, baseline.vowels);
    });
    const features = {
      ...summarize(words),
      f1: words.some((w) => w.f1 !== null)
        ? words.reduce((n, w) => n + (w.f1 ?? 0), 0) / words.length
        : null,
    };
    return { name, vector: emotionVector(features, baseline.features) };
  });
  trace?.({ stage: 'emotion-references', references: baseline.references });
  return baseline.references;
}

/** A neutral rendering of the known phones removes vowel identity, lexical
 * stress and lexical tone from the comparison. Only the input phones are
 * used; neither observed durations nor synthesis mode metadata are copied.
 * Bounded separately so a long-running transcriber cannot retain audio. */
export function neutralContext(baseline, words) {
  const ipa = `${words.map((w) => w.ipa).join(' ')} .`;
  const key = JSON.stringify([baseline.options, ipa]);
  if (contexts.has(key)) {
    return contexts.get(key);
  }
  const audio = synthesize(ipa, { ...baseline.options, ipa: true });
  const features = measureWords(
    audio.samples,
    audio.sampleRate,
    { words: audio.timeline.words },
    baseline.head
  );
  const value = features.length === words.length ? features : null;
  contexts.set(key, value);
  if (contexts.size > 16) {
    contexts.delete(contexts.keys().next().value);
  }
  return value;
}
