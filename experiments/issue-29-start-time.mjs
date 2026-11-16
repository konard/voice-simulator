// Issue 29: a renderer started at `startTime` with the source state of
// another one, on the JavaScript and the Rust engine. Prints the largest
// difference between the engines and between a continued and a plain render.
import { prepareUtterance } from '../src/synthesize.js';
import { getEngine } from '../src/engine/index.js';
import { VoiceRenderer, releaseRenderer } from '../src/acoustics/voice.js';

const { plan, renderOptions } = prepareUtterance('aː', {
  seed: 1,
  tier: 'minimal',
  ipa: true,
});
const rust = await getEngine();
console.log('engine', rust.name);
const options = { ...renderOptions };
function run(make) {
  const first = make({});
  const head = new Float32Array(Math.round(0.3 * first.sampleRate));
  first.render(head);
  const state = first.saveSources();
  const second = make({ startTime: 0.3 });
  second.restoreSources(state);
  const rest = new Float32Array(second.totalSamples - second.position);
  second.render(rest);
  const plain = make({});
  const all = new Float32Array(plain.totalSamples);
  plain.render(all);
  releaseRenderer(first);
  releaseRenderer(second);
  releaseRenderer(plain);
  return { state, rest, all, start: head.length };
}
const js = run((extra) => new VoiceRenderer(plan, { ...options, ...extra }));
const rs = run((extra) => rust.createRenderer(plan, { ...options, ...extra }));
console.log('state js  ', [...js.state].join(' '));
console.log('state rust', [...rs.state].join(' '));
let diff = 0;
for (let i = 0; i < js.rest.length; i++) {
  diff = Math.max(diff, Math.abs(js.rest[i] - rs.rest[i]));
}
console.log('max |js - rust| continued', diff);
let late = 0;
const skip = Math.round(0.05 * 22050);
for (let i = skip; i < js.rest.length - 2000; i++) {
  late = Math.max(late, Math.abs(js.rest[i] - js.all[js.start + i]));
}
console.log('max |continued - plain| after 50 ms', late);
