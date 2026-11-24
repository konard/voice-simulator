/** Check whether forward renders can rank an isolated sustained vowel. Unlicense. */
import { planUtterance, presetHeadConfig, renderPlan } from '../src/index.js';
import { VOWELS } from '../src/ipa/inventory.js';
import { mfcc } from '../src/metrics/spectrum.js';

const vowels = Object.keys(VOWELS);
const sampleRate = 16000;
const options = { sampleRate, solver: 'waveguide', engine: 'js' };
const spectralOptions = { window: 0.025, hop: 0.01, coefficients: 12 };

function render(symbol, head, duration, seed) {
  const plan = planUtterance(symbol, { head, durations: [duration] });
  return renderPlan(plan, { ...options, seed });
}

function spectralError(input, reference) {
  let sum = 0;
  const count = Math.min(input.length, reference.length);
  for (let i = 0; i < count; i++) {
    for (let j = 1; j < input[i].length; j++) {
      sum += (input[i][j] - reference[i][j]) ** 2;
    }
  }
  return sum / count / spectralOptions.coefficients;
}

for (const preset of ['male', 'female', 'child']) {
  const head = presetHeadConfig(preset);
  for (const duration of [0.24, 0.3, 0.38]) {
    const candidates = vowels.map((symbol) => ({
      symbol,
      frames: mfcc(
        render(symbol, head, duration, 1),
        sampleRate,
        spectralOptions
      ),
    }));
    for (const seed of [1, 2]) {
      let first = 0;
      let topFive = 0;
      let max = 0;
      for (const symbol of vowels) {
        const frames = mfcc(
          render(symbol, head, duration, seed),
          sampleRate,
          spectralOptions
        );
        const ranks = candidates
          .map((candidate) => ({
            symbol: candidate.symbol,
            cost: spectralError(frames, candidate.frames),
          }))
          .sort((a, b) => a.cost - b.cost);
        const rank = ranks.findIndex((row) => row.symbol === symbol);
        first += Number(rank === 0);
        topFive += Number(rank < 5);
        max = Math.max(max, ranks[0].cost);
      }
      console.log(
        JSON.stringify({
          preset,
          duration,
          seed,
          first,
          topFive,
          max,
          count: vowels.length,
        })
      );
    }
  }
}
