/** Bound phone scoring with timed renders and unknown phrase endings. Unlicense. */
import assert from 'node:assert/strict';
import { renderPlan } from '../src/acoustics/voice.js';
import { accentSettings } from '../src/accent/index.js';
import { planUtterance } from '../src/articulation/plan.js';
import { randomHeadConfig } from '../src/head-config.js';
import { mfcc } from '../src/metrics/spectrum.js';
import { prepareUtterance } from '../src/synthesize.js';

const phrases = {
  en: 'ˈmɑtə ˈkatu.',
  ru: 'ˈnatə ˈkatʊ.',
  hi: 'ˈbaːt̪ə ˈkatu.',
  zh: 'wa˥ ta˧˥ ku˥˩.',
};
const onsets = ['m', 'n', 'l', 'w', 'j', 'b', 'd'];
const cepstrum = { window: 0.02, hop: 0.005, coefficients: 12 };
const conditions = {
  control: {},
  question: { ending: '?' },
  vowel: { vowel: 'i' },
  head: { seed: 2 },
  timing: { offset: 0.01 },
  combined: { ending: '?', vowel: 'i', seed: 2, offset: 0.01 },
};

function onsetFeatures(samples, sampleRate, { start, end }) {
  const onset = samples.subarray(
    Math.round(start * sampleRate),
    Math.round(start * sampleRate) + Math.round((end - start) * sampleRate)
  );
  return { onset, cepstra: mfcc(onset, sampleRate, cepstrum) };
}

function losses(reference, candidate) {
  let dot = 0;
  let refEnergy = 0;
  let candidateEnergy = 0;
  for (const [index, sample] of reference.onset.entries()) {
    const other = candidate.onset[index];
    dot += sample * other;
    refEnergy += sample ** 2;
    candidateEnergy += other ** 2;
  }
  const cepstral = reference.cepstra.reduce(
    (sum, row, i) =>
      row
        .slice(1)
        .reduce(
          (total, value, j) =>
            total + (value - candidate.cepstra[i][j + 1]) ** 2,
          sum
        ),
    0
  );
  return {
    waveform: 1 - dot / Math.sqrt(refEnergy * candidateEnergy),
    cepstral,
  };
}

function checkOnset(
  ipa,
  lang,
  tier,
  preset,
  { ending = '.', vowel, seed = 1, offset = 0 }
) {
  const head = randomHeadConfig(1, { preset });
  const { plan, renderOptions } = prepareUtterance(ipa, {
    ipa: true,
    lang,
    tier,
    head,
    engine: 'js',
  });
  const durations = plan.tokens.map((token) =>
    plan.segments.reduce(
      (sum, segment) => sum + (segment.token === token ? segment.duration : 0),
      0
    )
  );
  const onset = plan.segments.find(({ token }) => token?.phoneme);
  const span = {
    start: onset.start,
    end: plan.segments.findLast(({ token }) => token === onset.token).end,
  };
  const { sampleRate } = renderOptions;
  const reference = onsetFeatures(
    renderPlan(plan, renderOptions),
    sampleRate,
    span
  );
  const candidateHead = randomHeadConfig(seed, { preset });
  const accent = accentSettings(lang);
  const candidateOptions = prepareUtterance(ipa, {
    ipa: true,
    lang,
    tier,
    head: candidateHead,
    engine: 'js',
  }).renderOptions;
  const plannedVowel = plan.tokens.find(({ kind }) => kind === 'vowel');
  const candidateIpa = vowel
    ? ipa.replace(
        `${onset.token.symbol}${plannedVowel.symbol}`,
        `${onset.token.symbol}${vowel}`
      )
    : ipa;
  assert.ok(!vowel || candidateIpa !== ipa);
  const ranks = onsets.map((phone) => {
    const candidate = planUtterance(
      candidateIpa.replace(onset.token.symbol, phone).replace(/\.$/, ending),
      {
        head: candidateHead,
        language: lang,
        accent,
        durations,
      }
    );
    const features = onsetFeatures(
      renderPlan(candidate, candidateOptions),
      sampleRate,
      { start: span.start + offset, end: span.end + offset }
    );
    return { phone, ...losses(reference, features) };
  });
  return Object.fromEntries(
    ['waveform', 'cepstral'].map((score) => {
      const sorted = ranks.slice().sort((a, b) => a[score] - b[score]);
      const rank =
        sorted.findIndex(({ phone }) => phone === onset.token.symbol) + 1;
      assert.ok(rank && sorted.every((item) => Number.isFinite(item[score])));
      return [score, rank];
    })
  );
}

for (const tier of ['telephone', 'wideband']) {
  for (const [condition, options] of Object.entries(conditions)) {
    const ranks = [];
    for (const [lang, ipa] of Object.entries(phrases)) {
      for (const preset of ['male', 'female']) {
        ranks.push({
          lang,
          preset,
          ...checkOnset(ipa, lang, tier, preset, options),
        });
      }
    }
    console.log(JSON.stringify({ tier, condition, ranks }));
  }
}
