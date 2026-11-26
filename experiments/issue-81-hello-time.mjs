// Issue 81: CPU time of recognising "Hello world." at 8 kHz, by option. Unlicense.
// Usage: node experiments/issue-81-hello-time.mjs '{"lang":"en"}'
import { synthesize, recognize } from '../src/index.js';
const options = JSON.parse(process.argv[2] ?? '{}');
const { samples, sampleRate } = synthesize('Hello world.', {
  tier: 'telephone',
});
const start = process.cpuUsage();
const heard = recognize(samples, sampleRate, { level: 'low', ...options });
const { user, system } = process.cpuUsage(start);
console.log(
  JSON.stringify(options),
  JSON.stringify(heard.text),
  `${((user + system) / 1e6).toFixed(2)} s CPU`
);
