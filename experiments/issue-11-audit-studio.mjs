// Issue 11 audit, part 2: real-time factor of the default tier (`studio`) and
// of the reference tier on one core. Run: node experiments/issue-11-audit-studio.mjs
import { performance } from 'node:perf_hooks';
import { AUDIO_TIERS, synthesize } from '../src/index.js';

const text = 'Hello world.';
for (const tier of AUDIO_TIERS.slice(5)) {
  const started = performance.now();
  const out = synthesize(text, { tier: tier.name, seed: 1 });
  const elapsed = (performance.now() - started) / 1000;
  console.log(
    `rtf ${tier.name}: ${(elapsed / out.duration).toFixed(2)} ` +
      `(${elapsed.toFixed(1)} s for ${out.duration.toFixed(2)} s of audio)`
  );
}
