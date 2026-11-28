/** Measure phone and timing stability after phase-independent spectral resynthesis. Unlicense. */
import { resample } from '../src/audio/resample.js';
import { compareRecordings, errorRate, recognize } from '../src/index.js';
import { alignEdits, tokenize } from '../src/metrics/text.js';
import { createRandom } from '../src/random.js';
import { createFft } from '../src/recognition/fft.js';
import { analyzeFrames } from '../src/recognition/frontend.js';
import { trackPitch } from '../src/recognition/pitch.js';
import { loadGolden } from '../tests/helpers/golden.js';

const RATE = 8000;
const HOP = 32;
const WIDTH = 200;
const SIZE = 256;
const HALF = SIZE / 2;
const PASSES = 40;
const exact = process.argv.includes('--exact');
const window = Float64Array.from({ length: WIDTH }, (_, i) =>
  Math.sin((Math.PI * (i + 0.5)) / WIDTH)
);
const fft = createFft(SIZE);
const re = new Float64Array(SIZE);
const im = new Float64Array(SIZE);

function powerAt(samples, center) {
  re.fill(0);
  im.fill(0);
  for (let j = 0; j < WIDTH; j++) {
    re[j] = (samples[center + j - WIDTH / 2] ?? 0) * window[j];
  }
  fft.forward(re, im);
  const raw = re.map((value, j) => value ** 2 + im[j] ** 2);
  if (exact) {
    return raw.subarray(0, HALF + 1);
  }
  return Float64Array.from({ length: HALF + 1 }, (_, k) => {
    const prev = (k + SIZE - 1) % SIZE;
    return (raw[prev] + 2 * raw[k] + raw[k + 1]) / 4;
  });
}

function excitation(samples) {
  const pitch = trackPitch(analyzeFrames(samples, RATE));
  const random = createRandom(1);
  let markIndex = 0;
  let phase = 0;
  return new Float32Array(samples.length).map((_, i) => {
    const time = i / RATE;
    const row = i / (RATE * pitch.hop);
    const t = Math.floor(row);
    const mix = row - t;
    const before = pitch.f0[t] || pitch.f0[t + 1] || 120;
    const after = pitch.f0[t + 1] || before;
    const voiced = pitch.voicing[t] || 0;
    const voicing = voiced + mix * ((pitch.voicing[t + 1] || 0) - voiced);
    const f0 = before + mix * (after - before);
    phase = (phase + f0 / RATE) % 1;
    while (markIndex < pitch.marks.length && time > pitch.marks[markIndex]) {
      markIndex++;
    }
    const start = pitch.marks[markIndex - 1];
    const length = pitch.marks[markIndex] - start;
    if (length < 0.024) {
      phase = (time - start) / length;
    }
    const harmonics = Math.min(38, Math.floor(3700 / f0));
    const angle = 2 * Math.PI * (phase - 0.5);
    const source =
      Math.abs(angle) < 1e-5
        ? harmonics
        : (Math.sin((harmonics * angle) / 2) *
            Math.cos(((harmonics + 1) * angle) / 2)) /
          Math.sin(angle / 2);
    return (
      (3 * voicing * source) / Math.sqrt(harmonics) +
      (1 - voicing * (1 - 0.18)) * (2 * random() - 1)
    );
  });
}

function render(reference, output) {
  const centers = Array.from(
    { length: Math.ceil((reference.length + WIDTH / 2) / HOP) },
    (_, i) => (i - Math.ceil(WIDTH / 2 / HOP)) * HOP
  );
  const powers = centers.map((center) => powerAt(reference, center));
  for (let pass = 0; pass < PASSES; pass++) {
    const out = new Float64Array(output.length);
    const weight = new Float64Array(output.length);
    for (const [frame, center] of centers.entries()) {
      const measured = powerAt(output, center);
      const cap = pass ? 3 : 99;
      for (let k = 0; k <= HALF; k++) {
        const gain = Math.min(
          cap,
          Math.sqrt(powers[frame][k] / (measured[k] + 1e-14))
        );
        re[k] *= gain;
        im[k] *= gain;
        if (k > 0 && k < HALF) {
          re[SIZE - k] = re[k];
          im[SIZE - k] = -im[k];
        }
      }
      fft.inverse(re, im);
      for (let j = 0; j < WIDTH; j++) {
        const i = center + j - WIDTH / 2;
        if (i >= 0 && i < output.length) {
          out[i] += re[j] * window[j];
          weight[i] += window[j] ** 2;
        }
      }
    }
    output = out.map((sum, i) => sum / (weight[i] || 1));
  }
  return Float32Array.from(output);
}

function timing(first, second) {
  const before = first.words.flatMap(({ syllables }) => syllables);
  const after = second.words.flatMap(({ syllables }) => syllables);
  const reading = ({ ipa }) => tokenize(ipa, 'phone').join(' ');
  const { pairs } = alignEdits(before.map(reading), after.map(reading));
  return (
    (1000 *
      pairs.reduce(
        (sum, [i, j]) => sum + Math.abs(before[i].start - after[j].start),
        0
      )) /
    pairs.length
  );
}

const preemphasize = (samples) =>
  samples.map((value, i) => value - 0.97 * (samples[i - 1] ?? 0));
const ids = process.argv.slice(2).filter((arg) => arg !== '--exact');
const items = loadGolden().filter(({ id }) => !ids.length || ids.includes(id));
if (ids.length && items.length !== ids.length) {
  throw new Error('Supply distinct golden recording IDs, such as en-01');
}
let cents = 0;
let edits = 0;
let phones = 0;
let ms = 0;
for (const item of items) {
  const samples = resample(item.samples, item.sampleRate, RATE);
  const output = render(
    preemphasize(samples),
    preemphasize(excitation(samples))
  );
  for (let i = 1; i < output.length; i++) {
    output[i] += 0.97 * output[i - 1];
  }
  const options = {
    languages: [item.lang],
    level: 'low',
    includeModeLabels: false,
    segments: true,
  };
  const before = recognize(samples, RATE, options);
  const after = recognize(output, RATE, options);
  const error = errorRate(before.ipa, after.ipa, 'phone');
  const metrics = compareRecordings(
    { samples, sampleRate: RATE },
    { samples: output, sampleRate: RATE },
    { formants: false }
  );
  const timingMs = timing(before, after);
  const f0Cents = metrics.f0.rmseCents;
  cents += f0Cents;
  edits += error.distance;
  phones += error.referenceLength;
  ms += timingMs;
  console.log(
    JSON.stringify({
      id: item.id,
      reference: before.text,
      replay: after.text,
      f0Cents,
      timingMs,
      agreement: 1 - error.rate,
      mcd: metrics.mcd,
      dtwSeconds: metrics.timing.rmsSeconds,
    })
  );
}
console.log(
  JSON.stringify({
    recordings: items.length,
    f0Cents: cents / items.length,
    agreement: 1 - edits / phones,
    timingMs: ms / items.length,
  })
);
