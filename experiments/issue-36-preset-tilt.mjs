// Spectral tilt of the female and child presets above the male one, the
// measure of 'gives the female and child presets the spectral tilt of
// women' in tests/head-presets.test.js, for the source tree in SOURCE
// (default ../src), e.g. a worktree of main or of the branch before a merge.
// The second block mutes the aspiration noise (aspirationLevel 0) to split
// the harmonic tilt from the noise that fills the A3 band.
// Usage: SOURCE=/tmp/main/src node experiments/issue-36-preset-tilt.mjs
import { resolve } from 'node:path';
import { URL, fileURLToPath, pathToFileURL } from 'node:url';

const source = resolve(
  process.env.SOURCE ?? fileURLToPath(new URL('../src', import.meta.url))
);
const load = (path) => import(pathToFileURL(resolve(source, path)).href);
const { planUtterance } = await load('articulation/plan.js');
const { renderPlan } = await load('acoustics/voice.js');
const { estimatePitch, spectralTilt } = await load('acoustics/analysis.js');
const { HILLENBRAND } = await load('articulation/vowel-norms.js');
const { presetHeadConfig } = await load('head-config.js');

const RATE = 16000;
const tilt = (preset, extra) => {
  const head = { ...presetHeadConfig(preset), ...extra };
  const sums = { h1h2Corrected: 0, h1a3Corrected: 0 };
  for (const vowel of ['æ', 'ɑ', 'ʌ']) {
    const plan = planUtterance(`ˈ${vowel}ː`, { head });
    const samples = renderPlan(plan, { sampleRate: RATE });
    const segment = plan.segments.find((entry) => entry.kind === 'vowel');
    const range = {
      start: (segment.start + segment.end) / 2 - 0.04,
      duration: 0.08,
    };
    const f0 = estimatePitch(samples, RATE, { ...range, min: 70 });
    const measures = spectralTilt(samples, RATE, {
      ...range,
      f0,
      formants: HILLENBRAND[preset][vowel],
    });
    for (const key of Object.keys(sums)) {
      sums[key] += measures[key] / 3;
    }
  }
  return sums;
};

console.log(`source ${source}`);
for (const [name, extra] of [
  ['preset heads', {}],
  ['aspirationLevel 0', { aspirationLevel: 0 }],
]) {
  const male = tilt('male', extra);
  for (const preset of ['female', 'child']) {
    const voice = tilt(preset, extra);
    const h1h2 = voice.h1h2Corrected - male.h1h2Corrected;
    const h1a3 = voice.h1a3Corrected - male.h1a3Corrected;
    console.log(
      `${name}, ${preset} - male: H1*-H2* ${h1h2.toFixed(2)} dB, ` +
        `H1*-A3* ${h1a3.toFixed(2)} dB`
    );
  }
}
