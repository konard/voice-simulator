// Issue 51: dominant f0 modulation rate (Hz) of the rendered audio, from
// the YIN f0 track of the vowels (10 ms steps), for vibrato rates 3 to 8.
// Usage: node experiments/issue-51-f0-rate.mjs
import { synthesize } from '../src/synthesize.js';
import { decimate } from '../src/acoustics/analysis.js';
import { yinPitch } from '../src/analysis/voice-features.js';

function f0Rate(result) {
  const { samples, sampleRate } = decimate(result.samples, result.sampleRate, 11025);
  const length = Math.round(0.04 * sampleRate);
  const power = new Map();
  for (const segment of result.plan.segments.filter((s) => s.kind === 'vowel')) {
    const track = [];
    for (let time = segment.start + 0.01; time + 0.04 <= segment.end - 0.01; time += 0.01) {
      const frame = yinPitch(samples, Math.round(time * sampleRate), length, sampleRate);
      if (frame.aperiodicity < 0.3) track.push(12 * Math.log2(frame.f0));
    }
    if (track.length < 8) continue;
    // remove a linear trend
    const n = track.length;
    const mx = (n - 1) / 2;
    const my = track.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0;
    track.forEach((y, x) => { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; });
    const slope = sxy / sxx;
    const rest = track.map((y, x) => y - my - slope * (x - mx));
    for (let f = 2; f <= 12.001; f += 0.1) {
      let re = 0, im = 0;
      rest.forEach((y, x) => { re += y * Math.cos(2 * Math.PI * f * x * 0.01); im += y * Math.sin(2 * Math.PI * f * x * 0.01); });
      const key = f.toFixed(1);
      power.set(key, (power.get(key) ?? 0) + re * re + im * im);
    }
  }
  let best = 0, bestF = 0;
  for (const [f, p] of power) if (p > best) { best = p; bestF = Number(f); }
  return bestF;
}
const base = { pitchRange: 0.5, declination: 0, accentStrength: 0, vibrato: 1 };
for (const ipa of ['ˈaː |', 'aː˥ |', 'ˈmama ˈsasa']) {
  const row = [3, 4, 5, 6, 7, 8].map((vibratoRate) =>
    f0Rate(synthesize(ipa, { ipa: true, tier: 'minimal', seed: 41, head: { ...base, vibratoRate } })).toFixed(1)
  );
  console.log(JSON.stringify(ipa), 'rates 3..8 →', row.join(' '));
}
