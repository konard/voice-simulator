/** Fit shared articulator and source trajectories to telephone-band spectra. Unlicense. */
import { renderPlan } from '../src/acoustics/voice.js';
import { smoothChannel } from '../src/articulation/plan.js';
import { resample } from '../src/audio/resample.js';
import {
  compareRecordings,
  copyRecording,
  errorRate,
  getAudioTier,
  recognize,
} from '../src/index.js';
import { mfcc } from '../src/metrics/spectrum.js';
import { CODEBOOK_CHANNELS } from '../src/recognition/codebook.js';
import { scorePlan } from '../src/session/score.js';
import { loadGolden } from '../tests/helpers/golden.js';

const settings = { ...getAudioTier('telephone'), engine: 'js', seed: 1 };
const { sampleRate } = settings;
const changes = [0.2, 0.12, 0.08, 0.04];
const source = [
  'breath',
  'harsh',
  'aspiration',
  'frication',
  'velum',
  'voicing',
];
const knobs = [
  ...CODEBOOK_CHANNELS,
  ...source.map((name) => ({ name, min: 0, max: 1 })),
];

const sum = (track) => track.reduce((total, value) => total + value, 0);

function render(plan, length) {
  const samples = new Float32Array(length);
  samples.set(renderPlan(plan, settings).subarray(0, length));
  return samples;
}

function features(samples) {
  const emphasized = samples.map(
    (value, i) => value - 0.9 * (samples[i - 1] ?? 0)
  );
  return mfcc(emphasized, sampleRate, { window: 0.025, hop: 0.005, range: 50 });
}

function distance(reference, output) {
  return Float64Array.from(reference, (expected, i) => {
    const actual = output[i];
    let difference = 0.25 * Math.min(16, (expected[0] - actual[0]) ** 2);
    for (let j = 1; j < expected.length; j++) {
      difference += (expected[j] - actual[j]) ** 2;
    }
    return difference;
  });
}

function fit(plan, samples) {
  const reference = features(samples);
  const evaluate = () =>
    distance(reference, features(render(plan, samples.length)));
  let scores = evaluate();
  console.log(
    JSON.stringify({ fit: 'initial', loss: sum(scores) / scores.length })
  );
  for (const step of changes) {
    for (const { name, min, max } of knobs) {
      const channel = plan.channels[name];
      const origin = channel.slice();
      const delta = step * (max - min);
      const set = (change) => {
        for (let i = 0; i < channel.length; i++) {
          channel[i] = Math.min(max, Math.max(min, origin[i] + change(i)));
        }
      };
      set(() => -delta);
      const down = evaluate();
      set(() => delta);
      const up = evaluate();
      const direction = Float32Array.from(channel, (_, i) => {
        // A 25 ms analysis frame starts 12.5 ms before its control point.
        const j = Math.min(scores.length - 1, Math.max(0, i - 2));
        const best = Math.min(up[j], down[j]);
        return best < scores[j] ? Math.sign(down[j] - up[j]) : 0;
      });
      const smooth = smoothChannel(direction, 0.012, plan.frameRate);
      set((i) => delta * smooth[i]);
      const next = evaluate();
      if (sum(next) < sum(scores)) {
        scores = next;
      } else {
        channel.set(origin);
      }
    }
    console.log(
      JSON.stringify({ fit: step, loss: sum(scores) / scores.length })
    );
  }
  return render(plan, samples.length);
}

function measure(item, input, copy, output, method) {
  const reread = recognize(output, sampleRate, {
    languages: [copy.score.language],
    level: 'low',
    includeModeLabels: false,
  });
  const { f0, mcd } = compareRecordings(
    { samples: input, sampleRate },
    { samples: output, sampleRate },
    { formants: false }
  );
  console.log(
    JSON.stringify({
      id: item.id,
      method,
      cents: f0.rmseCents,
      mcd,
      agreement: 1 - errorRate(copy.recognition.ipa, reread.ipa, 'phone').rate,
    })
  );
}

const ids = process.argv.length > 2 ? process.argv.slice(2) : ['en-01'];
const items = loadGolden().filter(({ id }) => ids.includes(id));
if (items.length !== ids.length) {
  throw new Error('Supply distinct golden recording IDs, such as en-01');
}
for (const item of items) {
  const samples = resample(item.samples, item.sampleRate, sampleRate);
  const copy = copyRecording(samples, sampleRate, {
    tier: 'telephone',
    engine: settings.engine,
  });
  measure(item, samples, copy, copy.samples, 'copy');
  measure(
    item,
    samples,
    copy,
    fit(scorePlan(copy.score), samples),
    'spectral fit'
  );
}
