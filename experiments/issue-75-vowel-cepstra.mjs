/** Compare sustained vowel windows with waveguide references. Unlicense. */
import {
  analyzeFrames,
  planUtterance,
  presetHeadConfig,
  renderPlan,
  trackPitch,
} from '../src/index.js';
import { sampleState } from '../src/articulation/tract-shape.js';
import { VOWELS } from '../src/ipa/inventory.js';
import { mfcc } from '../src/metrics/spectrum.js';
import { steadyPlan } from '../src/recognition/codebook-features.js';
import { textToIpa } from '../src/g2p/index.js';
import { sentences } from '../tests/helpers/roundtrip.js';

const vowels = Object.keys(VOWELS);
const spectral = { window: 0.025, hop: 0.005, coefficients: 12 };
const steady = process.argv.includes('--steady');
const pitchScales = steady
  ? [0.8, 1, 1.25]
  : [0.7, 0.8, 0.9, 1, 1.12, 1.25, 1.4];
const sampleRate = process.argv.includes('--telephone') ? 8000 : 16000;
const render = {
  engine: 'js',
  solver: 'waveguide',
  sampleRate,
  ...(sampleRate === 8000 && { sections: 12, bandLimit: 3400 }),
};

function spectrumAt(samples, time) {
  const first = Math.round((time - 0.04) * sampleRate);
  const last = Math.round((time + 0.04) * sampleRate);
  const frames = mfcc(samples.subarray(first, last), sampleRate, spectral);
  return frames[0].map(
    (_, i) => frames.reduce((sum, row) => sum + row[i], 0) / frames.length
  );
}

function distance(left, right) {
  let sum = 0;
  for (let i = 1; i < left.length; i++) {
    sum += (left[i] - right[i]) ** 2;
  }
  return sum / spectral.coefficients;
}

function references(voice) {
  return vowels.flatMap((ipa) =>
    pitchScales.map((scale) => {
      const head = { ...voice, pitch: voice.pitch * scale };
      const plan = planUtterance(ipa, { head, durations: [0.3] });
      const { start, end } = plan.segments.find(({ kind }) => kind === 'vowel');
      const center = (start + end) / 2;
      const state = sampleState(plan, center);
      const target = steady ? steadyPlan(state, 0.12) : plan;
      if (steady) {
        target.channels.f0.fill(state.f0);
      }
      const samples = renderPlan(target, { ...render, head, seed: 1 });
      return {
        ipa,
        pitch: state.f0,
        spectrum: spectrumAt(samples, steady ? 0.08 : center),
        state,
      };
    })
  );
}

function evaluate(voice, models, plan, seed, material) {
  const samples = renderPlan(plan, { ...render, seed });
  const frames = analyzeFrames(samples, sampleRate);
  const pitch = trackPitch(frames);
  const segments = plan.segments.filter(
    ({ kind, token, start, end }) =>
      kind === 'vowel' &&
      (material === 'sustained' ||
        Object.hasOwn(VOWELS, token.symbol.replace('ː', ''))) &&
      0.04 <= (start + end) / 2 &&
      (start + end) / 2 + 0.04 <= samples.length / sampleRate
  );
  for (const weight of [0, 2, 8, 32]) {
    let exact = 0;
    let correct = 0;
    let maxError = 0;
    for (const { start, end, token } of segments) {
      const center = (start + end) / 2;
      const spectrum = spectrumAt(samples, center);
      const f0 = pitch.f0[Math.round(center / frames.hop)] || voice.pitch;
      const ranks = models
        .map((model) => ({
          ...model,
          cost:
            distance(spectrum, model.spectrum) +
            weight * Math.log(f0 / model.pitch) ** 2,
        }))
        .sort((a, b) => a.cost - b.cost);
      const best = ranks[0];
      const truth = sampleState(plan, center);
      exact += Number(best.ipa === token.symbol.replace('ː', ''));
      correct += Number(
        Math.abs(best.state.height - truth.height) <= 0.15 &&
          Math.abs(best.state.backness - truth.backness) <= 0.2
      );
      maxError = Math.max(maxError, best.cost);
    }
    console.log(
      JSON.stringify({
        seed,
        material,
        weight,
        sampleRate,
        correct,
        exact,
        count: segments.length,
        maxError,
      })
    );
  }
}

function sustained(voice, models, sequence, seed) {
  const plan = planUtterance(sequence.map((ipa) => `${ipa}ː`).join(''), {
    head: voice,
    durations: sequence.map((_, i) =>
      seed === 1 ? 0.3 : 0.25 + (i % 4) * 0.03
    ),
  });
  evaluate(voice, models, plan, seed, 'sustained');
}

for (const preset of ['male', 'female']) {
  const voice = presetHeadConfig(preset);
  const models = references(voice);
  console.log(preset);
  sustained(voice, models, vowels, 1);
  sustained(
    voice,
    models,
    vowels.filter((_, i) => i % 2).concat(vowels.filter((_, i) => !(i % 2))),
    19
  );
  if (process.argv.includes('--connected')) {
    for (const [lang, i] of [
      ['en', 17],
      ['ru', 1],
      ['hi', 1],
      ['zh', 1],
    ]) {
      const { ipa } = textToIpa(sentences[lang][i], { lang });
      evaluate(voice, models, planUtterance(ipa, { head: voice }), 1, lang);
    }
  }
}
