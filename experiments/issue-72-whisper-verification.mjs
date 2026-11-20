/**
 * Compare whispered readings against an intact recording. Unlicense.
 * Usage: node experiments/issue-72-whisper-verification.mjs w.wav 'hello world' 'the world'
 */
import { readFileSync } from 'node:fs';
import { decodeAudio, resample, synthesize, textToIpa } from '../src/index.js';
import { cepstra, powerFrames } from '../src/metrics/spectrum.js';
import { poolPowerFrames } from '../src/recognition/whisper-spectrum.js';

const [path, ...readings] = process.argv.slice(2);
const { samples: recorded, sampleRate: inputRate } = decodeAudio(
  readFileSync(path)
);
const rate = 16000;
const settings = { window: 0.025, hop: 0.01, coefficients: 12 };

function spectra(samples, sampleRate) {
  const power = powerFrames(
    resample(samples, sampleRate, rate),
    rate,
    settings
  );
  return cepstra(poolPowerFrames(power), rate, settings);
}

function cost(a, b) {
  const count = Math.min(a.length, b.length) - 20;
  let sum = 0;
  for (let c = 1; c <= settings.coefficients; c++) {
    let total = 0;
    let square = 0;
    for (let i = 4; i < count + 4; i++) {
      const difference = a[i][c] - b[i][c];
      total += difference;
      square += difference ** 2;
    }
    sum += square / count - (total / count) ** 2;
  }
  return sum / settings.coefficients;
}

const input = spectra(recorded, inputRate);
for (const text of readings) {
  const { ipa } = textToIpa(text, { lang: 'en' });
  for (const tier of ['minimal', 'wideband']) {
    const { samples, sampleRate, duration } = synthesize(`{W ${ipa} W}`, {
      ipa: true,
      lang: 'en',
      tier,
      seed: 1,
    });
    console.log(
      JSON.stringify({
        text,
        ipa,
        tier,
        duration,
        cost: cost(input, spectra(samples, sampleRate)),
      })
    );
  }
}
