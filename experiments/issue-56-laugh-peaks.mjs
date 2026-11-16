// Issue 56: the peaks of the 10 ms level curve of a laugh, per call, at
// several pitch shifts (SSML prosody) and seeds.
// node experiments/issue-56-laugh-peaks.mjs
import { levelDb, synthesize } from '../src/index.js';

export function callPeaks(result) {
  const { samples, sampleRate, plan } = result;
  const sound = plan.sounds.find((item) => item.name === 'laugh');
  const hop = Math.round(0.01 * sampleRate);
  const from = Math.round(sound.start * sampleRate);
  const to = Math.round(sound.end * sampleRate);
  const curve = [];
  for (let i = from; i + hop <= to; i += hop) {
    curve.push(levelDb(samples, i, i + hop));
  }
  const calls = Math.round((sound.end - sound.start) / 0.2);
  const peaks = [];
  for (let k = 0; k < calls; k++) {
    const part = curve.slice(k * 20, k * 20 + 20);
    const peak = Math.max(...part);
    peaks.push({ level: peak, frame: k * 20 + part.indexOf(peak) });
  }
  return peaks;
}

const shifts = process.argv[2] ? process.argv[2].split(',').map(Number) : [-2, -1, 0, 1, 2];
for (const shift of shifts) {
  const text = `<speak>Yes <prosody pitch="${shift >= 0 ? '+' : ''}${shift}st"><vs:sound name="laugh"/></prosody></speak>`;
  const result = synthesize(text, { tier: 'medium', seed: 1, markup: true });
  const peaks = callPeaks(result);
  console.log(shift, peaks.map((p) => p.level.toFixed(1)).join(' '), ' steps', peaks.slice(1).map((p, i) => (peaks[i].level - p.level).toFixed(1)).join(' '));
}
