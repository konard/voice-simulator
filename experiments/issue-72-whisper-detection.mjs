/** Calibrate the whisper detector with synthetic speech. Unlicense. */
import { energyRatio } from '../src/analysis/mode-features.js';
import {
  analyzeFrames,
  presetHeadConfig,
  synthesize,
  trackPitch,
} from '../src/index.js';
import { DECODE_SENTENCES } from '../tests/helpers/decoder-material.js';

const ratios = { voice: [], whisper: [] };
for (const [lang, sentences] of Object.entries(DECODE_SENTENCES)) {
  for (const text of sentences) {
    for (const mode of ['voice', 'whisper']) {
      const { samples, sampleRate } = synthesize(
        mode === 'whisper' ? `[whisper] ${text}` : text,
        {
          lang,
          head: presetHeadConfig('male'),
          tier: 'minimal',
          seed: 1,
          markup: true,
        }
      );
      const frames = analyzeFrames(samples, sampleRate);
      const pitch = trackPitch(frames);
      const ratio = energyRatio(samples, sampleRate);
      ratios[mode].push(ratio);
      console.log(
        lang,
        mode,
        ratio.toFixed(2),
        pitch.f0.subarray(0, pitch.count).filter(Boolean).length / pitch.count
      );
    }
  }
}
for (const [mode, values] of Object.entries(ratios)) {
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  console.log(mode, 'median', (values[mid] + values[mid - 1]) / 2);
}
const mixed = synthesize('one two three [whisper] four five six', {
  head: presetHeadConfig('male'),
  tier: 'minimal',
  seed: 1,
  markup: true,
});
console.log(
  mixed.timeline.words.map(({ text, start, end }) => ({ text, start, end }))
);
const frames = analyzeFrames(mixed.samples, mixed.sampleRate);
const pitch = trackPitch(frames);
for (let i = 0; i < frames.count; i += 4) {
  console.log(
    (i * frames.hop).toFixed(3),
    frames.speech[i],
    pitch.f0[i].toFixed(0),
    frames.energy[i].toFixed(0),
    frames.gravity[i].toFixed(0)
  );
}
