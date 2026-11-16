// Issue 51: compare the f0 of the issue-49 "hello world" snapshot (language
// zh, no tones) with the current planUtterance: largest difference and where.
// Usage: node experiments/issue-51-hello-world-f0.mjs
import { readFileSync } from 'node:fs';
import { planUtterance } from '../src/articulation/plan.js';
import { normalizeHeadConfig } from '../src/head-config.js';

const snapshot = JSON.parse(
  readFileSync(
    new globalThis.URL(
      '../tests/fixtures/issue-49/hello-world-f0.json',
      import.meta.url
    ),
    'utf8'
  )
);
for (const language of [snapshot.language, 'en']) {
  const plan = planUtterance(snapshot.ipa, {
    head: normalizeHeadConfig(snapshot.head),
    language,
  });
  let worst = 0;
  let at = 0;
  plan.channels.f0.forEach((value, frame) => {
    const d = Math.abs(value - snapshot.f0[frame]);
    if (d > worst) {
      [worst, at] = [d, frame];
    }
  });
  console.log(
    `${language}: frames ${plan.channels.f0.length}/${snapshot.f0.length} max |diff| ${worst} Hz at frame ${at} (${plan.channels.f0[at]} vs ${snapshot.f0[at]})`
  );
}
