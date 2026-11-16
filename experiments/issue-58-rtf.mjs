// Real-time factor of the analysis front end (issue 58): seconds of CPU per
// second of sound, on about 10 s of synthetic speech at 16000, 8000 and
// 44100 Hz input. Usage: node experiments/issue-58-rtf.mjs
import { analyzeFrames, synthesize } from '../src/index.js';

const TEXT =
  'The quick brown fox jumps over the lazy dog. She sells sea shells by the sea shore. ' +
  'A large fawn jumped quickly over white zinc boxes.';

function speech(seconds, tier, sampleRate) {
  const voice = synthesize(TEXT, { tier, sampleRate });
  const length = Math.round(seconds * voice.sampleRate);
  const samples = new Float32Array(length);
  for (let n = 0; n < length; n += voice.samples.length) {
    samples.set(
      voice.samples.subarray(0, Math.min(voice.samples.length, length - n)),
      n
    );
  }
  return { samples, sampleRate: voice.sampleRate };
}

for (const [tier, sampleRate] of [
  ['wideband', 16000],
  ['telephone', 8000],
  ['wideband', 44100],
]) {
  const { samples, sampleRate: rate } = speech(10, tier, sampleRate);
  analyzeFrames(samples.subarray(0, rate), rate); // warm up
  const runs = [];
  for (let run = 0; run < 3; run++) {
    const started = globalThis.performance.now();
    analyzeFrames(samples, rate);
    runs.push(
      (globalThis.performance.now() - started) / 1000 / (samples.length / rate)
    );
  }
  console.log(
    `input ${rate} Hz: frontend rtf ${Math.min(...runs).toFixed(4)} (runs ${runs.map((v) => v.toFixed(4)).join(' ')})`
  );
}
