// Speech flags for "Hello world." with -50 dB noise only in the 0.5 s pads
// against noise under the whole recording (the layout of the test).
import { synthesize, analyzeFrames } from '../src/index.js';
import { createRandom } from '../src/random.js';

const voice = synthesize('Hello world.', { tier: 'wideband' });
const rate = voice.sampleRate;
const pad = Math.round(0.5 * rate);
const length = voice.samples.length + 2 * pad;

function noise(seed) {
  const random = createRandom(seed);
  const level = 10 ** (-50 / 20) * Math.sqrt(3);
  return Float32Array.from({ length }, () => (2 * random() - 1) * level);
}

for (const whole of [false, true]) {
  const samples = noise(58);
  for (let n = 0; n < voice.samples.length; n++) {
    samples[pad + n] = (whole ? samples[pad + n] : 0) + voice.samples[n];
  }
  const frames = analyzeFrames(samples, rate);
  const hop = frames.hop;
  const after = 0.5 + voice.duration + frames.window / 2 + 0.05;
  let flagged = 0;
  let total = 0;
  for (let t = Math.ceil(after / hop); t < frames.count; t++) {
    total++;
    flagged += frames.speech[t];
  }
  let leading = 0;
  let leadingTotal = 0;
  for (let t = Math.ceil(0.3 / hop); t * hop < 0.5 - frames.window / 2; t++) {
    leadingTotal++;
    leading += frames.speech[t];
  }
  let vowels = 0;
  let vowelTotal = 0;
  for (const segment of voice.plan.segments) {
    if (segment.kind !== 'vowel') {
      continue;
    }
    const start = 0.5 + segment.start;
    for (
      let t = Math.ceil(start / hop);
      t * hop < start + segment.duration;
      t++
    ) {
      vowelTotal++;
      vowels += frames.speech[t];
    }
  }
  const inside = Math.round((0.5 + voice.duration - 0.05) / hop);
  console.log(
    `${whole ? 'noise under the whole recording' : 'noise only in the pads'}: ` +
      `leading noise flagged ${leading}/${leadingTotal}, ` +
      `vowel frames flagged ${vowels}/${vowelTotal}, ` +
      `trailing noise frames flagged speech ${flagged}/${total}, ` +
      `noise floor near the end of the sentence ${frames.noise[inside].toFixed(1)} dB`
  );
}
