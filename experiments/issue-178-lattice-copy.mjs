/** Compare regenerated speech from an LPC tube lattice on golden recordings. Unlicense. */
import { resample } from '../src/audio/resample.js';
import { lfParameters, lfWaveform } from '../src/acoustics/glottis.js';
import { compareRecordings, errorRate, recognize } from '../src/index.js';
import { lpcAutocorrelation } from '../src/recognition/lpc.js';
import { analyzeFrames } from '../src/recognition/frontend.js';
import { trackPitch } from '../src/recognition/pitch.js';
import { createRandom } from '../src/random.js';
import { loadGolden } from '../tests/helpers/golden.js';

const RATE = 8000;
const HOP = 40;
const HALF_WINDOW = 100;

function measureTube(samples, order) {
  const window = Float64Array.from(
    { length: 2 * HALF_WINDOW + 1 },
    (_, i) => 0.54 - 0.46 * Math.cos((Math.PI * i) / HALF_WINDOW)
  );
  const predictor = new Float64Array(order);
  return Array.from({ length: Math.ceil(samples.length / HOP) + 1 }, (_, i) => {
    const reflection = new Float64Array(order);
    const start = i * HOP - HALF_WINDOW;
    const frame = window.map((weight, j) => {
      const n = start + j;
      return weight * ((samples[n] ?? 0) - 0.97 * (samples[n - 1] ?? 0));
    });
    const power = lpcAutocorrelation(frame, order, predictor, reflection);
    return { reflection, volume: Math.sqrt(power) };
  });
}

function tubeStep(excitation, state, left, right, mix) {
  let pressure = excitation;
  // Inverse prediction lattice, one scattering junction per pole.
  for (let j = state.length - 1; j > 0; j--) {
    const reflection = left[j - 1] + mix * (right[j - 1] - left[j - 1]);
    pressure -= reflection * state[j - 1];
    state[j] = state[j - 1] + reflection * pressure;
  }
  state[0] = pressure;
  return pressure;
}

function renderTube(samples, order) {
  const rows = measureTube(samples, order);
  const pitch = trackPitch(analyzeFrames(samples, RATE));
  const pulse = lfParameters(0.85);
  const random = createRandom(1);
  const state = new Float64Array(order + 1);
  let phase = 0;
  let previous = 0;
  return samples.map((_, i) => {
    const frame = Math.floor(i / HOP);
    const mix = i / HOP - frame;
    const here = rows[frame];
    const next = rows[frame + 1];
    const pitchFrame = frame - Math.round((pitch.startTime * RATE) / HOP);
    const before = pitch.f0[pitchFrame] || pitch.f0[pitchFrame + 1] || 120;
    const after = pitch.f0[pitchFrame + 1] || before;
    const hz = before + mix * (after - before);
    const voicing =
      Number(pitch.f0[pitchFrame] > 0) * (1 - mix) +
      Number(pitch.f0[pitchFrame + 1] > 0) * mix;
    phase = (phase + hz / RATE) % 1;
    const excitation =
      3.5 * voicing * lfWaveform(pulse, phase) +
      (1 - 0.95 * voicing) * Math.sqrt(3) * (2 * random() - 1);
    const gain = here.volume + mix * (next.volume - here.volume);
    previous =
      0.97 * previous +
      tubeStep(gain * excitation, state, here.reflection, next.reflection, mix);
    return previous;
  });
}

const ids = process.argv.slice(2);
const orders = [10, 18, 28];
const items = loadGolden().filter(({ id }) => !ids.length || ids.includes(id));
if (ids.length && items.length !== ids.length) {
  throw new Error('Supply distinct golden recording IDs, such as en-01');
}
for (const item of items) {
  const input = resample(item.samples, item.sampleRate, RATE);
  const options = {
    languages: [item.lang],
    level: 'low',
    includeModeLabels: false,
  };
  const before = recognize(input, RATE, options);
  for (const order of orders) {
    const output = renderTube(input, order);
    const after = recognize(output, RATE, options);
    const metrics = compareRecordings(
      { samples: input, sampleRate: RATE },
      { samples: output, sampleRate: RATE },
      { formants: false }
    );
    console.log(
      JSON.stringify({
        id: item.id,
        order,
        cents: metrics.f0.rmseCents,
        mcd: metrics.mcd,
        agreement: 1 - errorRate(before.ipa, after.ipa, 'phone').rate,
      })
    );
  }
}
