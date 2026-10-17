// Compare the raw solver output level of the 3D FDTD solver with the 1D
// waveguide for the same sustained vowels (used to calibrate FLOW_GAIN).
// Usage: node experiments/fdtd-gain.mjs [dx] [flow|microphone]
import { planUtterance } from '../src/articulation/plan.js';
import { VoiceRenderer } from '../src/acoustics/voice.js';
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';
import { DEFAULT_HEAD } from '../src/head-config.js';

const dx = Number(process.argv[2] ?? 1);
const output = process.argv[3] ?? 'flow';
const model = buildVoxelModel(DEFAULT_HEAD, { dx });

function rawRms(plan, options) {
  const renderer = new VoiceRenderer(plan, { sampleRate: 16000, ...options });
  const step = renderer.solver.step.bind(renderer.solver);
  let sum = 0;
  let count = 0;
  renderer.solver.step = (...args) => {
    const value = step(...args);
    sum += value * value;
    count++;
    return value;
  };
  renderer.render(new Float32Array(Math.ceil(plan.duration * 16000)));
  return Math.sqrt(sum / count);
}

const symbols = process.argv[4]?.split(',') ?? ['i', 'a', 'u', 'ə', 'm', 's'];
for (const symbol of symbols) {
  const plan = planUtterance(`ˈ${symbol}ː`);
  const wave = rawRms(plan, {});
  const fdtd = rawRms(plan, { solver: 'fdtd3d', model, output });
  console.log(symbol, 'fdtd/wave', (fdtd / wave).toPrecision(3));
}
