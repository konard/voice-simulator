/**
 * Where the time of planUtterance() goes (issue 38): a CPU profile of 2000
 * plans of the audit sentence, summed by function (self time).
 *
 *   node experiments/issue-38-plan-profile.mjs
 */
import { Session } from 'node:inspector/promises';
import { planUtterance, textToIpa } from '../src/index.js';

const { ipa } = textToIpa('The quick brown fox jumps over the lazy dog.');
const session = new Session();
session.connect();
await session.post('Profiler.enable');
await session.post('Profiler.setSamplingInterval', { interval: 100 });
await session.post('Profiler.start');
for (let run = 0; run < 2000; run++) {
  planUtterance(ipa, {});
}
const { profile } = await session.post('Profiler.stop');
const self = new Map();
const total = profile.samples.length;
const byId = new Map(profile.nodes.map((node) => [node.id, node]));
for (const id of profile.samples) {
  const { functionName, url, lineNumber } = byId.get(id).callFrame;
  const key = `${functionName || '(anonymous)'} ${url.split('/').slice(-2).join('/')}:${lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + 1);
}
for (const [key, count] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`${((100 * count) / total).toFixed(1).padStart(5)} %  ${key}`);
}
