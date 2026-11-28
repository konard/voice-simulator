/** Measure low-tier recognition drift after applying the telephone output filter. Unlicense. */
import { OutputStage } from '../src/acoustics/voice.js';
import { resample } from '../src/audio/resample.js';
import { copyVoice, errorRate, getAudioTier, recognize } from '../src/index.js';
import { alignEdits, tokenize } from '../src/metrics/text.js';
import { loadGolden } from '../tests/helpers/golden.js';

const { sampleRate, bandLimit } = getAudioTier('telephone');
const source = process.argv.includes('--source');
const ids = process.argv.slice(2).filter((arg) => arg !== '--source');
const items = loadGolden().filter(({ id }) => !ids.length || ids.includes(id));
if (ids.length && items.length !== ids.length) {
  throw new Error('Supply distinct golden recording IDs, such as en-01');
}

function telephoneFilter(samples) {
  const step = 3;
  const solverRate = sampleRate * step;
  const filter = new OutputStage(sampleRate, 1 / 0.3, bandLimit);
  filter.configure(solverRate);
  const oversampled = resample(samples, sampleRate, solverRate);
  const audio = new Float32Array(samples.length);
  for (let i = 0; i < oversampled.length; i++) {
    const value = filter.filter(oversampled[i]);
    if (i % step === 0) {
      audio[i / step] = filter.finish(value);
    }
  }
  return audio;
}

function timings(first, second) {
  const reading = ({ ipa }) => tokenize(ipa, 'phone').join(' ');
  const { pairs } = alignEdits(first.map(reading), second.map(reading));
  return pairs.length
    ? (1000 *
        pairs.reduce(
          (sum, [i, j]) => sum + Math.abs(first[i].start - second[j].start),
          0
        )) /
        pairs.length
    : null;
}

let edits = 0;
let phones = 0;
for (const item of items) {
  const input = resample(item.samples, item.sampleRate, sampleRate);
  const analysis = source ? copyVoice(input, sampleRate).recognition : null;
  const options = {
    level: 'low',
    languages: [analysis?.languages[0]?.language ?? item.lang],
    includeModeLabels: false,
  };
  const before = analysis ?? recognize(input, sampleRate, options);
  const after = recognize(
    source ? input : telephoneFilter(input),
    sampleRate,
    options
  );
  const error = errorRate(before.ipa, after.ipa, 'phone');
  edits += error.distance;
  phones += error.referenceLength;
  console.log(
    JSON.stringify({
      id: item.id,
      language: options.languages[0],
      before: before.text,
      after: after.text,
      agreement: 1 - error.rate,
      timingMs: timings(
        before.words.flatMap(({ syllables }) => syllables),
        after.words.flatMap(({ syllables }) => syllables)
      ),
    })
  );
}
console.log(
  JSON.stringify({ recordings: items.length, agreement: 1 - edits / phones })
);
