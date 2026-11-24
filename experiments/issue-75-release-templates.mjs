/** Compare place-of-articulation evidence in stop releases. Unlicense. */
import { randomHeadConfig, synthesize } from '../src/index.js';
import { mfcc } from '../src/metrics/spectrum.js';

const stops = ['p', 't', 'k'];
const vowels = ['a', 'i', 'u', 'ɛ'];
const cepstrum = { window: 0.01, hop: 0.005, coefficients: 9 };

function feature(samples, rate, from, to) {
  return mfcc(
    samples.subarray(Math.round(from * rate), Math.round(to * rate)),
    rate,
    cepstrum
  ).map((frame) => frame.subarray(1));
}

function recording({ tier, preset, headSeed, seed, before, stop, after }) {
  const { samples, sampleRate, plan } = synthesize(`${before}${stop}${after}`, {
    ipa: true,
    head: randomHeadConfig(headSeed, { preset }),
    tier,
    seed,
    engine: 'js',
  });
  const release = plan.segments.findLast(
    ({ token }) => token?.symbol === stop
  ).end;
  return {
    preset,
    context: before + after,
    stop,
    contours: [-0.01, -0.005, 0, 0.005, 0.01].map((offset) => ({
      burst: feature(
        samples,
        sampleRate,
        release + offset - 0.02,
        release + offset + 0.015
      ),
      vowel: feature(
        samples,
        sampleRate,
        release + offset + 0.03,
        release + offset + 0.065
      ),
    })),
  };
}

function distance(a, b, section) {
  return a.burst.reduce(
    (sum, frame, i) =>
      sum +
      frame.reduce((total, coefficient, j) => {
        const burst = coefficient - b.burst[i][j];
        const vowel = a.vowel[i][j] - b.vowel[i][j];
        return total + (section === 'burst' ? burst : burst - vowel) ** 2;
      }, 0),
    0
  );
}

function predict(reference, candidates, section, shift) {
  return candidates.reduce(
    (best, candidate) => {
      const cost = Math.min(
        ...candidate.contours
          .slice(2 - shift, 3 + shift)
          .map((contour) => distance(reference.contours[2], contour, section))
      );
      return cost < best.cost ? { cost, stop: candidate.stop } : best;
    },
    { cost: Infinity }
  ).stop;
}

for (const tier of ['telephone', 'wideband']) {
  const samplesFor = (headSeed, seed) =>
    ['male', 'female'].flatMap((preset) =>
      vowels.flatMap((before, index) =>
        stops.flatMap((stop) =>
          [before, vowels[(index + 1) % vowels.length]].map((after) =>
            recording({ tier, preset, headSeed, seed, before, stop, after })
          )
        )
      )
    );
  const references = samplesFor(1, 1);
  const control = samplesFor(1, 2);
  const heldOut = samplesFor(2, 2);
  const sameContext = (a, b) =>
    a.preset === b.preset && a.context === b.context;
  for (const [name, observed, select] of [
    ['same head and vowels', control, sameContext],
    ['different heads', heldOut, sameContext],
    ['different heads and vowels', heldOut, (a, b) => a.context !== b.context],
  ]) {
    for (const section of ['burst', 'vowel difference']) {
      for (const shift of [0, 2]) {
        const counts = Object.fromEntries(
          stops.map((stop) => [stop, { hits: 0, count: 0 }])
        );
        for (const sample of observed) {
          const predicted = predict(
            sample,
            references.filter((entry) => select(sample, entry)),
            section,
            shift
          );
          counts[sample.stop].count++;
          counts[sample.stop].hits += Number(predicted === sample.stop);
        }
        console.log(
          JSON.stringify({ tier, name, section, shiftMs: shift * 5, counts })
        );
      }
    }
  }
}
