// Trace the fold flow and the loads of an interactive render.
// Usage: node experiments/issue-34-trace.mjs [ipa] [subglottal 0|1]
import { planUtterance } from '../src/index.js';
import { VoiceRenderer } from '../src/acoustics/voice.js';

const ipa = process.argv[2] ?? 'ˈɑː';
const subglottal = process.argv[3] !== '0';
const plan = planUtterance(ipa, { ipa: true });
const renderer = new VoiceRenderer(plan, {
  source: 'folds',
  interaction: true,
  subglottal,
  sampleRate: 48000,
});
const target = new Float32Array(48);
const glottis = renderer.glottis;
for (let ms = 0; ms < 300; ms++) {
  renderer.render(target);
  if (ms % 10 === 0) {
    const { below, above } = renderer.load;
    console.log(
      `${ms} ms u=${glottis.u.toFixed(1)} area=${glottis.area.toFixed(4)} lung=${(glottis.pressure / 10).toFixed(0)}Pa oral=${(glottis.oralPressure / 10).toFixed(0)}Pa pAbove=${(above.pressure / 10).toFixed(1)}Pa pBelow=${(below.pressure / 10).toFixed(1)}Pa x1=${glottis.x1.toExponential(2)} x2=${glottis.x2.toExponential(2)} out=${target[47].toFixed(4)}`
    );
  }
}
