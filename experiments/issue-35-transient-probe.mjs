// Largest flow derivative (cm³/s²) and oral pressure share at that block,
// per word: where the burst transient fires (issue 35).
// Run: node experiments/issue-35-transient-probe.mjs [ipa...]
import { planUtterance } from '../src/articulation/plan.js';
import { VoiceRenderer } from '../src/acoustics/voice.js';

const RATE = 48000;
const BLOCK = 32;
const words = process.argv.slice(2);
for (const ipa of words.length
  ? words
  : ['ˈta', 'ˈama', 'ˈaː', 'ˈasa', 'ˈaza']) {
  const plan = planUtterance(ipa, { language: 'fr' });
  const renderer = new VoiceRenderer(plan, { sampleRate: RATE, seed: 1 });
  const samples = new Float32Array(renderer.totalSamples);
  let best = { value: 0 };
  for (let start = 0; start < samples.length; start += BLOCK) {
    renderer.render(samples.subarray(start, start + BLOCK));
    const air = renderer.airflow;
    const value = Math.abs(air.flowDerivative);
    if (value > best.value) {
      best = {
        value,
        time: start / RATE,
        oral: air.oralPressure,
        flow: air.flow,
      };
    }
  }
  console.log(
    `${ipa.padEnd(6)} max |dU/dt| ${best.value.toExponential(2)} at ` +
      `${best.time.toFixed(3)} s, P_o ${best.oral.toFixed(0)}, U ${best.flow.toFixed(0)}`
  );
}
