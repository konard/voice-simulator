// The numbers behind the turbulence tests of tests/acoustics.test.js
// (issue 35): tier medium, seed 1, levels over the middle 60 % of the
// consonant. Run: node experiments/issue-35-acoustic-tests.mjs
import { analyzeVoice, synthesize } from '../src/index.js';
import { rms } from '../src/acoustics/analysis.js';
import { Biquad } from '../src/acoustics/filters.js';

const render = (ipa, head = {}) =>
  synthesize(ipa, { ipa: true, tier: 'medium', seed: 1, head });
const consonantLevel = ({ samples, sampleRate, plan }, filter) => {
  const segment = plan.segments.find((item) => item.kind === 'consonant');
  const span = segment.end - segment.start;
  const start = Math.floor((segment.start + 0.2 * span) * sampleRate);
  const end = Math.floor((segment.end - 0.2 * span) * sampleRate);
  const signal = filter ? Float32Array.from(samples, filter) : samples;
  return 20 * Math.log10(rms(signal, start, end));
};
const above4k = (sampleRate) => {
  const first = new Biquad();
  const second = new Biquad();
  first.highpass(4000, Math.SQRT1_2, sampleRate);
  second.highpass(4000, Math.SQRT1_2, sampleRate);
  return (sample) => second.process(first.process(sample));
};
const asa = render('ˈasa');
const aza = render('ˈaza');
const print = (name, value) => console.log(`${name}: ${value.toFixed(2)}`);
print(
  '[s] above [f], dB (> 6)',
  consonantLevel(asa) - consonantLevel(render('ˈafa'))
);
print(
  '[s] above [z] above 4 kHz, dB (3 to 12)',
  consonantLevel(asa, above4k(asa.sampleRate)) -
    consonantLevel(aza, above4k(aza.sampleRate))
);
print(
  '[s] at 1600 Pa above 800 Pa, dB (7 to 11)',
  consonantLevel(render('ˈasa', { lungPressure: 1600 })) - consonantLevel(asa)
);
const hnr = (glottalChink) => {
  const { samples, sampleRate } = render('aː', {
    vibrato: 0,
    jitter: 0,
    shimmer: 0,
    glottalChink,
  });
  return analyzeVoice(samples, sampleRate).hnr;
};
const open = hnr(0);
const chink = hnr(10);
console.log(
  `HNR of [aː], glottalChink 0: ${open.toFixed(2)} dB, 10: ${chink.toFixed(2)} dB`
);
print('drop, dB (> 3)', open - chink);
