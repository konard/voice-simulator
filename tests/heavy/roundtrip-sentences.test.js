/** Issue 75 benchmark. References come from the fixed corpus and planner. */
import assert from 'node:assert/strict';
import { after, it } from 'test-anywhere';
import * as simulator from '../../src/index.js';
import { roundTrip, sentenceMark, sentences } from '../helpers/roundtrip.js';
import { heavyLimit, writeReport } from './helpers/report.js';
import {
  roundTripReport,
  summarizeRoundTrips,
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
  narrowband: { tone: 0.25 },
  wideband: { per: 0.15, text: 0.25, tone: 0.25 },
  minimal: { per: 0.15, text: 0.25, tone: 0.25 },
};
const mainTiers = Object.keys(mainGates);
const higherTiers = ['low', 'medium', 'high', 'ultra', 'studio'];
const markupAvailable = typeof simulator.parseMarkup === 'function';
const limit = Math.min(heavyLimit(80), 80);
const groups = [];

const loud = (text) => `<prosody volume="loud">${text}</prosody>`;

/**
 * The mode cases (issue 168). Without the voice, the recognizer measures
 * effort against the utterance itself (issue 71), so the audio-only lane
 * scores a neutral span followed by a louder one of the same voice, and a
 * whole loud utterance is its negative control: no effort label may appear.
 * The calibrated lane hears that loud render with its voice; it scores the
 * mode only, so the phone and language round trips stay audio-only.
 */
const modeCases = {
  W: {
    mode: 'W',
    input: (text) => `[whisper]${text}[/whisper]`,
  },
  'f relative': {
    mode: 'f',
    input: (text) => `<speak>${text} ${loud(text)}</speak>`,
    reference: (text) => `${text} ${text}`,
    modeScoring: 'relative',
  },
  'f control': {
    mode: 'f',
    input: (text) => `<speak>${loud(text)}</speak>`,
    modeScoring: 'absent',
  },
  'f calibrated': {
    mode: 'f',
    input: (text) => `<speak>${loud(text)}</speak>`,
    knownVoice: true,
    modeOnly: true,
  },
};

function measure({ set, lang, tier, preset, index, mode, spoken }) {
  const sentence = sentences[lang][index];
  const modeCase = modeCases[mode];
  const text = modeCase?.reference?.(sentence) ?? sentence;
  const {
    spoken: rendered,
    heard,
    ...metrics
  } = roundTrip(modeCase?.input(sentence) ?? sentence, {
    lang,
    tier,
    preset,
    seed: 1,
    mode: modeCase?.mode,
    referenceText: text,
    knownVoice: Boolean(modeCase?.knownVoice),
    modeScoring: modeCase?.modeScoring,
    spoken,
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
    referenceIpa: rendered.ipa,
    heardIpa: heard.ipa,
    languages: heard.languages,
    sampleRate: rendered.sampleRate,
    duration: rendered.duration,
    markRight: metrics.sentenceMark === sentenceMark(text),
    stressExpected: rendered.timeline.words.filter(
      (word) => word.syllables.length >= 2
    ).length,
    ...(mode && { mode }),
    ...(modeCase?.modeOnly && { modeOnly: true }),
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
  if (gates.per !== undefined) {
    atMost('PER', stats.per?.rate, gates.per);
    atMost(
      lang === 'zh' ? 'CER' : 'WER',
      (stats.wer ?? stats.cer)?.rate,
      gates.text
    );
  }
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
    if (lang === 'all' && tier !== 'narrowband') {
      atLeast(
        'mode match share',
        stats.modes,
        tier === 'telephone' ? 0.75 : 0.9
      );
    }
    if (lang === 'all') {
      // The contract of issue 71 holds at every tier: without the voice no
      // constant effort is reported.
      atMost('unexpected audio-only effort spans', stats.unexpectedEffort, 0);
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

function checkModes(tier) {
  for (const lang of Object.keys(sentences)) {
    const whisper = groups
      .find(
        (group) =>
          group.set === 'whisper' && group.lang === lang && group.tier === tier
      )
      ?.items.find((item) => item.preset === 'male' && item.sentence === 1);
    const items = [];
    const failures = [];
    const add = (mode, make) => {
      try {
        items.push(make());
      } catch (error) {
        failures.push(`${mode}: ${error.message}`);
      }
    };
    const options = { set: 'modes', lang, tier, preset: 'male', index: 0 };
    add('W', () =>
      whisper
        ? { ...whisper, set: 'modes' }
        : measure({ ...options, mode: 'W' })
    );
    add('f relative', () => measure({ ...options, mode: 'f relative' }));
    // Both lanes hear the same whole loud render.
    let spoken;
    try {
      spoken = simulator.synthesize(
        modeCases['f control'].input(sentences[lang][0]),
        {
          lang,
          tier,
          head: 'random',
          preset: 'male',
          seed: 1,
          markup: true,
        }
      );
    } catch (error) {
      failures.push(`f: ${error.message}`);
    }
    if (spoken) {
      for (const mode of ['f control', 'f calibrated']) {
        add(mode, () => measure({ ...options, mode, spoken }));
      }
    }
    groups.push({
      set: 'modes',
      lang,
      tier,
      presets: ['male'],
      items,
      stats: summarizeRoundTrips(items),
      failures,
      diagnostic: true,
    });
  }
  const rows = groups.filter(
    (group) => group.set === 'modes' && group.tier === tier
  );
  const items = rows.flatMap((row) => row.items);
  const failures = rows.flatMap((row) =>
    row.failures.map((failure) => `${row.lang} ${failure}`)
  );
  const group = {
    set: 'modes',
    lang: 'all',
    tier,
    presets: ['male'],
    items,
    stats: summarizeRoundTrips(items),
    failures,
    diagnostic: tier === 'narrowband',
  };
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
    }
  }
  for (const tier of [...mainTiers, ...higherTiers]) {
    it(`modes ${tier}`, () => checkModes(tier));
  }
} else {
  it.skip('whisper and loud round trips require the parseMarkup export', () => {});
}

after(() => {
  const { markdown, data } = roundTripReport(groups, limit, markupAvailable);
  writeReport('roundtrip', markdown, data);
});
