/** Compare unaligned steady rendered vowels with observed frames. Unlicense. */
import {
  analyzeFrames,
  planUtterance,
  presetHeadConfig,
  renderPlan,
  synthesize,
  trackPitch,
} from '../src/index.js';
import { sampleState } from '../src/articulation/tract-shape.js';
import { VOWELS } from '../src/ipa/inventory.js';
import { frameEnvelope } from '../src/recognition/codebook.js';
import { LANDMARK_SENTENCES } from '../scripts/landmark-material.mjs';

const vowels = Object.keys(VOWELS);
const settings = { solver: 'waveguide', engine: 'js', seed: 1 };

function feature(frames, t, head) {
  const { envelope } = frameEnvelope(
    frames,
    t,
    {
      lengthScale: head.vocalTractLength / 16.5,
    },
    { envelope: new Float64Array(24), key: new Float64Array(6) }
  );
  const cepstra = frames.cepstrum.subarray(
    t * frames.cepstra + 1,
    (t + 1) * frames.cepstra
  );
  return { lpc: envelope, mel: cepstra };
}

function getTemplates(head, rate) {
  return vowels.flatMap((vowel) =>
    [0.85, 1, 1.15, 1.3].map((scale) => {
      const plan = planUtterance(vowel, { head, durations: [0.15] });
      const f0 = scale * head.pitch;
      plan.channels.f0.fill(f0);
      const frames = analyzeFrames(
        renderPlan(plan, { ...settings, sampleRate: rate }),
        rate
      );
      return {
        vowel,
        f0,
        state: sampleState(plan, 0.075),
        features: [0.06, 0.07, 0.08, 0.09].map((time) =>
          feature(frames, Math.round(time / frames.hop), head)
        ),
      };
    })
  );
}

function closest(templates, values, f0, method, penalty) {
  let score = Infinity;
  let winner;
  for (const template of templates) {
    const pitchPenalty = (100 * Math.log2(f0 / template.f0)) ** 2 * penalty;
    for (const item of template.features) {
      let distance = 0;
      for (let j = 0; j < values.length; j++) {
        if (Number.isFinite(values[j])) {
          distance += (values[j] - item[method][j]) ** 2;
        }
      }
      distance = distance / values.length + pitchPenalty;
      if (distance < score) {
        score = distance;
        winner = template;
      }
    }
  }
  return winner;
}

for (const [preset, rate] of [
  ['male', 16000],
  ['female', 16000],
  ['male', 8000],
]) {
  const head = presetHeadConfig(preset);
  const templates = getTemplates(head, rate);
  const plan = planUtterance(vowels.map((vowel) => `${vowel}ː`).join(''), {
    head,
    durations: vowels.map(() => 0.3),
  });
  const vowelFrames = analyzeFrames(
    renderPlan(plan, { ...settings, sampleRate: rate }),
    rate
  );
  const sentence = synthesize(LANDMARK_SENTENCES[0][1], {
    ...settings,
    head,
    sampleRate: rate,
  });
  const sentenceFrames = analyzeFrames(sentence.samples, rate);
  const pitch = trackPitch(sentenceFrames);
  const vowelPitch = trackPitch(vowelFrames);
  const vowelInput = plan.segments
    .filter(({ kind }) => kind === 'vowel')
    .map(({ start, end }) => {
      const t = Math.round((start + end) / (2 * vowelFrames.hop));
      return {
        t,
        f0: vowelPitch.f0[t] || head.pitch,
        state: sampleState(plan, t * vowelFrames.hop),
        feature: feature(vowelFrames, t, head),
      };
    });
  const sentenceInput = Array.from(
    { length: sentenceFrames.count },
    (_, t) => t
  )
    .filter(
      (t) => sentenceFrames.speech[t] && sentenceFrames.periodicity[t] >= 0.45
    )
    .map((t) => ({
      t,
      f0: pitch.f0[t] || head.pitch,
      state: sampleState(sentence.plan, t * sentenceFrames.hop),
      feature: feature(sentenceFrames, t, head),
    }));
  for (const method of ['lpc', 'mel']) {
    for (const penalty of [0, method === 'lpc' ? 0.01 : 0.001]) {
      let correct = 0;
      let height = 0;
      let backness = 0;
      for (const item of vowelInput) {
        const predicted = closest(
          templates,
          item.feature[method],
          item.f0,
          method,
          penalty
        ).state;
        correct += Number(
          Math.abs(item.state.height - predicted.height) <= 0.15 &&
            Math.abs(item.state.backness - predicted.backness) <= 0.2
        );
      }
      for (const item of sentenceInput) {
        const predicted = closest(
          templates,
          item.feature[method],
          item.f0,
          method,
          penalty
        ).state;
        height += (item.state.height - predicted.height) ** 2;
        backness += (item.state.backness - predicted.backness) ** 2;
      }
      console.log(
        preset,
        rate,
        method,
        penalty,
        correct,
        Math.sqrt(height / sentenceInput.length),
        Math.sqrt(backness / sentenceInput.length)
      );
    }
  }
}
