/** Bounded CPU probe; synthesis and front-end excluded from stage timing. */
import {
  analyzeFrames,
  inverseFilter,
  synthesize,
  trackPitch,
} from '../../src/index.js';
const out = synthesize('Hello world.', {
  sampleRate: 16000,
  solver: 'waveguide',
  seed: 1,
});
const frames = analyzeFrames(out.samples, 16000),
  track = trackPitch(frames);
for (const pitch of [null, track]) {
  inverseFilter(frames, { pitch });
  let elapsed = 0;
  for (let run = 0; run < 5; run++) {
    const start = globalThis.performance.now();
    inverseFilter(frames, { pitch });
    elapsed += globalThis.performance.now() - start;
  }
  console.log({
    supplied: !!pitch,
    rtf: elapsed / 5000 / (out.samples.length / 16000),
  });
}
