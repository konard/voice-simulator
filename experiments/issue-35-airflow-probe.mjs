// Aerodynamic state in the middle of the consonant of aCa (issue 35):
// constriction area, mouth pressure, flow, relative source strengths,
// Strouhal frequency, obstacle share and the frication amplitude.
// Usage: node experiments/issue-35-airflow-probe.mjs [ipa...]
import { planUtterance } from '../src/articulation/plan.js';
import { VoiceRenderer, strouhalFrequency } from '../src/acoustics/voice.js';
import {
  FRICATION_REFERENCE,
  sourceStrength,
} from '../src/acoustics/aerodynamics.js';

const RATE = 48000;
const words = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['ˈasa', 'ˈaʃa', 'ˈafa', 'ˈaθa', 'ˈaxa', 'ˈaza', 'ˈava', 'ˈaha', 'ˈaːa'];
for (const ipa of words) {
  const plan = planUtterance(ipa, { language: 'en' });
  const renderer = new VoiceRenderer(plan, { sampleRate: RATE, seed: 1 });
  const segment =
    plan.segments.find((item) => item.kind === 'consonant') ??
    plan.segments.find((item) => item.kind === 'vowel');
  const time = (segment.start + segment.end) / 2;
  renderer.render(new Float32Array(Math.round(time * RATE)));
  const { shape, airflow: air } = renderer;
  const area = shape.frication.area;
  const relative =
    sourceStrength(air.constrictionDrop, area, air.flow) / FRICATION_REFERENCE;
  console.log(
    `${ipa.padEnd(6)} A_c ${area.toFixed(3)} velum ${shape.velumArea.toFixed(2)} ` +
      `P_o ${air.oralPressure.toFixed(0)} U ${air.flow.toFixed(0)} ` +
      `frication ${relative.toFixed(3)} aspiration ${shape.glottis.aspirationStrength.toFixed(3)} ` +
      `Strouhal ${strouhalFrequency(air.flow, area + shape.velumArea).toFixed(0)} Hz ` +
      `obstacle ${shape.frication.obstacle.toFixed(2)} position ${shape.frication.position} ` +
      `gain ${shape.frication.gain.toFixed(2)} amplitude ${renderer.fricationAmplitude.toFixed(3)}`
  );
}
