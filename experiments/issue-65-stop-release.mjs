/** Inspect the energy trough and release spectra of simulated stops. Unlicense. */
import { analyzeFrames, presetHeadConfig, synthesize } from '../src/index.js';

function inspect(voice, sampleRate, ipa) {
  const head = presetHeadConfig(voice);
  const { samples, plan } = synthesize(ipa, {
    head,
    ipa: true,
    sampleRate,
    seed: 1,
    solver: 'waveguide',
    engine: 'js',
  });
  const frames = analyzeFrames(samples, sampleRate);
  const { start, end } = plan.segments.find(({ kind }) => kind === 'consonant');
  const first = Math.round(start / frames.hop);
  const middle = Math.round((start + end) / (2 * frames.hop));
  const last = Math.round(end / frames.hop);
  console.log({ voice, sampleRate, ipa, first, middle, last });
  for (let t = middle - 2; t <= last + 5; t++) {
    const { energy, gravity, periodicity, speech, noise, zcr } = frames;
    console.log(
      t,
      [speech[t], energy[t], noise[t], periodicity[t], gravity[t], zcr[t]]
        .map((v) => v.toFixed(2))
        .join(' ')
    );
  }
}

console.log('frame speech energy noise periodicity gravity zcr');
for (const [voice, sampleRate, vowel] of [
  ['male', 16000, 'a'],
  ['male', 8000, 'a'],
  ['female', 16000, 'i'],
  ['female', 8000, 'u'],
]) {
  for (const stop of ['p', 't', 'k']) {
    inspect(voice, sampleRate, `${vowel}${stop}${vowel}`);
  }
}
