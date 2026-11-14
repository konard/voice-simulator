// Issue 84: harmonic levels (dB) of the first [a] and of the [m] in ˈama,
// 60 ms around the middle of each segment, and the planned f0, loudness
// and velum channels there. Shows where the energy of each segment sits.
// Run: node experiments/issue-84-harmonics.mjs medium '{"nasalLoss":3}'
import { synthesize, sampleState } from '../src/index.js';
import { harmonicLevel } from '../src/acoustics/analysis.js';

const tier = process.argv[2] ?? 'medium';
const head = JSON.parse(process.argv[3] ?? '{}');
const { samples, sampleRate, plan } = synthesize('ˈama', {
  ipa: true,
  tier,
  seed: 1,
  head,
});
for (const kind of ['vowel', 'consonant']) {
  const segment = plan.segments.find((item) => item.kind === kind);
  const centre = (segment.start + segment.end) / 2;
  const state = sampleState(plan, centre, {});
  const levels = [];
  for (let k = 1; k * state.f0 < 3000; k++) {
    levels.push(
      Math.round(
        harmonicLevel(samples, sampleRate, k * state.f0, {
          start: centre - 0.03,
          duration: 0.06,
        })
      )
    );
  }
  console.log(
    `${tier} ${kind} f0 ${state.f0.toFixed(1)} loudness ${state.loudness.toFixed(2)} velum ${state.velum.toFixed(2)} dur ${(segment.end - segment.start).toFixed(3)}: ${levels.join(' ')}`
  );
}
