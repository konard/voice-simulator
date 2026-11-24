/**
 * Which voice-independent cues tell a whole loud sentence (SSML volume
 * "loud", the `f` mode of the roundtrip suite) from a normal one? Prints,
 * per render, the active level (dBFS of the loudest 10 % of 10 ms frames)
 * and the medians of the word features of recognition/mode-features.js
 * (spectral tilt alpha, pitch, H1-H2, energy ratio), over the reference
 * words of the render.
 * node experiments/issue-75-loud-cues.mjs [tiers] [presets] [langs] [count]
 * Unlicense.
 */
import { synthesize } from '../src/index.js';
import { measureWords, summarize } from '../src/recognition/mode-features.js';
import { sentences } from '../tests/helpers/roundtrip.js';

const [
  tiers = 'telephone,wideband,high',
  presets = 'male,female,any,child',
  langs = 'en,ru,hi,zh',
  count = '3',
] = process.argv.slice(2);

function activeLevel(samples, rate) {
  const hop = Math.round(rate / 100);
  const energies = [];
  for (let i = 0; i + hop <= samples.length; i += hop) {
    let sum = 0;
    for (let j = i; j < i + hop; j++) {
      sum += samples[j] * samples[j];
    }
    energies.push(sum / hop);
  }
  energies.sort((a, b) => b - a);
  const top = energies.slice(0, Math.max(1, Math.round(energies.length / 10)));
  return 10 * Math.log10(top.reduce((a, b) => a + b) / top.length + 1e-12);
}

console.log('tier preset lang i mode level alpha pitch h1h2 energyRatio');
for (const tier of tiers.split(',')) {
  for (const preset of presets.split(',')) {
    for (const lang of langs.split(',')) {
      for (let i = 0; i < Number(count); i++) {
        const text = sentences[lang][i];
        for (const mode of ['-', 'f']) {
          const input =
            mode === 'f'
              ? `<speak><prosody volume="loud">${text}</prosody></speak>`
              : text;
          const spoken = synthesize(input, {
            lang,
            tier,
            head: 'random',
            preset,
            seed: 1,
            markup: mode === 'f',
          });
          const words = spoken.timeline.words;
          const s = summarize(
            measureWords(spoken.samples, spoken.sampleRate, { words })
          );
          console.log(
            tier,
            preset,
            lang,
            i,
            mode,
            activeLevel(spoken.samples, spoken.sampleRate).toFixed(1),
            ...['alpha', 'pitch', 'h1h2', 'energyRatio'].map((k) =>
              s[k]?.toFixed(1)
            )
          );
        }
      }
    }
  }
}
