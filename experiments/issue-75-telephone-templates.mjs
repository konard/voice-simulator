/** Rank simulated telephone phone templates at known phone boundaries. Unlicense. */
import assert from 'node:assert/strict';
import { errorRate, synthesize } from '../src/index.js';
import { mfcc } from '../src/metrics/spectrum.js';
import {
  decoderLanguage,
  decoderUnit,
} from '../src/recognition/decode-model.js';
import {
  analyzeForDecode,
  decoderSettings,
  prepareIpaDecode,
  segmentsOf,
} from '../src/recognition/decode-pipeline.js';
import { decodeSearch } from '../src/recognition/decode-search.js';
import { sentences } from '../tests/helpers/roundtrip.js';

const render = { tier: 'telephone', head: 'random', preset: 'male', seed: 1 };
const cepstrum = { window: 0.02, hop: 0.005, coefficients: 12 };
const points = [0.15, 0.35, 0.55, 0.75, 0.9];
const contexts = [
  ['ə', 'ə'],
  ['', 'ɑ'],
  ['i', 't'],
];

function phones(plan) {
  const spans = [];
  for (const { token, start, end } of plan.segments) {
    if (!token?.phoneme) {
      continue;
    }
    if (spans.at(-1)?.token === token) {
      spans.at(-1).end = end;
    } else {
      spans.push({ token, start, end });
    }
  }
  return spans;
}

function sample(rows, { start, end }) {
  return points.map((position) => {
    const time = start + position * (end - start);
    const index = Math.round((time - cepstrum.window / 2) / cepstrum.hop);
    return rows[Math.max(0, Math.min(index, rows.length - 1))];
  });
}

function template(ipa, before, after, lang) {
  const spoken = synthesize(`${before}${ipa}${after}.`, {
    ...render,
    ipa: true,
    lang,
  });
  const span = phones(spoken.plan)[Number(Boolean(before))];
  assert.equal(decoderUnit(span.token), ipa);
  return sample(mfcc(spoken.samples, spoken.sampleRate, cepstrum), span);
}

function distance(a, b, includeEnergy) {
  let cost = 0;
  for (let row = 0; row < a.length; row++) {
    cost += includeEnergy * (a[row][0] - b[row][0]) ** 2;
    for (let col = 1; col < a[row].length; col++) {
      cost += (a[row][col] - b[row][col]) ** 2;
    }
  }
  return cost;
}

function measureSearch(spoken, rows, prototypes, language) {
  const { samples, sampleRate, ipa } = spoken;
  const settings = decoderSettings(sampleRate, {
    language,
    beam: 8,
    hop: 0.01,
    whisper: false,
  });
  const analysis = analyzeForDecode(samples, sampleRate, {}, settings);
  const { prepared, templates } = prepareIpaDecode(analysis, settings);
  const { times, spans } = prepared;
  const spectralCosts = spans.map((edges, from) =>
    edges.map(({ to, pause }) => {
      if (pause) {
        return null;
      }
      const actual = sample(rows, { start: times[from], end: times[to] });
      const costs = prototypes.map(({ variants }) =>
        Math.min(...variants.map((variant) => distance(actual, variant, 0.25)))
      );
      return costs.map(
        (cost) => cost / (points.length * cepstrum.coefficients)
      );
    })
  );
  for (const weight of [0, 0.25, 1, 4]) {
    const score = spans.map((edges, from) =>
      edges.map((span, index) =>
        span.pause
          ? span
          : {
              ...span,
              terms: span.terms.map((value, term) =>
                term % 3 === 0
                  ? value + weight * spectralCosts[from][index][term / 3]
                  : value
              ),
            }
      )
    );
    const { paths } = decodeSearch({ times, spans: score }, settings.language, {
      ...settings,
      lattice: false,
    });
    const heard = segmentsOf(paths[0], times, templates, settings.language)
      .map((segment) => segment.ipa)
      .join(' ');
    console.log(
      JSON.stringify({
        lang: language,
        weight,
        ipa,
        heard,
        ...errorRate(ipa, heard, 'phone'),
      })
    );
  }
}

for (const [lang, index] of Object.entries({ en: 17, ru: 1, hi: 1, zh: 1 })) {
  const spoken = synthesize(sentences[lang][index], { ...render, lang });
  const rows = mfcc(spoken.samples, spoken.sampleRate, cepstrum);
  const { symbols } = decoderLanguage({ language: lang });
  const templates = symbols.map((ipa) => ({
    ipa,
    variants: contexts.map(([before, after]) =>
      template(ipa, before, after, lang)
    ),
  }));
  const spans = phones(spoken.plan);
  for (const energy of [0, 0.25, 1]) {
    const ranks = spans.map((span) => {
      const reference = decoderUnit(span.token);
      const sampled = sample(rows, span);
      const candidates = templates.map(({ ipa, variants }) => ({
        ipa,
        cost: Math.min(
          ...variants.map((variant) => distance(sampled, variant, energy))
        ),
      }));
      candidates.sort((a, b) => a.cost - b.cost);
      return candidates.findIndex(({ ipa }) => ipa === reference) + 1;
    });
    console.log(
      JSON.stringify({
        lang,
        energy,
        phones: spans.length,
        first: ranks.filter((rank) => rank === 1).length,
        topThree: ranks.filter((rank) => rank > 0 && rank <= 3).length,
        missing: ranks.filter((rank) => rank === 0).length,
        ranks,
      })
    );
  }
  if (process.argv.includes('--search')) {
    measureSearch(spoken, rows, templates, lang);
  }
}
