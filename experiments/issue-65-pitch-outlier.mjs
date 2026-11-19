/** Probe isolated pitch errors at a voiced-to-noisy transition. Unlicense. */
import {
  analyzeFrames,
  synthesize,
  presetHeadConfig,
  trackPitch,
} from '../src/index.js';
import { sampleState } from '../src/articulation/tract-shape.js';
import { interpolateGaps } from '../src/articulation/plan.js';
import { LANDMARK_SENTENCES } from '../scripts/landmark-material.mjs';

const head = presetHeadConfig('male');
for (const sampleRate of [8000, 16000]) {
  const { samples, plan } = synthesize(LANDMARK_SENTENCES[0][1], {
    head,
    sampleRate,
    solver: 'waveguide',
    seed: 1,
    engine: 'js',
  });
  const frames = analyzeFrames(samples, sampleRate);
  for (const voicedUnvoicedCost of [0.28, 0.35, 0.42, 0.5]) {
    const pitch = trackPitch(frames, { voicedUnvoicedCost });
    const filled = pitch.f0.map((f0) => f0 || NaN);
    interpolateGaps(filled, head.pitch);
    let sum = 0;
    let count = 0;
    for (let t = 0; t < frames.count; t++) {
      if (frames.speech[t] && frames.periodicity[t] >= 0.45) {
        const { f0 } = sampleState(plan, t * frames.hop);
        sum += (filled[t] / f0 - 1) ** 2;
        count++;
      }
      if (t >= 267 && t <= 280 && voicedUnvoicedCost === 0.28) {
        const { f0, voicing } = sampleState(plan, t * frames.hop);
        console.log(
          sampleRate,
          t,
          ...[
            f0,
            voicing,
            frames.speech[t],
            frames.periodicity[t],
            frames.energy[t],
            pitch.f0[t],
            pitch.strength[t],
          ].map((x) => x.toFixed(3))
        );
      }
    }
    console.log({
      sampleRate,
      voicedUnvoicedCost,
      rms: Math.sqrt(sum / count),
    });
  }
}
