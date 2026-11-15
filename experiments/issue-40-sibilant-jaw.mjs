#!/usr/bin/env node
// Issue 40 after the durations of issue 39: a stressed onset [z] lasts
// 66 ms and [s] 107 ms, so a slow jaw does not raise the incisors to the
// sibilant gap in [z]. For each jaw time constant (its lead is the default
// 1.68 time constants) print the level above 4 kHz of the middle 60 % of
// [s] and [z] in [aˈsa], [aˈza] (tests/acoustics.test.js wants the
// difference within 3 to 12 dB), the incisor gap at the middle of the
// fricative, and whether the jaw still lags the tongue at the middle of
// [t] in [ata] (tests/articulators.test.js).
// Usage: node experiments/issue-40-sibilant-jaw.mjs
import { Biquad } from '../src/acoustics/filters.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { ARTICULATORS, planUtterance } from '../src/articulation/plan.js';
import { impliedGap } from '../src/articulation/teeth.js';
import { prepareUtterance } from '../src/index.js';
import { normalizeHeadConfig } from '../src/head-config.js';

function rms(samples, start, end) {
  let sum = 0;
  for (let index = start; index < end; index++) {
    sum += samples[index] ** 2;
  }
  return Math.sqrt(sum / Math.max(1, end - start));
}

function above4k(rate) {
  const first = new Biquad();
  const second = new Biquad();
  first.highpass(4000, Math.SQRT1_2, rate);
  second.highpass(4000, Math.SQRT1_2, rate);
  return (sample) => second.process(first.process(sample));
}

function stateAt(plan, time) {
  const frame = Math.min(
    plan.frameCount - 1,
    Math.round(time * plan.frameRate)
  );
  const state = {};
  for (const [name, values] of Object.entries(plan.channels)) {
    state[name] = values[frame];
  }
  return state;
}

function middle(plan) {
  const segment = plan.segments.find((item) => item.kind === 'consonant');
  return { segment, time: (segment.start + segment.end) / 2 };
}

function fricative(ipa, articulators) {
  const { plan: base, renderOptions } = prepareUtterance(ipa, {
    ipa: true,
    tier: 'medium',
    seed: 1,
  });
  const plan = planUtterance(ipa, { head: base.head, articulators });
  const rate = renderOptions.sampleRate;
  const samples = renderPlan(plan, renderOptions);
  const filtered = Float32Array.from(samples, above4k(rate));
  const { segment, time } = middle(plan);
  const span = segment.end - segment.start;
  const level =
    20 *
    Math.log10(
      rms(
        filtered,
        Math.floor((segment.start + 0.2 * span) * rate),
        Math.floor((segment.end - 0.2 * span) * rate)
      )
    );
  return { level, gap: stateAt(plan, time).jaw, span };
}

const head = normalizeHeadConfig({});
for (const tau of [0.035, 0.03, 0.025, 0.02, 0.015, 0.012]) {
  const articulators = {
    jaw: { timeConstant: tau, lead: 1.68 * tau },
  };
  const s = fricative('aˈsa', articulators);
  const z = fricative('aˈza', articulators);
  const ata = planUtterance('ata', { head, articulators });
  const state = stateAt(ata, middle(ata).time);
  const lag = state.jaw - impliedGap(state, head);
  console.log(
    `jaw tau ${tau.toFixed(3)} s: [s] ${s.level.toFixed(2)} dB gap ${s.gap.toFixed(3)} cm (${(s.span * 1000).toFixed(0)} ms), ` +
      `[z] ${z.level.toFixed(2)} dB gap ${z.gap.toFixed(3)} cm (${(z.span * 1000).toFixed(0)} ms), ` +
      `[s]-[z] ${(s.level - z.level).toFixed(2)} dB; [t] of [ata]: jaw - implied ${lag.toFixed(3)} cm`
  );
}
console.log(`ARTICULATORS.jaw: ${JSON.stringify(ARTICULATORS.jaw)}`);
