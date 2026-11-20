/** Exercise the public session with a six-second synthetic voice. Unlicense. */
import { performance } from 'node:perf_hooks';
import { cpuUsage } from 'node:process';
import {
  createVoiceSession,
  presetHeadConfig,
  synthesize,
} from '../../src/index.js';

const sampleRate = 16000;
const text =
  'A little bird sings in the morning. We heard it again across the green field.';
const { samples, duration } = synthesize(text, {
  head: presetHeadConfig('male'),
  tier: 'minimal',
  seed: 1,
  sampleRate,
  engine: 'js',
});
const start = performance.now();
const cpuStart = cpuUsage();
const session = createVoiceSession({
  sampleRate,
  languages: ['en'],
  level: 'low',
});
const states = [];
session.on('state', ({ state, time }) => states.push({ state, time }));
for (let i = 0; i < samples.length; i += 4096) {
  session.push(samples.subarray(i, i + 4096));
}
const recognition = session.flush();
const { system, user } = cpuUsage(cpuStart);
console.log({
  duration,
  elapsed: (performance.now() - start) / 1000,
  cpu: (system + user) / 1e6,
  states,
  history: session.history,
  recognized: recognition.text,
  synthesizedSamples: session.speak('Hello.', { tier: 'minimal', seed: 1 })
    .samples.length,
});
