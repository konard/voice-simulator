import { CODEBOOK_CHANNELS, renderPlan } from '../src/index.js';
import { steadyPlan } from '../src/recognition/codebook-features.js';
import { items, voiceFor, codebookFor } from './issue-150-cache.mjs';
const item = items.find((x) => x.id === 'hi-05');
const head = voiceFor(item);
const book = codebookFor(item, head);
console.log('rows', book.size ?? book.count ?? Object.keys(book));
const W = CODEBOOK_CHANNELS.length;
const t = Date.now();
for (let row = 0; row < 100; row++) {
  const state = Object.fromEntries(
    CODEBOOK_CHANNELS.map(({ name, min, max }, c) => [
      name,
      min + (book.articulation[row * W + c] / 255) * (max - min),
    ])
  );
  const plan = steadyPlan(state, 0.085);
  plan.head = head;
  delete plan.channels.jaw;
  delete plan.channels.lipProtrusion;
  plan.channels.f0.fill(head.pitch);
  renderPlan(plan, {
    sampleRate: 16000,
    solver: 'waveguide',
    engine: 'js',
    seed: 1,
  });
}
console.log('ms per row', (Date.now() - t) / 100);
