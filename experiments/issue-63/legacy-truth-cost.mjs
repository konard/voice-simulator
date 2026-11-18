// Unlicense. J and MCD of the true head (and rate variants) against the
// legacy 22050 Hz preset recordings (issue 63).
import { synthesize, fitVoice } from '../../src/index.js';
import { presetHeadConfig } from '../../src/head-config.js';
import { resample } from '../../src/audio/resample.js';
import {
  accumulate,
  emptyState,
} from '../../src/analysis/voice-fit-statistics.js';
import {
  createMcdMetric,
  featureVector,
  vectorDistance,
} from '../../src/analysis/voice-fit-objective.js';
const TEXT =
  'The north wind and the sun were disputing which was the stronger.';
for (const [preset, size] of [
  ['female', undefined],
  ['male', undefined],
  ['female', 0.2],
]) {
  const truth = presetHeadConfig(preset, size);
  const rec = synthesize(TEXT, {
    head: truth,
    solver: 'waveguide',
    sampleRate: 22050,
  });
  const input = resample(rec.samples, 22050, 16000);
  const stage = fitVoice(rec.samples, 22050, { refine: false });
  const target = featureVector(stage.state),
    mcd = createMcdMetric(Float32Array.from(input), 16000);
  for (const variant of [
    {},
    { speechRate: truth.speechRate * 1.1 },
    { speechRate: truth.speechRate * 1.25 },
    { speechRate: truth.speechRate * 0.9 },
    { pitchRange: 1.8 },
  ]) {
    const head = { ...truth, ...variant };
    const r = synthesize(TEXT, {
      head,
      seed: 1,
      sampleRate: 16000,
      solver: 'waveguide',
    });
    const v = featureVector(
      accumulate(emptyState(), r.samples, 16000, {}, false)
    );
    const m = mcd(r.samples);
    const terms = v.values
      .slice(0, 12)
      .map((x, i) =>
        x === null || target.values[i] === null
          ? null
          : +(((x - target.values[i]) / target.scales[i]) ** 2).toFixed(2)
      );
    console.log(
      preset,
      size,
      JSON.stringify(variant),
      'mcd',
      m.toFixed(2),
      'J',
      vectorDistance(target, v, true, m).toFixed(3),
      JSON.stringify(terms)
    );
  }
}
