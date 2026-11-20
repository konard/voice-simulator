/** Run synthetic detection at the source rate, 8 kHz, and with -20 dB SNR. Unlicense. */
import {
  analyzeFrames,
  findWhisper,
  presetHeadConfig,
  resample,
  synthesize,
  trackPitch,
} from '../src/index.js';
import { createRandom } from '../src/random.js';
import { DECODE_SENTENCES } from '../tests/helpers/decoder-material.js';

export function detect(samples, sampleRate) {
  const frames = analyzeFrames(samples, sampleRate);
  return findWhisper(samples, sampleRate, frames, trackPitch(frames));
}

export function noiseBelow(samples, decibels) {
  const random = createRandom(1);
  const signalPower = samples.reduce((sum, sample) => sum + sample * sample, 0);
  const noise = Float32Array.from(samples, () => random() * 2 - 1);
  const noisePower = noise.reduce((sum, sample) => sum + sample * sample, 0);
  const gain = Math.sqrt(signalPower / noisePower) * 10 ** (decibels / 20);
  return samples.map((sample, i) => sample + gain * noise[i]);
}

export function renderWhisper(text, lang = 'en', preset = 'male') {
  return synthesize(text, {
    lang,
    head: presetHeadConfig(preset),
    tier: 'minimal',
    seed: 1,
    markup: true,
    engine: 'js',
  });
}

export function runRobustness() {
  for (const [language, sentences] of Object.entries(DECODE_SENTENCES)) {
    for (const text of sentences) {
      const voice = renderWhisper(text, language);
      const { samples, sampleRate } = renderWhisper(
        `[whisper] ${text}`,
        language
      );
      console.log(
        JSON.stringify({
          language,
          text,
          voice: detect(voice.samples, voice.sampleRate),
          clean: detect(samples, sampleRate),
          telephone: detect(resample(samples, sampleRate, 8000), 8000),
          noise: detect(noiseBelow(samples, -20), sampleRate),
        })
      );
    }
  }
  const mixed = renderWhisper('one two three [whisper] four five six');
  console.log(
    JSON.stringify({
      mixed: detect(mixed.samples, mixed.sampleRate),
      four: mixed.timeline.words[3].start,
    })
  );
}
