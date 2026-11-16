// Smoke test of the analysis front end (issue 58): a 1 kHz sine and speech.
import { analyzeFrames, createFrameAnalyzer } from '../src/recognition/frontend.js';
import { synthesize } from '../src/index.js';

const rate = 16000;
const sine = Float32Array.from({ length: rate }, (_, n) => Math.sin((2 * Math.PI * 1000 * n) / rate));
const f = analyzeFrames(sine, rate);
const t = 100;
console.log('sine count', f.count, 'energy', f.energy[t], 'gravity', f.gravity[t], 'zcr', f.zcr[t], 'period', f.periodicity[t], 'tilt', f.tilt[t]);
console.log('band', Array.from(f.band.subarray(t * 6, t * 6 + 6)).map((v) => v.toFixed(1)).join(' '));

for (const sr of [16000, 44100, 8000]) {
  const tier = sr === 8000 ? 'telephone' : 'wideband';
  const voice = synthesize('Hello world.', { tier, sampleRate: sr });
  const samples = voice.samples;
  const started = performance.now();
  const batch = analyzeFrames(samples, voice.sampleRate);
  const ms = performance.now() - started;
  const a = createFrameAnalyzer(voice.sampleRate);
  const sizes = [1, 7, 160, 1024];
  let pos = 0, i = 0;
  while (pos < samples.length) {
    const s = sizes[i++ % 4];
    a.push(samples.subarray(pos, pos + s));
    pos += s;
  }
  a.flush();
  let diff = 0;
  for (const key of ['energy', 'zcr', 'tilt', 'gravity', 'periodicity', 'noise', 'gain', 'lpc', 'reflection', 'mel', 'cepstrum', 'band']) {
    for (let j = 0; j < batch[key].length; j++) diff = Math.max(diff, Math.abs(batch[key][j] - a.frames[key][j]));
  }
  console.log(voice.sampleRate, samples.length, 'rate', batch.rate, 'count', batch.count, a.frames.count, 'expected', Math.floor((batch.sampleCount - 1) / (batch.hop * batch.rate)) + 1, 'diff', diff, 'rtf', (ms / 1000 / (samples.length / voice.sampleRate)).toFixed(4), 'speech', batch.speech.reduce((x, y) => x + y, 0));
}
