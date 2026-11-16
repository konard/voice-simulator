/**
 * Shared setup of the adaptive stream tests and the issue 29 experiment:
 * 1 s plans of one sustained phone, renderers of an audio tier on an
 * engine, and a stream that asks for its switches at given times.
 */

import { planUtterance } from '../../src/articulation/plan.js';
import { AdaptiveStream } from '../../src/engine/adaptive-stream.js';
import { AUDIO_TIERS } from '../../src/perf/lod.js';
import { prepareUtterance } from '../../src/synthesize.js';

/** Index of an audio tier by name. */
export function tierIndex(name) {
  return AUDIO_TIERS.findIndex((tier) => tier.name === name);
}

/**
 * A plan of 1 s of the phone `ipa` (60 ms before it and a 200 ms release
 * after it: 1.26 s). F0 stays within 6 % of 134 Hz up to 0.6 s; with a
 * whole plan of 1 s (a phone of 0.74 s) it already falls to 98 Hz there
 * and the level of one tier relative to another follows the harmonics
 * through the formants (experiments/issue-29-level-drift.mjs).
 */
export function sustainedPlan(ipa) {
  return planUtterance(ipa, { durations: [1] });
}

/** Render options of tier `level` for `plan` (seed 1). */
export function tierOptions(plan, level) {
  const { renderOptions } = prepareUtterance('a', {
    ipa: true,
    tier: level,
    seed: 1,
  });
  return { ...renderOptions, head: plan.head ?? renderOptions.head };
}

/**
 * Stream `plan` from tier `level` at `streamRate`; `requests` is a list
 * of `{time, level}` asked for when the stream reaches `time`.
 * @returns {Promise<{samples: Float32Array, stream: AdaptiveStream, accepted: boolean[]}>}
 */
export async function streamPlan(engine, plan, level, options = {}) {
  const { streamRate = 48000, requests = [], chunk = 1024, ...rest } = options;
  const stream = new AdaptiveStream({
    createRenderer: (tier, extra) =>
      engine.createRenderer(plan, { ...tierOptions(plan, tier), ...extra }),
    level,
    streamRate,
    ...rest,
  });
  await stream.ready;
  const samples = new Float32Array(stream.totalSamples);
  const pending = [...requests];
  const accepted = [];
  try {
    while (!stream.done) {
      while (
        pending.length > 0 &&
        stream.position >= pending[0].time * streamRate
      ) {
        accepted.push(stream.setLevel(pending.shift().level));
      }
      const next =
        pending.length > 0 ? Math.ceil(pending[0].time * streamRate) : Infinity;
      const end = Math.min(stream.position + chunk, next, samples.length);
      const written = await stream.render(
        samples.subarray(stream.position, Math.max(end, stream.position + 1))
      );
      if (written === 0) {
        break;
      }
    }
  } finally {
    stream.close();
  }
  return { samples, stream, accepted };
}

export function rms(samples, from, to) {
  let sum = 0;
  for (let index = from; index < to; index++) {
    sum += samples[index] * samples[index];
  }
  return Math.sqrt(sum / Math.max(1, to - from));
}

export function db(ratio) {
  return 20 * Math.log10(ratio);
}

/** Largest |x[i+1] - x[i]| over [from, to). */
export function largestStep(samples, from, to) {
  let largest = 0;
  for (let index = from + 1; index < to; index++) {
    largest = Math.max(largest, Math.abs(samples[index] - samples[index - 1]));
  }
  return largest;
}

/**
 * Normalised cross-correlation of a[from, to) with b shifted by up to
 * `maxLag` samples: `{correlation, lag}` of the best lag.
 */
export function bestCorrelation(a, b, from, to, maxLag) {
  let best = { correlation: -Infinity, lag: 0 };
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let ab = 0;
    let aa = 0;
    let bb = 0;
    for (let index = from; index < to; index++) {
      const x = a[index];
      const y = b[index + lag] ?? 0;
      ab += x * y;
      aa += x * x;
      bb += y * y;
    }
    const correlation = ab / Math.sqrt(aa * bb);
    if (correlation > best.correlation) {
      best = { correlation, lag };
    }
  }
  return best;
}
