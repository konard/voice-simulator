/** Physics-only neutral and emotion references; bounded LRU by voice/rate/lang.
 * Unlicense. Texts are mirrored in tests/fixtures/recognition/baseline.txt. */
import { synthesize } from '../synthesize.js';
import { loadVoice } from '../voice-file.js';
import { presetHeadConfig, normalizeHeadConfig } from '../head-config.js';
import {
  measureWords,
  relativeF1,
  phraseSummary,
  vowelReferences,
} from './mode-features.js';
import { emotionVector } from './mode-rules.js';
import { EMOTIONS } from '../articulation/emotion.js';
import { AUDIO_TIERS } from '../perf/lod.js';
import { lexiconRevision } from '../g2p/lexicon.js';

export const BASELINE_TEXT = Object.freeze({
  en: 'The train leaves at seven.',
  ru: 'Мама мыла раму.',
  hi: 'नमस्ते दुनिया।',
  zh: '你好世界。',
});
const cache = new Map();
const contexts = new Map();
let readPreparedBaseline;

export function installPreparedModeBaselines(read) {
  readPreparedBaseline = read;
  cache.clear();
}

export function baselineHead(voice) {
  if (
    typeof voice === 'string' &&
    !voice.startsWith('{') &&
    !voice.includes('=')
  ) {
    return presetHeadConfig(voice);
  }
  return normalizeHeadConfig(voice.head ?? loadVoice(voice).head);
}
export function modeBaselineKey(head, tier, language) {
  return JSON.stringify([
    Object.keys(head)
      .sort()
      .map((k) => [k, head[k]]),
    tier,
    language,
  ]);
}

export function voiceBaseline(voice, sampleRate, language, trace) {
  const head = baselineHead(voice);
  const lang = Object.hasOwn(BASELINE_TEXT, language) ? language : 'en';
  // Several 48 kHz tiers share a rate. Use the cheapest matching physical
  // solver, avoiding an FDTD render for every cached reference.
  const tier =
    AUDIO_TIERS.find(
      (entry) => entry.solver === 'waveguide' && entry.sampleRate >= sampleRate
    )?.name ?? 'medium';
  const signature = modeBaselineKey(head, tier, lang);
  const revision = lexiconRevision();
  const key = `${revision}:${signature}`;
  if (cache.has(key)) {
    const value = cache.get(key);
    cache.delete(key);
    cache.set(key, value);
    trace?.({ stage: 'baseline', cached: true, language: lang, tier });
    return value;
  }
  const options = { head, lang, tier, seed: 1, engine: 'js' };
  const prepared = revision === 0 ? readPreparedBaseline?.(signature) : null;
  const { ipa, features, vowels } =
    prepared ?? renderNeutralReference(head, lang, options);
  const value = {
    head,
    ipa,
    features,
    vowels,
    references: null,
    physical: null,
    prepared,
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

function renderNeutralReference(head, lang, options) {
  const neutral = synthesize(BASELINE_TEXT[lang], options);
  const words = measureWords(
    neutral.samples,
    neutral.sampleRate,
    { words: neutral.timeline.words },
    head
  );
  return {
    ipa: neutral.ipa,
    features: phraseSummary(words),
    vowels: vowelReferences(words),
  };
}

export function emotionReferences(baseline, trace) {
  if (baseline.references) {
    return baseline.references;
  }
  baseline.references =
    baseline.prepared?.references ?? renderEmotions(baseline);
  trace?.({ stage: 'emotion-references', references: baseline.references });
  return baseline.references;
}

function renderEmotions(baseline) {
  return Object.keys(EMOTIONS).map((name) => {
    const rendered = synthesize(
      `[${name}]${BASELINE_TEXT[baseline.language]}[/${name}]`,
      { ...baseline.options, markup: true }
    );
    return { name, vector: referenceVector(baseline, rendered) };
  });
}

function referenceVector(baseline, rendered) {
  const words = measureWords(
    rendered.samples,
    rendered.sampleRate,
    { words: rendered.timeline.words },
    baseline.head
  );
  words.forEach((w) => {
    w.f1 = relativeF1(w, baseline.vowels);
  });
  return emotionVector(phraseSummary(words), baseline.features);
}

/** A physical mode can explain prosody without an emotion. These competing
 * hypotheses prevent e.g. creak alone from commanding a disgusted preset
 * (which would also slow the replay). They never emit an emotion name. */
export function physicalReferences(baseline) {
  baseline.physical ??= baseline.prepared?.physical ?? renderPhysical(baseline);
  return baseline.physical;
}

function renderPhysical(baseline) {
  return [
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
  ].map((label) => ({
    name: 'neutral',
    vector: referenceVector(
      baseline,
      synthesize(`{${label} ${baseline.ipa} ${label}}`, {
        ...baseline.options,
        ipa: true,
      })
    ),
  }));
}

/** A neutral rendering of the known phones removes vowel identity, lexical
 * stress and lexical tone from the comparison. Only the input phones (and,
 * through `ipa`, the recognised phrase marks and tune) are used; neither
 * observed durations nor synthesis mode metadata are copied.
 * Bounded separately so a long-running transcriber cannot retain audio. */
export function neutralContext(
  baseline,
  words,
  ipa = `${words.map((w) => w.ipa).join(' ')} .`
) {
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
