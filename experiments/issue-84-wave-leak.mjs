/**
 * Issue 84: nose flow against lip flow of the waveguide for a static [a] of
 * ˈama with a nearly closed port (velumArea 0.04 by default), per band, from
 * the impulse response (0.3 s),.
 *
 *   node experiments/issue-84-wave-leak.mjs [velumArea] [nasalLoss]
 */
import { normalizeHeadConfig } from '../src/head-config.js';
import { tubeTransfer } from '../src/acoustics/transfer.js';
import {
  impulseSpectrum,
  staticShape,
  tubeOptions,
  waveguideResponse,
} from './issue-84-resonance.mjs';

const velumArea = Number(process.argv[2] ?? 0.04);
const head = normalizeHeadConfig(
  process.argv[3] ? { nasalLoss: Number(process.argv[3]) } : {}
);
const shape = { ...staticShape('vowel', head), velumArea };
const lips = [];
const nose = [];
const { rate } = waveguideResponse(shape, head, 0.3, (solver) => {
  lips.push(solver.lipOutput);
  nose.push(solver.noseOutput);
});
const BANDS = [
  [20, 100],
  [100, 400],
  [400, 1000],
  [1000, 3000],
];
const frequencies = [];
for (let f = 20; f < 3000; f += 10) {
  frequencies.push(f);
}
const lipSpectrum = impulseSpectrum(lips, rate, frequencies);
const noseSpectrum = impulseSpectrum(nose, rate, frequencies);
const sum = (values, low, high) =>
  values.reduce(
    (total, value, index) =>
      frequencies[index] >= low && frequencies[index] < high
        ? total + value
        : total,
    0
  );
for (const [low, high] of BANDS) {
  const ratio = Math.sqrt(
    sum(noseSpectrum, low, high) / sum(lipSpectrum, low, high)
  );
  console.log(`${low}-${high} Hz waveguide nose/lips ${ratio.toFixed(3)}`);
}

// The tube model: nostril against lip flow, averaged in power per band,
// with the nose losses of the round tube and three times those.
const options = tubeOptions(shape, head);
const flows = (output, scale) =>
  frequencies.map(
    (f) =>
      tubeTransfer(shape.areas, shape.length, f, {
        ...options,
        nose: { ...options.nose, loss: 2e-5 * scale },
        output,
      }) ** 2
  );
for (const scale of [1, head.nasalLoss]) {
  const tubeNose = flows('nostrils', scale);
  const tubeLips = flows('lips', scale);
  for (const [low, high] of BANDS) {
    const ratio = Math.sqrt(
      sum(tubeNose, low, high) / sum(tubeLips, low, high)
    );
    console.log(
      `${low}-${high} Hz tube (nose loss x${scale}) nose/lips ${ratio.toFixed(3)}`
    );
  }
}

// Weighted by the noise of the test (white, two-pole Butterworth low-pass
// at 1 kHz): the RMS ratio the test measures.
const lowPass = frequencies.map((f) => 1 / (1 + (f / 1000) ** 4));
const weighted = (nose, lips) =>
  Math.sqrt(
    nose.reduce((total, value, index) => total + value * lowPass[index], 0) /
      lips.reduce((total, value, index) => total + value * lowPass[index], 0)
  ).toFixed(3);
console.log(
  `noise-weighted nose/lips: waveguide ${weighted(noseSpectrum, lipSpectrum)}` +
    `, tube x1 ${weighted(flows('nostrils', 1), flows('lips', 1))}` +
    `, tube x${head.nasalLoss} ${weighted(flows('nostrils', head.nasalLoss), flows('lips', head.nasalLoss))}`
);
