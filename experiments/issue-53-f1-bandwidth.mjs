// Welch spectrum of a whispered vowel around its F1 and the -3 dB width of
// the strongest peak below 1 kHz (issue 53): a narrow F1 makes YIN hear
// a pitch in the noise. Usage:
//   node experiments/issue-53-f1-bandwidth.mjs [ipa] [tier]
import { synthesize } from '../src/index.js';

const text = process.argv[2] ?? '{W ˈɔː W}';
const tier = process.argv[3] ?? 'medium';
const result = synthesize(text, { tier, seed: 1, ipa: true, headroom: 20 });
const { samples, sampleRate } = result;
const vowel = result.plan.segments.find((s) => s.kind === 'vowel');
const length = Math.round(0.08 * sampleRate);
const from = Math.round(
  (vowel.start + 0.2 * (vowel.end - vowel.start)) * sampleRate
);
const to =
  Math.round((vowel.end - 0.2 * (vowel.end - vowel.start)) * sampleRate) -
  length;
const frequencies = [];
for (let f = 100; f <= 1200; f += 5) frequencies.push(f);
const power = new Float64Array(frequencies.length);
let frames = 0;
for (let start = from; start <= to; start += length / 4) {
  frames++;
  frequencies.forEach((f, k) => {
    let re = 0;
    let im = 0;
    for (let n = 0; n < length; n++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (length - 1));
      const x = samples[Math.round(start) + n] * w;
      re += x * Math.cos((2 * Math.PI * f * n) / sampleRate);
      im -= x * Math.sin((2 * Math.PI * f * n) / sampleRate);
    }
    power[k] += re * re + im * im;
  });
}
let peak = 0;
power.forEach((p, k) => {
  if (p > power[peak]) peak = k;
});
let low = peak;
while (low > 0 && power[low] > power[peak] / 2) low--;
let high = peak;
while (high < power.length - 1 && power[high] > power[peak] / 2) high++;
for (let k = 0; k < power.length; k += 4)
  console.log(
    frequencies[k],
    (10 * Math.log10(power[k] / power[peak])).toFixed(1)
  );
console.log(
  text,
  tier,
  'frames',
  frames,
  'peak',
  frequencies[peak],
  'Hz, -3 dB width',
  frequencies[high] - frequencies[low],
  'Hz'
);
