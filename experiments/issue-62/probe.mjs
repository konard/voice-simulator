import {
  synthesize,
  presetHeadConfig,
  analyzeFrames,
} from '../../src/index.js';
for (const ipa of ['apa', 'asa', 'ama', 'aba', 'aja']) {
  const out = synthesize(ipa, {
    ipa: true,
    head: presetHeadConfig('male'),
    solver: 'waveguide',
    engine: 'js',
    sampleRate: 16000,
    seed: 1,
  });
  const f = analyzeFrames(out.samples, 16000);
  console.log(
    ipa,
    out.plan.segments.map((s) => [
      s.kind,
      s.token?.base,
      s.token?.phoneme?.manner,
      s.start,
      s.end,
    ])
  );
  for (let t = 0; t < f.count; t += 4) {
    console.log(
      [
        t * f.hop,
        f.energy[t],
        f.noise[t],
        f.speech[t],
        f.periodicity[t],
        f.zcr[t],
        f.gravity[t],
        ...f.band.slice(t * 6, t * 6 + 4),
      ]
        .map((x) => Number(x.toFixed(2)))
        .join(' ')
    );
  }
}
