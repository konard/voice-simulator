/**
 * Where the memory of the lowest-settings rows goes (issue 81): RSS and heap
 * after each step of one 8 kHz synthesis and recognition.
 * Run: node experiments/issue-81-memory.mjs [lang]
 * Unlicense.
 */
import { synthesize, recognize } from '../src/index.js';

const lang = process.argv[2] ?? 'en';
const mb = (bytes) => Math.round(bytes / 1048576);
const report = (step) => {
  const usage = process.memoryUsage();
  console.log(
    step.padEnd(24),
    `rss ${mb(usage.rss)} MB`,
    `heap ${mb(usage.heapUsed)} MB`,
    `external ${mb(usage.external + usage.arrayBuffers)} MB`,
    `peak ${Math.round(process.resourceUsage().maxRSS / 1024)} MB`
  );
};
report('start');
const spoken = synthesize('Hello world.', { lang, tier: 'telephone', seed: 1 });
report('synthesize');
recognize(spoken.samples, spoken.sampleRate, { lang, level: 'low' });
report('recognize');
recognize(spoken.samples, spoken.sampleRate, { lang, level: 'low' });
report('recognize again');
globalThis.gc?.();
report('after gc');
