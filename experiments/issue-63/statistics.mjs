// Unlicense. Diagnose uncertainty, boundaries and calibration without searches.
import { synthesize, prepareUtterance } from '../../src/synthesize.js';
import { fitVoice, createVoiceFitter } from '../../src/analysis/voice-fit.js';
import { analyzeLegacyVoice } from '../../src/analysis/voice-features.js';
import { quantile, medianSd } from '../../src/analysis/voice-fit-statistics.js';
for (const head of [
  { vocalTractLength: 14, pitch: 210, tenseness: 0.45, speechRate: 1.15 },
  { vocalTractLength: 18.5, pitch: 100, tenseness: 0.75, speechRate: 0.9 },
  {},
]) {
  const text = 'The north wind and the sun.';
  const a = synthesize(text, {
    head,
    sampleRate: 16000,
    solver: 'waveguide',
    engine: 'js',
    seed: 1,
  });
  const whole = fitVoice(a.samples, 16000, { refine: false });
  const half = Math.floor(a.samples.length / 2),
    f = createVoiceFitter();
  f.update(a.samples.subarray(0, half), 16000).update(
    a.samples.subarray(half),
    16000
  );
  const split = f.result();
  const keys = [
    'vocalTractLength',
    'pitch',
    'pitchRange',
    'tenseness',
    'speechRate',
  ];
  console.log(
    JSON.stringify({
      head,
      duration: a.duration,
      plan: prepareUtterance(text).plan.duration,
      whole: Object.fromEntries(keys.map((k) => [k, whole.parameters[k]])),
      split: Object.fromEntries(keys.map((k) => [k, split.parameters[k]])),
      n: whole.state.voicedFrames,
      median: quantile(whole.state, 'f0'),
      sd: medianSd(whole.state, 'f0'),
      rate: analyzeLegacyVoice(a.samples, 16000).syllableRate,
    })
  );
}
