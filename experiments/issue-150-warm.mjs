import { items, voiceFor, codebookFor } from './issue-150-cache.mjs';
import {
  analyzeFrames,
  buildCodebook,
  invertArticulation,
  articulationPlan,
  renderPlan,
  melCepstralDistortion,
} from '../src/index.js';
const seen = new Set();
for (const item of items) {
  if (seen.has(item.speaker.id)) {
    continue;
  }
  seen.add(item.speaker.id);
  const t = Date.now();
  const head = voiceFor(item);
  codebookFor(item, head);
  console.log(item.speaker.id, 'ready', (Date.now() - t) / 1000);
}
// Check that a cached codebook gives the same MCD as a freshly built one.
const item = items.find((x) => x.id === 'hi-05');
const head = voiceFor(item);
const run = (book) =>
  melCepstralDistortion(
    item.samples,
    renderPlan(
      articulationPlan(
        invertArticulation(analyzeFrames(item.samples, item.sampleRate), {
          voice: head,
          codebook: book,
        })
      ),
      {
        sampleRate: item.sampleRate,
        solver: 'waveguide',
        engine: 'js',
        seed: 1,
      }
    ),
    item.sampleRate
  );
console.log(
  'cached',
  run(codebookFor(item, head)),
  'fresh',
  run(buildCodebook(head, { size: 5000, cache: new Map() }))
);
