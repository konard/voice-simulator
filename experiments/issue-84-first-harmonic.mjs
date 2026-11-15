/**
 * Issue 84: how much of the RMS of the first [a] and of the [m] of ˈama is
 * the first harmonic? The 50 Hz criterion of the issue keeps the low-
 * frequency flow of [m] equal to that of [a], so the murmur cannot be
 * weaker than the first harmonic of the vowel: the ratio has the floor
 * H1(vowel) / RMS(vowel) unless the vowel's own spectrum changes.
 * The first harmonic is taken by projecting the 30 ms window (the same one
 * as the ratio of the issue) on a sine and cosine at the local f0, found as
 * the strongest component between 70 and 300 Hz. A1 is the strongest
 * harmonic between 400 and 1000 Hz (F1 of [a]).
 *
 *   node experiments/issue-84-first-harmonic.mjs '{"nasalLoss":3}' medium high
 */
import { synthesize } from '../src/index.js';

function window(samples, sampleRate, segment) {
  const centre = Math.round(((segment.start + segment.end) / 2) * sampleRate);
  const half = Math.round(0.015 * sampleRate);
  return samples.subarray(centre - half, centre + half);
}

function component(values, sampleRate, frequency) {
  let re = 0;
  let im = 0;
  for (let index = 0; index < values.length; index++) {
    const phase = (2 * Math.PI * frequency * index) / sampleRate;
    re += values[index] * Math.cos(phase);
    im += values[index] * Math.sin(phase);
  }
  // RMS of a sinusoid of that amplitude.
  return Math.hypot(re, im) / values.length / Math.SQRT1_2;
}

export function firstHarmonic(tier, head = {}) {
  const { samples, sampleRate, plan } = synthesize('ˈama', {
    ipa: true,
    tier,
    seed: 1,
    head,
  });
  const result = {};
  for (const kind of ['vowel', 'consonant']) {
    const segment = plan.segments.find((item) => item.kind === kind);
    const values = window(samples, sampleRate, segment);
    let rms = 0;
    for (const value of values) {
      rms += value * value;
    }
    rms = Math.sqrt(rms / values.length);
    let best = [0, 0];
    for (let frequency = 70; frequency <= 300; frequency += 0.5) {
      const level = component(values, sampleRate, frequency);
      if (level > best[1]) {
        best = [frequency, level];
      }
    }
    // A1: the strongest harmonic in the F1 range of [a].
    let a1 = 0;
    for (let k = 2; k * best[0] <= 1000; k++) {
      if (k * best[0] >= 400) {
        a1 = Math.max(a1, component(values, sampleRate, k * best[0]));
      }
    }
    result[kind] = { rms, f0: best[0], h1: best[1], a1 };
  }
  const { vowel, consonant } = result;
  return {
    vowelRms: vowel.rms,
    vowelH1: vowel.h1,
    vowelF0: vowel.f0,
    nasalRms: consonant.rms,
    nasalH1: consonant.h1,
    nasalF0: consonant.f0,
    ratio: consonant.rms / vowel.rms,
    floor: consonant.h1 / vowel.rms,
    h1Share: vowel.h1 / vowel.rms,
    // H1 - A1 of the vowel (dB); real [a] has A1 above H1 (negative).
    vowelH1A1: 20 * Math.log10(vowel.h1 / vowel.a1),
    // Murmur H1 against vowel H1 (dB).
    nasalH1dB: 20 * Math.log10(consonant.h1 / vowel.h1),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const head = JSON.parse(process.argv[2] ?? '{}');
  for (const tier of process.argv.slice(3)) {
    const values = firstHarmonic(tier, head);
    const rounded = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, +value.toFixed(3)])
    );
    console.log(`${tier} ${JSON.stringify(head)}: ${JSON.stringify(rounded)}`);
  }
}
