// Does breathiness change the periodicity of a sustained vowel?
// Usage: node experiments/issue-5-breathiness.mjs
import { planUtterance } from '../src/articulation/plan.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { yinPitch, resample } from '../src/analysis/voice-features.js';
import { presetHeadConfig } from '../src/head-config.js';

const base = presetHeadConfig('female');
for (const breathiness of [0, 0.25, 0.5, 1]) {
  for (const jitter of [0, 0.4]) {
    const head = {
      ...base,
      breathiness,
      jitter,
      shimmer: jitter ? 3 : 0,
      vibrato: 0,
    };
    const plan = planUtterance('ɑː', { head });
    const raw = renderPlan(plan, { sampleRate: 16000 });
    const { samples, sampleRate } = resample(raw, 16000);
    const middle = Math.floor(samples.length / 2);
    const result = yinPitch(samples, middle, 441, sampleRate);
    let high = 0;
    let total = 0;
    let previous = 0;
    for (let index = middle; index < middle + 2000; index++) {
      const difference = samples[index] - previous;
      previous = samples[index];
      high += difference * difference;
      total += samples[index] ** 2;
    }
    console.log(
      `breathiness ${breathiness} jitter ${jitter}`,
      `f0 ${result.f0.toFixed(1)} aperiodicity ${result.aperiodicity.toFixed(4)}`,
      `hnr ${(10 * Math.log10((1 - result.aperiodicity) / result.aperiodicity)).toFixed(1)}`,
      `high/total ${(high / total).toFixed(4)}`
    );
  }
}
