/** Compare exact phonation measurements across scratch window boundaries. Unlicense. */
import { createHash } from 'node:crypto';
import { cpp, glottalPeriods } from '../src/analysis/mode-features.js';

const hash = createHash('sha256');
for (const rate of [8000, 16000, 22050, 44100]) {
  const hop = Math.round(0.01 * rate);
  for (const length of [hop - 1, 20 * hop, 128 * hop + 1, 281 * hop + 17]) {
    const samples = Float32Array.from({ length }, (_, index) => {
      const time = index / rate;
      const fundamental = Math.sin(2 * Math.PI * (130 * time + time ** 2));
      const partial = Math.cos(2 * Math.PI * 261 * time);
      const envelope = time % 1.38 < 0.2 ? 0.01 : 0.5;
      return envelope * (fundamental + 0.2 * partial);
    });
    hash.update(
      JSON.stringify([glottalPeriods(samples, rate), cpp(samples, rate)])
    );
  }
}
console.log(hash.digest('hex'));
