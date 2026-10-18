// H1-H2 and the spectral tilt (H1-A3 proxy: H1 minus the level of the
// harmonic nearest 3 kHz) of the LF flow derivative for the tenseness of
// each preset, against Fant (1995): H1-H2 ~ -7.6 + 11.1 Rd dB. The
// corrected H1*-H2* of women exceeds that of men by 3.1 dB (Hanson and
// Chuang 1999, table X), by 5.7 dB in Klatt and Klatt (1990).
// Usage: node experiments/issue-9-source-spectrum.mjs
import { lfParameters, lfWaveform } from '../src/acoustics/glottis.js';
import { presetHeadConfig } from '../src/head-config.js';

const N = 4096;

function harmonicLevels(tenseness, count) {
  const pulse = lfParameters(tenseness);
  const samples = Array.from({ length: N }, (_, n) => lfWaveform(pulse, n / N));
  return Array.from({ length: count }, (_, index) => {
    const k = index + 1;
    let re = 0;
    let im = 0;
    samples.forEach((value, n) => {
      re += value * Math.cos((2 * Math.PI * k * n) / N);
      im -= value * Math.sin((2 * Math.PI * k * n) / N);
    });
    return 20 * Math.log10(Math.hypot(re, im));
  });
}

for (const name of ['male', 'female', 'child']) {
  const head = presetHeadConfig(name);
  const rd = Math.min(2.7, Math.max(0.5, 3 * (1 - head.tenseness)));
  const third = Math.round(3000 / head.pitch);
  const levels = harmonicLevels(head.tenseness, third);
  console.log(
    `${name}: f0 ${head.pitch.toFixed(0)} Hz, tenseness ${head.tenseness.toFixed(3)}, Rd ${rd.toFixed(2)}, ` +
      `H1-H2 ${(levels[0] - levels[1]).toFixed(1)} dB (Fant ${(-7.6 + 11.1 * rd).toFixed(1)}), ` +
      `H1-H(3 kHz) ${(levels[0] - levels[third - 1]).toFixed(1)} dB, breathiness ${head.breathiness.toFixed(2)}, aspiration ${head.aspirationLevel.toFixed(2)}`
  );
}
for (const tenseness of [0.7, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4]) {
  const levels = harmonicLevels(tenseness, 2);
  console.log(
    `tenseness ${tenseness} Rd ${(3 * (1 - tenseness)).toFixed(2)}: H1-H2 ${(levels[0] - levels[1]).toFixed(1)} dB`
  );
}
