/** Issue 75 benchmark. References come from the fixed corpus and planner. */
import assert from 'node:assert/strict';
import { after, it } from 'test-anywhere';
import * as simulator from '../../src/index.js';
import { modeLabels } from '../../src/ipa/marks.js';
import { roundTrip, sentenceMark, sentences } from '../helpers/roundtrip.js';
import { heavyLimit } from './helpers/report.js';
import {
  summarizeRoundTrips,
  writeRoundTripReport,
} from './helpers/roundtrip-report.js';

const telephone = {
  per: 0.1,
  soundWer: 0.2,
  tone: 0.15,
  time: 40,
  language: 0.9,
};
const wideband = {
  per: 0.05,
  soundWer: 0.1,
  tone: 0.1,
  time: 30,
  language: 0.95,
};
const mainGates = {
  telephone,
  narrowband: {
    per: 0.08,
    soundWer: 0.15,
    tone: 0.12,
    time: 35,
    language: 0.92,
  },
  wideband,
  minimal: wideband,
};
const whisperGates = {
  telephone: { per: 0.25, text: 0.35, tone: 0.3 },
  wideband: { per: 0.15, text: 0.25, tone: 0.25 },
  minimal: { per: 0.15, text: 0.25, tone: 0.25 },
};
const mainTiers = Object.keys(mainGates);
const higherTiers = ['low', 'medium', 'high', 'ultra', 'studio'];
const markupAvailable = typeof simulator.parseMarkup === 'function';
const limit = Math.min(heavyLimit(80), 80);
const groups = [];

function modeSpans(spoken, heard, label) {
  return spoken.plan.modes
    .filter((span) => modeLabels(span).includes(label))
    .map(({ start, end }) => ({
      start,
      end,
      label,
      matched: heard.modes.some(
        (span) =>
          span.notation === label &&
          Math.min(end, span.end) - Math.max(start, span.start) >=
            (end - start) / 2
      ),
    }));
}

function measure({ set, lang, tier, preset, index, mode }) {
  const text = sentences[lang][index];
  const input =
    {
      W: `[whisper]${text}[/whisper]`,
      f: `<speak><prosody volume="loud">${text}</prosody></speak>`,
    }[mode] ?? text;
  const { spoken, heard, ...metrics } = roundTrip(input, {
    lang,
    tier,
    preset,
    seed: 1,
    markup: Boolean(mode),
    referenceText: text,
  });
  return {
    ...metrics,
    set,
    lang,
    tier,
    preset,
    sentence: index + 1,
    text,
    heardText: heard.text,
    referenceIpa: spoken.ipa,
    heardIpa: heard.ipa,
    languages: heard.languages,
    sampleRate: spoken.sampleRate,
    duration: spoken.duration,
    markRight: metrics.sentenceMark === sentenceMark(text),
    stressExpected: spoken.timeline.words.filter(
      (word) => word.syllables.length >= 2
    ).length,
    ...(mode && { modeSpans: modeSpans(spoken, heard, mode) }),
  };
}

function threshold(failures, anUpperBound, name, actual, bound) {
  if (
    !Number.isFinite(actual) ||
    (anUpperBound ? actual > bound : actual < bound)
  ) {
    failures.push(
      `${name} ${actual?.toFixed(3) ?? 'unavailable'} (need ${anUpperBound ? '≤' : '≥'} ${bound})`
    );
  }
}

function gateWhisper(tier, lang, stats, atMost) {
  const gates = whisperGates[tier];
  if (!gates) {
    return;
  }
  atMost('PER', stats.per?.rate, gates.per);
  atMost(
    lang === 'zh' ? 'CER' : 'WER',
    (stats.wer ?? stats.cer)?.rate,
    gates.text
  );
  if (lang === 'zh') {
    atMost('tone error', stats.toneErrors?.rate, gates.tone);
  }
}

function gateVoiced({ set, lang, tier, stats }, atMost, atLeast) {
  const gates = set === 'voices' ? telephone : mainGates[tier];
  atMost('PER', stats.per?.rate, gates?.per ?? 0.1);
  if (!gates) {
    return;
  }
  atMost('sound WER', stats.soundWer?.rate, gates.soundWer);
  if (lang === 'zh') {
    atMost('tone error', stats.toneErrors?.rate, gates.tone);
  }
  atMost('mean syllable time error (ms)', stats.meanTime, gates.time);
  atLeast('language match share', stats.language, gates.language);
}

function applyGates(group) {
  const { set, lang, tier, stats, failures } = group;
  const atMost = threshold.bind(null, failures, true);
  const atLeast = threshold.bind(null, failures, false);
  if (set === 'modes') {
    if (tier !== 'narrowband') {
      atLeast(
        'mode match share',
        stats.modes,
        tier === 'telephone' ? 0.75 : 0.9
      );
    }
    return;
  }
  if (set === 'whisper') {
    gateWhisper(tier, lang, stats, atMost);
    return;
  }
  gateVoiced(group, atMost, atLeast);
  if (
    tier !== 'telephone' &&
    stats.stressExpected &&
    (lang === 'en' || lang === 'ru')
  ) {
    atLeast('stress hit share', stats.stress, 0.9);
  }
  if (tier !== 'narrowband') {
    atLeast(
      'sentence mark match share',
      stats.sentenceMark,
      tier === 'telephone' ? 0.85 : 0.9
    );
  }
}

function measureRow(set, lang, tier, presets, indexes, modes = [undefined]) {
  const items = [];
  const failures = [];
  for (const preset of presets) {
    for (const index of indexes.slice(0, limit)) {
      for (const mode of modes) {
        try {
          items.push(measure({ set, lang, tier, preset, index, mode }));
        } catch (error) {
          failures.push(`sentence ${index + 1} (${preset}): ${error.message}`);
        }
      }
    }
  }
  const stats = summarizeRoundTrips(items);
  const group = { set, lang, tier, presets, items, stats, failures };
  groups.push(group);
  applyGates(group);
  assert.equal(failures.length, 0, failures.join('\n'));
}

for (const [lang, texts] of Object.entries(sentences)) {
  const indexes = texts.map((_, index) => index);
  for (const tier of mainTiers) {
    it(`main ${lang} ${tier}`, () =>
      measureRow('main', lang, tier, ['male', 'female'], indexes));
  }
  for (const tier of ['telephone', 'wideband']) {
    for (const preset of ['any', 'child']) {
      it(`voices ${lang} ${tier} ${preset}`, () =>
        measureRow('voices', lang, tier, [preset], indexes.slice(0, 5)));
    }
  }
  for (const tier of higherTiers) {
    it(`tiers ${lang} ${tier}`, () =>
      measureRow('tiers', lang, tier, ['male'], [1, 19]));
  }
}

if (markupAvailable) {
  for (const lang of Object.keys(sentences)) {
    for (const tier of mainTiers) {
      it(`whisper ${lang} ${tier}`, () =>
        measureRow(
          'whisper',
          lang,
          tier,
          ['male', 'female'],
          sentences[lang].slice(0, 10).map((_, index) => index),
          ['W']
        ));
      it(`modes ${lang} ${tier}`, () =>
        measureRow('modes', lang, tier, ['male'], [0], ['W', 'f']));
    }
  }
} else {
  it.skip('whisper and loud round trips require the parseMarkup export', () => {});
}

after(() => writeRoundTripReport(groups, limit, markupAvailable));
