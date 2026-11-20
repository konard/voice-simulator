/** Measure candidate coverage and rank true phones at their planned times. Unlicense. */
import {
  parseIpa,
  planUtterance,
  renderPlan,
  sampleState,
} from '../src/index.js';
import { VOWELS } from '../src/ipa/inventory.js';
import {
  analyzeForDecode,
  decoderSettings,
  prepareIpaDecode,
} from '../src/recognition/decode-pipeline.js';
import {
  decoderUnit,
  TEMPLATE_CHANNELS,
} from '../src/recognition/decode-model.js';
import { createSpanScorer } from '../src/recognition/decode-spans.js';
import {
  DECODE_SENTENCES,
  DECODER_VOICES,
  plannedPhones,
  renderDecoderText,
} from '../tests/helpers/decoder-material.js';

const rate = 16000;

function plannedTrack(track, plan) {
  const channels = Object.fromEntries(
    TEMPLATE_CHANNELS.map((name) => [name, new Float32Array(track.frameCount)])
  );
  const variance = Object.fromEntries(
    TEMPLATE_CHANNELS.map((name) => [name, new Float32Array(track.frameCount)])
  );
  for (let frame = 0; frame < track.frameCount; frame++) {
    const state = sampleState(plan, track.startTime + frame / track.frameRate);
    for (const name of TEMPLATE_CHANNELS) {
      channels[name][frame] = state[name];
    }
  }
  return { ...track, channels, variance };
}

function rankPhones(terms, weights) {
  return Array.from({ length: terms.length / 3 }, (_, i) => ({
    i,
    cost:
      terms[i * 3] +
      weights.duration * terms[i * 3 + 1] +
      weights.class * terms[i * 3 + 2],
  })).sort((a, b) => a.cost - b.cost);
}

function oracle(input, options, vowelsOnly) {
  const settings = decoderSettings(rate, options);
  const analysis = analyzeForDecode(input.samples, rate, options, settings);
  const { frames, tracks } = analysis;
  const { templates, prepared } = prepareIpaDecode(analysis, settings);
  const phones = plannedPhones(input.plan);
  const edges = new Set(phones.flatMap(({ start, end }) => [start, end]));
  const alternatives = vowelsOnly
    ? templates.filter(({ kind }) => kind === 'vowel')
    : templates;
  const inverted = createSpanScorer(
    frames,
    tracks.landmarks,
    tracks.articulation
  );
  const planned = createSpanScorer(
    frames,
    tracks.landmarks,
    plannedTrack(tracks.articulation, input.plan)
  );
  const withoutClass = { ...settings.weights, class: 0 };
  const ranks = [];
  for (const { ipa, start, end } of phones) {
    const ref = decoderUnit(parseIpa(ipa).tokens[0]);
    if (!alternatives.some(({ ipa }) => ipa === ref)) {
      continue;
    }
    const observed = inverted(start, end, alternatives).terms;
    const targets = planned(start, end, alternatives).terms;
    const rank = (terms, weights) =>
      rankPhones(terms, weights).findIndex(
        ({ i }) => alternatives[i].ipa === ref
      ) + 1;
    ranks.push({
      observed: rank(observed, settings.weights),
      observedWithoutClass: rank(observed, withoutClass),
      targets: rank(targets, settings.weights),
      targetsWithoutClass: rank(targets, withoutClass),
    });
  }
  return {
    edges: edges.size,
    matched: [...edges].filter((time) =>
      prepared.times.some((candidate) => Math.abs(time - candidate) <= 0.02)
    ).length,
    phones: phones.length,
    present: ranks.length,
    invertedFirst: ranks.filter(({ observed }) => observed === 1).length,
    invertedFive: ranks.filter(({ observed }) => observed <= 5).length,
    invertedFirstWithoutClass: ranks.filter(
      ({ observedWithoutClass }) => observedWithoutClass === 1
    ).length,
    plannedFirst: ranks.filter(({ targets }) => targets === 1).length,
    plannedFirstWithoutClass: ranks.filter(
      ({ targetsWithoutClass }) => targetsWithoutClass === 1
    ).length,
    plannedFiveWithoutClass: ranks.filter(
      ({ targetsWithoutClass }) => targetsWithoutClass <= 5
    ).length,
  };
}

function summary(items) {
  return Object.fromEntries(
    Object.keys(items[0]).map((key) => [
      key,
      items.reduce((sum, item) => sum + item[key], 0),
    ])
  );
}

for (const [name, voice] of Object.entries(DECODER_VOICES)) {
  const vowels = Object.keys(VOWELS).map((vowel) => {
    const plan = planUtterance(vowel, { head: voice, durations: [0.3] });
    const samples = renderPlan(plan, {
      sampleRate: rate,
      solver: 'waveguide',
      engine: 'js',
      seed: 1,
    });
    return oracle({ plan, samples }, { voice }, true);
  });
  console.log(name, 'exact-duration isolated vowels', summary(vowels));
  const sentences = Object.entries(DECODE_SENTENCES).flatMap(
    ([language, text]) =>
      text.map((sentence) =>
        oracle(
          renderDecoderText(sentence, voice, rate, language),
          { voice, language },
          false
        )
      )
  );
  console.log(name, 'held-out sentences', summary(sentences));
}
