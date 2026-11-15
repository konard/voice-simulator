// Issue 40: which planned channel changes the consonant levels of the
// acoustics tests (closure of [t] against [a], [s] against [z] above 4 kHz).
// Each channel is dropped from the plan in turn, so tractShape() falls back
// to the value it implies.
// Usage: node experiments/issue-40-consonant-levels.mjs
import { Biquad } from '../src/acoustics/filters.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { planUtterance } from '../src/articulation/plan.js';
import { prepareUtterance } from '../src/index.js';

const RATE = 16000;

function rms(samples, start, end) {
  let sum = 0;
  for (let index = start; index < end; index++) {
    sum += samples[index] ** 2;
  }
  return Math.sqrt(sum / Math.max(1, end - start));
}

function level(samples, plan, kind, rate, middle = 0) {
  const segment = plan.segments.find((entry) => entry.kind === kind);
  const span = segment.end - segment.start;
  return rms(
    samples,
    Math.floor((segment.start + middle * span) * rate),
    Math.floor((segment.end - middle * span) * rate)
  );
}

function without(plan, drop) {
  const channels = { ...plan.channels };
  for (const name of drop) {
    delete channels[name];
  }
  return { ...plan, channels };
}

function above4k(rate) {
  const first = new Biquad();
  const second = new Biquad();
  first.highpass(4000, Math.SQRT1_2, rate);
  second.highpass(4000, Math.SQRT1_2, rate);
  return (sample) => second.process(first.process(sample));
}

function noiseLevel(ipa, drop) {
  const { plan, renderOptions } = prepareUtterance(ipa, {
    ipa: true,
    tier: 'medium',
    seed: 1,
  });
  const reduced = without(plan, drop);
  const rate = renderOptions.sampleRate;
  const samples = renderPlan(reduced, renderOptions);
  const filtered = Float32Array.from(samples, above4k(rate));
  return 20 * Math.log10(level(filtered, reduced, 'consonant', rate, 0.2));
}

for (const drop of [[], ['jaw'], ['lipProtrusion'], ['jaw', 'lipProtrusion']]) {
  const plan = without(planUtterance('ˈata'), drop);
  const samples = renderPlan(plan, { sampleRate: RATE });
  const ratio =
    level(samples, plan, 'consonant', RATE) /
    level(samples, plan, 'vowel', RATE);
  const sz = noiseLevel('ˈasa', drop) - noiseLevel('ˈaza', drop);
  console.log(
    `without [${drop.join(', ')}]: closure/vowel ${ratio.toFixed(4)} (test < 0.4 of a ratio), [s]-[z] above 4 kHz ${sz.toFixed(2)} dB (test 3..12)`
  );
}
