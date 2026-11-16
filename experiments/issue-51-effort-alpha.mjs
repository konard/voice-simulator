/**
 * Issue 51 after merging #52: the alpha ratio of `Please call Stella.` with
 * `[soft]`, `[loud]` and `[shout]` against plain speech, and the F1 shift of
 * `{f ˈa f}` and `{ff ˈa ff}` against `ˈa`, depend on where the harmonics
 * fall (F2 of [ɔ] lies near the 1 kHz band edge; the F1 estimate follows
 * the nearest harmonic), so half a semitone of speaker pitch moves them by
 * several dB and tens of Hz. The alpha ratio is defined on a long-term
 * average spectrum; tests/effort.test.js pools the spectra of renders with
 * the speaker pitch 120 Hz × 2^(s/12), s = -3 … 3, and averages the F1
 * shifts over the same pitches. This prints one render, the ±0.5 st
 * sensitivity, and the pooled numbers the test checks.
 *   node experiments/issue-51-effort-alpha.mjs [checkout root]
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] ?? path.join(here, '..'));
const load = (file) => import(pathToFileURL(path.join(root, file)).href);
const { synthesize, alphaRatio, analyzeVoice } = await load('src/index.js');
const { averageSpectrum } = await load('src/analysis/mode-features.js');

const TEXT = 'Please call Stella.';
const BASE = { tier: 'medium', seed: 1, markup: true, headroom: 20 };
const SHIFTS = [-3, -2, -1, 0, 1, 2, 3];
const TAGS = ['soft', 'loud', 'shout'];
const head = (shift) =>
  shift === null ? undefined : { pitch: 120 * 2 ** (shift / 12) };
const text = (tag) => (tag === 'plain' ? TEXT : `[${tag}]${TEXT}[/${tag}]`);
const render = (tag, shift) =>
  synthesize(text(tag), { ...BASE, head: head(shift) });
const band = ({ power, binWidth }, low, high) => {
  let sum = 0;
  const last = Math.min(power.length, Math.ceil(high / binWidth));
  for (let k = Math.ceil(low / binWidth); k < last; k++) {
    sum += power[k];
  }
  return sum;
};
const alpha = (tag, shifts) => {
  let high = 0;
  let low = 0;
  for (const shift of shifts) {
    const { samples, sampleRate } = render(tag, shift);
    if (shifts.length === 1) {
      return alphaRatio(samples, sampleRate, 0, samples.length);
    }
    const spectrum = averageSpectrum(samples, sampleRate, 0, samples.length);
    high += band(spectrum, 1000, 5000);
    low += band(spectrum, 50, 1000);
  }
  return 10 * Math.log10(high / low);
};
const f1 = (ipa, shift) => {
  const options = { ...BASE, markup: false, ipa: true, head: head(shift) };
  const { samples, sampleRate } = synthesize(ipa, options);
  return analyzeVoice(samples, sampleRate).formants[0];
};
const f1Shift = (ipa, shifts) =>
  shifts.reduce((sum, s) => sum + f1(ipa, s) - f1('ˈa', s), 0) / shifts.length;
const line = (label, shifts) => {
  const plain = alpha('plain', shifts);
  const tags = TAGS.map(
    (tag) => `${tag} ${(alpha(tag, shifts) - plain).toFixed(2)}`
  );
  const formants = ['{f ˈa f}', '{ff ˈa ff}'].map(
    (ipa) => `${ipa} ${f1Shift(ipa, shifts).toFixed(1)}`
  );
  console.log(
    `${label}: alpha ${tags.join('  ')} dB; F1 ${formants.join('  ')} Hz`
  );
};

console.log(`checkout ${root}`);
line('default speaker, one render', [null]);
line('speaker 120 Hz × 2^(-0.5/12), one render', [-0.5]);
line('speaker 120 Hz × 2^(+0.5/12), one render', [0.5]);
line(`pooled over s = ${SHIFTS.join(' ')} (the test)`, SHIFTS);
