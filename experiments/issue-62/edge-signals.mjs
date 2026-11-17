/** Bounded trace of the prescribed coarse/fine rises at the failing edges. */
import {
  synthesize,
  presetHeadConfig,
  analyzeFrames,
} from '../../src/index.js';

for (const ipa of ['apa', 'ama']) {
  const { samples } = synthesize(ipa, {
    ipa: true,
    head: presetHeadConfig('male'),
    solver: 'waveguide',
    engine: 'js',
    sampleRate: 16000,
    seed: 1,
  });
  const f = analyzeFrames(samples, 16000);
  const rise = (t, b, d) => f.band[(t + d) * 6 + b] - f.band[(t - d) * 6 + b];
  console.log(ipa, 'time, periodicity, band 0 coarse/fine, bands 1-4 coarse');
  for (let t = 28; t <= 60; t++) {
    console.log(
      [
        (t * f.hop).toFixed(3),
        f.periodicity[t].toFixed(3),
        rise(t, 0, 5).toFixed(2),
        rise(t, 0, 3).toFixed(2),
        ...[1, 2, 3, 4].map((b) => rise(t, b, 5).toFixed(2)),
      ].join(', ')
    );
  }
}
