/** Recognize manner of speech after the text step (issue 71). Unlicense. */
import { parseIpa, formatIpa } from '../ipa/parse.js';
import { createMode, composeMode, MODE_FIELDS } from '../markup/modes.js';
import {
  classifyWord,
  classifyEmotion,
  emotionVector,
  estimateEffort,
  semitones,
} from './mode-rules.js';
import {
  measureWords,
  summarize,
  relativeF1,
  quantile,
} from './mode-features.js';
import {
  voiceBaseline,
  emotionReferences,
  neutralContext,
} from './mode-baseline.js';
import {
  phrases,
  wordSpans,
  effortRamps,
  removePresetEffects,
} from './mode-spans.js';
import { recognizeSounds } from './mode-sounds.js';

/** Partial fields only: metadata never leaks into the synthesis plan. */
export function toPlanModes(modes) {
  const words = modes.filter((span) => !span.sound);
  const boundaries = [...new Set(words.flatMap((s) => [s.from, s.to]))].sort(
    (a, b) => a - b
  );
  const result = [];
  for (let i = 1; i < boundaries.length; i++) {
    const from = boundaries[i - 1],
      to = boundaries[i];
    const selected = words.filter((s) => s.from <= from && s.to >= to);
    if (!selected.length) {
      continue;
    }
    const mode = {};
    for (const span of selected) {
      for (const key of MODE_FIELDS) {
        if (Object.hasOwn(span, key)) {
          mode[key] =
            typeof span[key] === 'object' && span[key] !== null
              ? { ...mode[key], ...span[key] }
              : span[key];
          if (key === 'effort' && span.effortEnd === undefined) {
            mode.effortEnd = span.effort;
          }
        }
      }
    }
    result.push({ from, to, mode });
  }
  return result;
}

// Each input bound is checked before allocating analysis buffers.
// eslint-disable-next-line complexity
function validate(samples, sampleRate, result, options) {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000) {
    throw new RangeError(
      'mode recognition needs a sample rate of at least 8000 Hz'
    );
  }
  if (
    !samples ||
    !Number.isSafeInteger(samples.length) ||
    samples.length / sampleRate > (options.maxSeconds ?? 30)
  ) {
    throw new RangeError('mode recognition exceeds maxSeconds (default 30)');
  }
  for (let i = 0; i < samples.length; i++) {
    if (!Number.isFinite(samples[i])) {
      throw new TypeError('samples must be finite');
    }
  }
  if (!Array.isArray(result?.words)) {
    throw new TypeError('mode recognition needs timed result.words');
  }
  let previous = 0;
  for (const word of result.words) {
    if (
      typeof word.ipa !== 'string' ||
      !Number.isFinite(word.start) ||
      !Number.isFinite(word.end) ||
      word.start < previous ||
      word.end <= word.start ||
      word.end > samples.length / sampleRate + 0.01
    ) {
      throw new TypeError(
        'words need IPA and ordered, nonempty start/end seconds within the recording'
      );
    }
    previous = word.end;
  }
}

function writeIpa(words, spans, sourceIpa) {
  // Recognition words can contain more than one IPA word (normalization).
  const tokens = [];
  words.forEach((word, i) => {
    if (i) {
      tokens.push({ kind: 'pause', symbol: ' ', strength: 0 });
    }
    tokens.push(
      ...parseIpa(word.ipa).tokens.map((t) =>
        t.kind === 'pause' ? t : { ...t, word: i }
      )
    );
  });
  if (sourceIpa) {
    const original = parseIpa(sourceIpa).tokens;
    const count =
      1 +
      Math.max(
        -1,
        ...original
          .filter((t) => t.kind !== 'pause' && t.kind !== 'sound')
          .map((t) => t.word ?? -1)
      );
    if (count === words.length) {
      tokens.splice(0, tokens.length, ...original);
    }
  }
  const labelled = spans.filter((s) => s.notation && !s.sound);
  const ipa = formatIpa(
    tokens,
    toPlanModes(labelled).map((s) => ({
      ...s,
      mode: composeMode(createMode(), s.mode),
    }))
  );
  // Insert sound tokens at their time, retaining mode braces around words.
  // Sound insertion is done on tokens before a second formatting pass.
  if (!spans.some((s) => s.sound)) {
    return ipa;
  }
  const withSounds = [];
  const sounds = spans.filter((s) => s.sound).sort((a, b) => a.start - b.start);
  let next = 0;
  for (const token of tokens) {
    if (token.kind !== 'pause') {
      while (
        next < sounds.length &&
        sounds[next].start < words[token.word].start
      ) {
        withSounds.push({ kind: 'sound', name: sounds[next++].sound });
      }
    }
    withSounds.push(token);
  }
  while (next < sounds.length) {
    withSounds.push({ kind: 'sound', name: sounds[next++].sound });
  }
  return formatIpa(
    withSounds,
    toPlanModes(labelled).map((s) => ({
      ...s,
      mode: composeMode(createMode(), s.mode),
    }))
  );
}

// Joint source and prosody evidence, with each gate visible in one place.
function corroborateLabels(features, base, knownVoice, labels) {
  // With estimated phone timing, a fricative or background noise can occupy
  // the expected vowel. Periodicity elsewhere in the same word contradicts
  // an entirely whispered word; quiet background is not positive evidence.
  labels.forEach((label, i) => {
    const w = features[i];
    if (
      label.quality?.phonation?.whisper === 1 &&
      (w.wordVoiced > 0.05 || w.level < w.peakLevel - 15)
    ) {
      label.quality = null;
    }
    if (
      !knownVoice &&
      label.quality?.phonation?.whisper === 0.5 &&
      w.cpp > base.cpp - 1
    ) {
      label.quality = null;
    }
  });
  // Stable pitch displacement across different vowels provides an
  // independent check on a constant effort. Pool the noisy tilt/F1 cues
  // before quantizing to avoid a vowel-dependent false boundary.
  const vowels = features.filter((w) => w.vowels);
  const pooled = {
    ...summarize(vowels),
    f1: knownVoice ? quantile(vowels.map((w) => w.f1)) : null,
  };
  const displacement = semitones(pooled.pitch, base.pitch);
  const spread =
    quantile(
      vowels.map((w) => w.pitch),
      0.9
    ) -
    quantile(
      vowels.map((w) => w.pitch),
      0.1
    );
  const coherent =
    knownVoice &&
    Math.abs(displacement) >= 3 &&
    spread < pooled.pitch * 0.12 &&
    pooled.jitter < 2 &&
    pooled.voiced > 0.8 &&
    pooled.cpp - base.cpp > -1.5 &&
    pooled.hnr - base.hnr > -4;
  if (coherent) {
    const decision = classifyWord(pooled, base, true);
    const effort = decision.effort;
    for (const label of labels) {
      label.quality =
        effort === 0.5
          ? null
          : {
              notation: ['pp', 'p', null, 'f', 'ff'][effort * 4],
              effort,
              confidence: estimateEffort(pooled, base).confidence,
            };
    }
  }
  labels.forEach((label, i) => {
    label.pitchEffort = (features[i].pitch - base.pitch) / 5;
  });
  return coherent;
}

/** Returns a copy. Audio is the only source of decisions; word IPA/times
 * select vowel frames. No markup, plan modes or reference labels are read. */
// Optional voice, phone alignment, diagnostics and sound paths share this entry point.
// eslint-disable-next-line complexity
export function recognizeModes(samples, sampleRate, result, options = {}) {
  validate(samples, sampleRate, result, options);
  if (options.modes === false) {
    return {
      ...result,
      modes: [...(result.modes ?? [])],
      ipa: result.ipa ?? '',
    };
  }
  samples = samples.subarray ? samples : Float32Array.from(samples);
  if (!result.words.length) {
    const modes = [
      ...(result.modes ?? []),
      ...recognizeSounds(samples, sampleRate, []),
    ];
    return { ...result, modes, ipa: writeIpa([], modes) };
  }
  const language =
    result.language ??
    result.lang ??
    result.words[0].language ??
    result.words[0].lang ??
    'en';
  const reference = options.voice
    ? voiceBaseline(options.voice, sampleRate, language, options.trace)
    : null;
  const features = measureWords(samples, sampleRate, result, reference?.head);
  const base = reference?.features ?? summarize(features);
  features.forEach((w) => {
    w.f1 = reference ? relativeF1(w, reference.vowels) : null;
  });
  const context =
    reference && !result.phonemes && !result.phones
      ? neutralContext(reference, result.words)
      : null;
  if (context) {
    features.forEach((w, i) => {
      const neutral = context[i];
      // Preserve the documented units while cancelling phone/stress effects.
      for (const key of [
        'alpha',
        'energyRatio',
        'h1h2',
        'hnr',
        'cpp',
        'pitchSpan',
      ]) {
        w[key] += base[key] - neutral[key];
      }
      if (w.pitch > 0 && neutral.pitch > 0) {
        w.pitch *= base.pitch / neutral.pitch;
      }
      if (neutral.rate > 0) {
        w.rate *= base.rate / neutral.rate;
      }
      w.f1 = relativeF1(
        w,
        new Map(neutral.f1Vowels.map((v) => [v.vowel, v.value]))
      );
    });
  }
  const labels = features.map((w) => classifyWord(w, base, Boolean(reference)));
  const coherent = corroborateLabels(
    features,
    base,
    Boolean(reference),
    labels
  );
  const groups = phrases(result.words);
  // Fewer than three nuclei: no voice quality, effort or named emotion.
  for (const group of groups) {
    if (
      features.slice(group.from, group.to).reduce((n, w) => n + w.vowels, 0) < 3
    ) {
      for (let i = group.from; i < group.to; i++) {
        labels[i].quality = null;
      }
    }
  }
  const initialSpans = [
    ...wordSpans(result.words, features, labels, 'quality'),
    ...wordSpans(result.words, features, labels, 'tempo'),
  ];
  let spans = reference
    ? effortRamps(result.words, labels, initialSpans)
    : initialSpans;
  const references = reference
    ? emotionReferences(reference, options.trace)
    : [];
  for (const group of groups) {
    const heard = features.slice(group.from, group.to);
    const summary = {
      ...summarize(heard),
      f1: heard.some((w) => w.f1 !== null)
        ? heard.reduce((n, w) => n + (w.f1 ?? 0), 0) / heard.length
        : null,
    };
    const vector = emotionVector(summary, base);
    const simpleEffort =
      coherent &&
      Math.abs(summary.pitchSpan - base.pitchSpan) < 1 &&
      summary.rate / base.rate > 0.8 &&
      summary.rate / base.rate < 1.2;
    const found = classifyEmotion(
      vector,
      heard.reduce((n, w) => n + w.vowels, 0) >= 3 && !simpleEffort
        ? references
        : []
    );
    if (found) {
      const span = {
        ...group,
        start: result.words[group.from].start,
        end: result.words[group.to - 1].end,
        ...found,
      };
      if (span.emotion.name) {
        spans = removePresetEffects(spans, span);
      }
      spans.push(span);
    }
    options.trace?.({ stage: 'phrase', ...group, vector, decision: found });
  }
  spans.push(...recognizeSounds(samples, sampleRate, result.words));
  const modes = [...(result.modes ?? []), ...spans].sort(
    (a, b) => a.start - b.start || b.end - a.end
  );
  options.trace?.({ stage: 'words', baseline: base, features, labels });
  return { ...result, modes, ipa: writeIpa(result.words, modes, result.ipa) };
}
