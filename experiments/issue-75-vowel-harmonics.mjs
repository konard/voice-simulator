/** Score waveguide vowel candidates at known vowel midpoints. Unlicense. */
import { renderPlan } from '../src/acoustics/voice.js';
import { planUtterance } from '../src/articulation/plan.js';
import { listSymbols, VOWELS } from '../src/ipa/inventory.js';
import { randomHeadConfig } from '../src/head-config.js';
import { AUDIO_TIERS } from '../src/perf/lod.js';
import { codebookSeeds } from '../src/recognition/codebook-seeds.js';
import { steadyPlan } from '../src/recognition/codebook-features.js';
import { createFft } from '../src/recognition/fft.js';
import { analyzeFrames } from '../src/recognition/frontend.js';
import { trackPitch } from '../src/recognition/pitch.js';
import { prepareUtterance, synthesize } from '../src/synthesize.js';
import { sentences } from '../tests/helpers/roundtrip.js';

const fft = createFft(1024);
const low = 300;

// Sampling harmonic peaks from a window suppresses much of the noise between
// harmonics. Remove the mean across the selected frequencies to ignore gain.
function harmonics(samples, rate, time, pitch, bands) {
  const length = Math.round(0.04 * rate);
  const first = Math.round(rate * time - length / 2);
  const real = new Float64Array(fft.size);
  const imag = new Float64Array(fft.size);
  for (let i = 0; i < length; i++) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (length - 1));
    real[i] = window * (samples[first + i] ?? 0);
  }
  fft.forward(real, imag);
  const peaks = bands.map((multiple) => {
    const bin = (multiple * pitch * fft.size) / rate;
    const floor = Math.floor(bin);
    const fraction = bin - floor;
    const power = (i) => real[i] ** 2 + imag[i] ** 2;
    return (
      10 *
      Math.log10(
        1e-10 + (1 - fraction) * power(floor) + fraction * power(floor + 1)
      )
    );
  });
  const mean = peaks.reduce((sum, value) => sum + value, 0) / peaks.length;
  return peaks.map((level) => level - mean);
}

function vowelSegments(plan) {
  return plan.segments.filter(
    ({ kind, token }) =>
      kind === 'vowel' && Object.hasOwn(VOWELS, token.phoneme.symbol)
  );
}

function prepareCases(tier, head, sampleRate) {
  const options = { tier, head, engine: 'js', seed: 1 };
  const symbols = Object.keys(VOWELS);
  const held = prepareUtterance('a', { ...options, ipa: true });
  const plan = planUtterance(symbols.map((vowel) => `${vowel}ː`).join(''), {
    head,
    durations: symbols.map(() => 0.3),
  });
  const steady = {
    plan,
    samples: renderPlan(plan, { ...held.renderOptions, head }),
  };
  return [
    ['sustained', [steady]],
    [
      'running',
      [
        ['en', 6],
        ['ru', 5],
        ['hi', 15],
        ['zh', 13],
      ].map(([lang, index]) =>
        synthesize(sentences[lang][index], { ...options, lang })
      ),
    ],
  ].map(([label, recordings]) => [
    label,
    recordings.map(({ plan, samples }) => {
      const frames = analyzeFrames(samples, sampleRate);
      return { plan, samples, frames, pitch: trackPitch(frames) };
    }),
  ]);
}

function measuredPitch(recording, time, source) {
  const { plan, frames, pitch } = recording;
  const observed = pitch.f0[Math.round(time / frames.hop)];
  return source === 'planned'
    ? plan.channels.f0[Math.round(time * plan.frameRate)]
    : observed;
}

function candidatesFor(head, renderOptions, upper) {
  const { sampleRate } = renderOptions;
  const cache = new Map();
  const symbols = listSymbols();
  const seeds = codebookSeeds().filter(({ kind }) => kind === 'vowel');
  return (f0) => {
    const pitch = 100 * 2 ** (Math.round(48 * Math.log2(f0 / 100)) / 48);
    if (!cache.has(pitch)) {
      const bands = Array.from(
        { length: Math.floor(upper / pitch) },
        (_, i) => i + 1
      ).filter((i) => i * pitch >= low);
      const models = seeds.map(({ state, phone }) => {
        const plan = steadyPlan(state, 0.08);
        plan.channels.f0.fill(pitch);
        const audio = renderPlan(plan, { ...renderOptions, head });
        return {
          vowel: symbols[phone],
          harmonics: harmonics(audio, sampleRate, 0.055, pitch, bands),
        };
      });
      cache.set(pitch, { bands, models });
    }
    return cache.get(pitch);
  };
}

function scoreVowels(samples, rate, time, f0, { bands, models }) {
  const measured = harmonics(samples, rate, time, f0, bands);
  const logHz = bands.map((multiple) => Math.log2(multiple * f0));
  const mean = logHz.reduce((sum, value) => sum + value, 0) / logHz.length;
  const centered = logHz.map((value) => value - mean);
  const spread = centered.reduce((sum, value) => sum + value ** 2, 0);
  return models.map(({ vowel, harmonics: reference }) => {
    const delta = reference.map((level, i) => level - measured[i]);
    const slope =
      delta.reduce((sum, value, i) => sum + value * centered[i], 0) / spread;
    return {
      vowel,
      raw: delta.reduce((sum, value) => sum + value ** 2, 0),
      detrended: delta.reduce(
        (sum, value, i) => sum + (value - slope * centered[i]) ** 2,
        0
      ),
    };
  });
}

function evaluate(recordings, sampleRate, source, candidates) {
  const stats = {
    raw: { first: 0, topFive: 0, tract: 0 },
    detrended: { first: 0, topFive: 0, tract: 0 },
    periodic: 0,
    total: 0,
  };
  for (const recording of recordings) {
    for (const { start, end, token } of vowelSegments(recording.plan)) {
      stats.total++;
      const midpoint = (start + end) / 2;
      const f0 = measuredPitch(recording, midpoint, source);
      if (!(f0 >= 60 && f0 <= 450)) {
        continue;
      }
      stats.periodic++;
      const scores = scoreVowels(
        recording.samples,
        sampleRate,
        midpoint,
        f0,
        candidates(f0)
      );
      const { height, backness, symbol } = token.phoneme;
      for (const cost of ['raw', 'detrended']) {
        scores.sort((a, b) => a[cost] - b[cost]);
        const rank = scores.findIndex(({ vowel }) => vowel === symbol);
        const winner = VOWELS[scores[0].vowel];
        stats[cost].first += Number(rank === 0);
        stats[cost].topFive += Number(rank >= 0 && rank < 5);
        stats[cost].tract += Number(
          Math.abs(height - winner.height) <= 0.15 &&
            Math.abs(backness - winner.backness) <= 0.2
        );
      }
    }
  }
  return stats;
}

for (const tier of ['telephone', 'wideband']) {
  const { sampleRate, bandLimit } = AUDIO_TIERS.find(
    ({ name }) => name === tier
  );
  for (const preset of ['male', 'female']) {
    const head = randomHeadConfig(1, { preset });
    const { renderOptions } = prepareUtterance('a', {
      head,
      tier,
      seed: 1,
      engine: 'js',
      ipa: true,
    });
    const candidates = candidatesFor(
      head,
      renderOptions,
      Math.min(bandLimit, 4800)
    );
    for (const [label, recordings] of prepareCases(tier, head, sampleRate)) {
      for (const source of ['tracked', 'planned']) {
        console.log(
          JSON.stringify({
            tier,
            preset,
            label,
            source,
            ...evaluate(recordings, sampleRate, source, candidates),
          })
        );
      }
    }
  }
}
