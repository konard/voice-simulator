/** Inspect all permitted candidates, even below the calibrated rise gate,
 * against the planned edges. This does not change the detector rules. */
import {
  synthesize,
  presetHeadConfig,
  analyzeFrames,
} from '../../src/index.js';
import { landmarkCandidates } from '../../src/recognition/landmark-signals.js';

for (const ipa of ['apa', 'asa', 'ama', 'aba']) {
  const out = synthesize(ipa, {
    ipa: true,
    head: presetHeadConfig('male'),
    solver: 'waveguide',
    engine: 'js',
    sampleRate: 16000,
    seed: 1,
  });
  const frames = analyzeFrames(out.samples, 16000);
  const consonant = out.plan.segments.find((s) => s.kind === 'consonant');
  const release = out.plan.segments.find((s) => s.kind === 'release');
  const edges =
    ipa === 'ama'
      ? [
          ['s-', consonant.start],
          ['s+', consonant.end],
        ]
      : [
          ['g-', consonant.start],
          ['g+', release?.end ?? consonant.end],
        ];
  const candidates = landmarkCandidates(frames, Number.MIN_VALUE);
  for (const [type, time] of edges) {
    const sameType = candidates.filter((c) => c.type === type);
    const nearest = sameType.sort(
      (a, b) =>
        Math.abs(a.t * frames.hop - time) - Math.abs(b.t * frames.hop - time)
    )[0];
    console.log(
      JSON.stringify({
        ipa,
        type,
        expected: time,
        nearest: nearest ? nearest.t * frames.hop : null,
        error: nearest ? Math.abs(nearest.t * frames.hop - time) : null,
        strength: nearest?.strength ?? null,
      })
    );
  }
  const crossings = [];
  for (let t = 1; t < frames.count; t++) {
    const before = frames.periodicity[t - 1] >= 0.45;
    const after = frames.periodicity[t] >= 0.45;
    if (
      before !== after &&
      t * frames.hop >= consonant.start - 0.04 &&
      t * frames.hop <= consonant.end + 0.04
    ) {
      crossings.push({ time: t * frames.hop, type: after ? 'g+' : 'g-' });
    }
  }
  console.log(JSON.stringify({ ipa, voicingCrossings: crossings }));
}
