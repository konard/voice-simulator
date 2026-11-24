/**
 * In-band spectrum of the sibilants s and ʃ at the narrow-band tiers: the
 * first 160 ms of "sea" and "she" (male and female, random head seed 1),
 * as the energy share in 500 Hz bands up to the band limit, and the
 * spectral centroid. Shows whether the telephone band keeps the two apart.
 * Usage: node experiments/issue-75-sibilant-band.mjs [tier]
 * Unlicense.
 */
import { synthesize } from '../src/index.js';

const tier = process.argv[2] ?? 'telephone';

function spectrum(x, rate, from, to) {
  const n = to - from;
  const bands = new Float64Array(Math.ceil(rate / 2 / 500));
  let total = 0;
  let moment = 0;
  for (let k = 1; k < n / 2; k++) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      const a = (-2 * Math.PI * k * i) / n;
      re += w * x[from + i] * Math.cos(a);
      im += w * x[from + i] * Math.sin(a);
    }
    const p = re * re + im * im;
    const f = (k * rate) / n;
    bands[Math.floor(f / 500)] += p;
    total += p;
    moment += p * f;
  }
  return { bands: [...bands].map((b) => b / total), centroid: moment / total };
}

for (const preset of ['male', 'female']) {
  for (const word of ['sea', 'she']) {
    const s = synthesize(word, {
      lang: 'en',
      tier,
      head: 'random',
      preset,
      seed: 1,
    });
    const rate = s.sampleRate;
    // 20 ms frames from the word start; the sibilant is the run of frames
    // before voicing, whose centroid is high.
    const begin = Math.round(s.timeline.words[0].start * rate);
    const hop = Math.round(0.02 * rate);
    const rows = [];
    for (let t = 0; t < 8; t++) {
      const from = begin + t * hop;
      const { bands, centroid } = spectrum(s.samples, rate, from, from + hop);
      let energy = 0;
      for (let i = from; i < from + hop; i++) {
        energy += s.samples[i] ** 2;
      }
      rows.push(
        `  ${(t * 20).toString().padStart(3)} ms ${(10 * Math.log10(energy / hop + 1e-12)).toFixed(0).padStart(4)} dB centroid ${centroid.toFixed(0).padStart(5)} Hz ${bands
          .map((b) => (100 * b).toFixed(0).padStart(3))
          .join('')}`
      );
    }
    console.log(`${preset} ${word} (${tier}; % of energy per 500 Hz band)`);
    console.log(rows.join('\n'));
  }
}
