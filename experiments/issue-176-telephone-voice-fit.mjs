/** Inspect the initial estimate and formant numbering at 8 kHz. Unlicense. */
import { fitVoice, presetHeadConfig, synthesize } from '../src/index.js';
import { quantile } from '../src/analysis/voice-fit-statistics.js';
import { analyzeFrames } from '../src/recognition/frontend.js';
import { trackBatchFormants } from '../src/recognition/formants.js';
import { trackPitch } from '../src/recognition/pitch.js';

const text =
  process.argv[2] ??
  'Before the rain started, we left the village and followed the old road down to the water. ' +
    'The boats came back in the evening, and we could hear the people calling from the shore.';
const median = (values) =>
  values.sort((a, b) => a - b)[Math.floor(values.length / 2)];

for (const preset of ['male', 'female', 'child']) {
  const head = presetHeadConfig(preset);
  const { samples, sampleRate } = synthesize(text, {
    head,
    tier: 'telephone',
    seed: 1,
  });
  const input = samples.subarray(0, 80000);
  const stageMs = {};
  const fit = fitVoice(input, sampleRate, {
    refine: false,
    profile: (name, ms) => {
      stageMs[name] = Math.round(ms);
    },
  });
  const frames = analyzeFrames(input, sampleRate);
  const pitch = trackPitch(frames);
  const rows = [];
  for (const prior of process.env.FORMANT_PRIORS
    ? [16.5, null, 13, 15, 17, 19]
    : []) {
    const formants = trackBatchFormants(frames, {
      pitch,
      vocalTractLength: prior,
    });
    const lengths = [];
    for (let t = 0; t < frames.count; t++) {
      const i = t * 4;
      if (
        pitch.f0[t] > 0 &&
        !formants.nasal[t] &&
        formants.valid[i] &&
        formants.valid[i + 1] &&
        formants.valid[i + 2]
      ) {
        const [f1, f2, f3] = formants.frequency.subarray(i, i + 3);
        lengths.push((17500 * 8.75) / (0.5 * f1 + 1.5 * f2 + 2.5 * f3));
      }
    }
    rows.push({
      prior,
      track: formants.vocalTractLength,
      median: median(lengths),
      count: lengths.length,
    });
  }
  const f0 = Array.from({ length: 19 }, (_, i) =>
    quantile(fit.state, 'f0', (i + 1) / 20)
  );
  const centres = [0.15, 0.2, 0.25, 0.3, 0.35].map((p) =>
    Math.sqrt(quantile(fit.state, 'f0', p) * quantile(fit.state, 'f0', 1 - p))
  );
  console.log({
    preset,
    truth: [head.vocalTractLength, head.pitch],
    initial: [fit.head.vocalTractLength, fit.head.pitch],
    f0: f0.map(Math.round),
    centres: centres.map((value) => Number(value.toFixed(1))),
    stageMs,
    rows,
  });
}
