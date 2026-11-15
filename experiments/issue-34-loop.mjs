// The interaction loop alone: a uniform waveguide tube driven through
// interactiveFlow at a fixed glottal area, no fold dynamics. A passive
// loop must settle; prints the flow and the pressure above over time.
// Usage: node experiments/issue-34-loop.mjs [glottalArea] [tubeArea] [slow 0|1]
import { Waveguide } from '../src/acoustics/waveguide.js';
import {
  interactiveFlow,
  IncidentPressure,
  PRESSURE_CORNER,
  FOLDS_FLOW_SCALE,
} from '../src/acoustics/folds.js';
import { AIR_DENSITY, SPEED_OF_SOUND } from '../src/acoustics/constants.js';

const a = Number(process.argv[2] ?? 0.3);
const A = Number(process.argv[3] ?? 0.4);
const useSlow = process.argv[4] !== '0';
const sections = 44;
const guide = new Waveguide({ sections, noseSections: 12, head: {} });
guide.setShape(new Float64Array(sections).fill(A), 0, 20);
guide.setGlottalReflection(1);
const dt = 17.5 / (sections * SPEED_OF_SOUND);
const incident = new IncidentPressure();
const load = (AIR_DENSITY * SPEED_OF_SOUND) / A;
const lung = 8000;
let u = 0;
let slow = 0;
let started = false;
for (let step = 0; step < 20000; step++) {
  const { incident: wave } = guide.glottalLoad();
  const p = incident.step(wave, dt);
  const s = useSlow && started ? slow : 0;
  const drive = lung / 2 - p + (load * s) / 2;
  const flow = interactiveFlow(a, Infinity, A, drive);
  const derivative = started ? ((flow - u) / dt) * FOLDS_FLOW_SCALE : 0;
  slow = started
    ? slow + 2 * Math.PI * PRESSURE_CORNER * dt * (flow - s)
    : flow;
  started = true;
  u = flow;
  guide.step(derivative, 0, 0, 0);
  if (step % 1000 === 0 || (step < 200 && step % 10 === 0)) {
    console.log(
      `${step} u=${u.toFixed(2)} slow=${slow.toFixed(2)} pAbove=${((2 * p + load * (u - s)) / 10).toFixed(1)}Pa`
    );
  }
}
console.log(
  `bernoulli ${(a * Math.sqrt((2 * lung) / (1.1 * AIR_DENSITY))).toFixed(2)}`
);
