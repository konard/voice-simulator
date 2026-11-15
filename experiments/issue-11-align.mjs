/**
 * Alignment of a plan with a recording (issue 38, P26 of issue 11): DTW
 * between the 10 ms log-mel frames of the synthesized plan and of the
 * recording, then every segment boundary of the plan is mapped through the
 * DTW path. The result gives the measured duration of every token, which
 * `planUtterance(tokens, {durations})` takes back.
 *
 *   import { alignToRecording } from './issue-11-align.mjs';
 *   const plan = planUtterance(ipa, { head });
 *   const audio = { samples: renderPlan(plan, options), sampleRate };
 *   const { durations, offset } = alignToRecording(plan, audio, recording);
 *
 * Run alone, it aligns the golden recordings and prints the plan length
 * against the recording and the DTW cost before and after re-planning:
 *
 *   node experiments/issue-11-align.mjs [limit per language]
 */

import { pathToFileURL } from 'node:url';

import { dtw } from '../src/metrics/dtw.js';
import { melFilterbank, powerFrames } from '../src/metrics/spectrum.js';

/** Frame hop and window of the alignment, seconds. */
export const ALIGN_HOP = 0.01;
const ALIGN_WINDOW = 0.025;
const MEL_FILTERS = 40;
/** Floor of the log energies, dB below the loudest filter of a signal. */
const FLOOR_DB = 60;

const FILTERBANKS = new Map();

/**
 * Log-mel energies (dB, 40 filters up to 8 kHz) every 10 ms, minus the mean
 * of each filter over the signal, so that the voice and the channel of the
 * two signals matter less than what is said.
 * @param {ArrayLike<number>} samples
 * @param {number} sampleRate
 * @returns {Float64Array[]}
 */
export function logMelFrames(samples, sampleRate) {
  const frames = powerFrames(samples, sampleRate, {
    window: ALIGN_WINDOW,
    hop: ALIGN_HOP,
  });
  if (frames.length === 0) {
    return [];
  }
  const size = (frames[0].length - 1) * 2;
  const key = `${size}/${sampleRate}`;
  if (!FILTERBANKS.has(key)) {
    // Filters up to 8 kHz: a 16 kHz recording has nothing above.
    const top = Math.min(sampleRate, 16000);
    const filters = melFilterbank(MEL_FILTERS, (size * top) / sampleRate, top);
    FILTERBANKS.set(key, filters);
  }
  const filters = FILTERBANKS.get(key);
  let loudest = 0;
  const energies = frames.map((power) => {
    const row = new Float64Array(MEL_FILTERS);
    filters.forEach((weights, filter) => {
      let sum = 0;
      for (let bin = 0; bin < weights.length; bin++) {
        sum += weights[bin] * power[bin];
      }
      row[filter] = sum;
      loudest = Math.max(loudest, sum);
    });
    return row;
  });
  const floor = Math.max(loudest * 10 ** (-FLOOR_DB / 10), 1e-20);
  const mean = new Float64Array(MEL_FILTERS);
  for (const row of energies) {
    for (let filter = 0; filter < MEL_FILTERS; filter++) {
      row[filter] = 10 * Math.log10(Math.max(row[filter], floor));
      mean[filter] += row[filter] / energies.length;
    }
  }
  for (const row of energies) {
    for (let filter = 0; filter < MEL_FILTERS; filter++) {
      row[filter] -= mean[filter];
    }
  }
  return energies;
}

/**
 * Map a time of the synthesized signal to the recording through the path:
 * the mean recording frame of all path cells at that synthesized frame,
 * interpolated between neighbouring frames.
 */
function pathMap(path, frames) {
  const sums = new Float64Array(frames);
  const counts = new Float64Array(frames);
  for (const [i, j] of path) {
    sums[i] += j;
    counts[i]++;
  }
  const mapped = Array.from(sums, (sum, i) => sum / counts[i]);
  return (time) => {
    const position = Math.min(Math.max(time / ALIGN_HOP, 0), frames - 1);
    const below = Math.floor(position);
    const above = Math.min(below + 1, frames - 1);
    const fraction = position - below;
    return (
      (mapped[below] + (mapped[above] - mapped[below]) * fraction) * ALIGN_HOP
    );
  };
}

/**
 * Align a plan with a recording of the same text.
 * @param {{tokens: object[], segments: {token?: object, start: number, end: number}[], duration: number}} plan
 *   The plan that `audio` was rendered from.
 * @param {{samples: ArrayLike<number>, sampleRate: number}} audio
 * @param {{samples: ArrayLike<number>, sampleRate: number}} recording
 * @returns {{durations: (number|null)[], boundaries: number[], offset: number, cost: number, path: [number, number][]}}
 *   `durations`: seconds per token of `plan.tokens` (null for a token
 *   without a segment); `boundaries`: the start of every segment and the
 *   end of the last one, in the recording; `offset`: the aligned start of
 *   the first token minus its start in the plan; `cost`: normalized DTW
 *   cost (dB per frame pair).
 */
export function alignToRecording(plan, audio, recording) {
  const a = logMelFrames(audio.samples, audio.sampleRate);
  const b = logMelFrames(recording.samples, recording.sampleRate);
  const { path, normalizedCost } = dtw(a, b);
  const map = pathMap(path, a.length);
  const boundaries = [
    ...plan.segments.map((segment) => map(segment.start)),
    map(plan.segments.at(-1).end),
  ];
  const durations = plan.tokens.map(() => null);
  const index = new Map(plan.tokens.map((token, at) => [token, at]));
  plan.segments.forEach((segment, at) => {
    const token = index.get(segment.token);
    if (token !== undefined) {
      durations[token] =
        (durations[token] ?? 0) + boundaries[at + 1] - boundaries[at];
    }
  });
  const first = plan.segments.findIndex((segment) => segment.token);
  return {
    durations,
    boundaries,
    offset: first < 0 ? 0 : boundaries[first] - plan.segments[first].start,
    cost: normalizedCost / Math.sqrt(MEL_FILTERS),
    path,
  };
}

async function main() {
  const { loadGolden } = await import('../tests/helpers/golden.js');
  const { planUtterance, presetHeadConfig, renderPlan } =
    await import('../src/index.js');
  const limit = Number(process.argv[2]) || Infinity;
  const counts = {};
  const sampleRate = 16000;
  const render = (plan) => ({
    samples: renderPlan(plan, {
      solver: 'waveguide',
      sections: 22,
      sampleRate,
      head: plan.head,
      seed: 1,
    }),
    sampleRate,
  });
  console.log('id     plan s  recording s  aligned s  cost  cost after');
  for (const item of loadGolden()) {
    counts[item.lang] = (counts[item.lang] ?? 0) + 1;
    if (counts[item.lang] > limit) {
      continue;
    }
    const head = presetHeadConfig(
      item.speaker.sex === 'male' ? 'male' : 'female'
    );
    const plan = planUtterance(item.ipa, { head, language: item.lang });
    const aligned = alignToRecording(plan, render(plan), item);
    const again = planUtterance(plan.tokens, {
      head,
      language: item.lang,
      durations: aligned.durations,
    });
    const after = alignToRecording(again, render(again), item);
    console.log(
      [
        item.id.padEnd(6),
        plan.duration.toFixed(2).padStart(6),
        (item.samples.length / item.sampleRate).toFixed(2).padStart(11),
        again.duration.toFixed(2).padStart(9),
        aligned.cost.toFixed(2).padStart(5),
        after.cost.toFixed(2).padStart(10),
      ].join('  ')
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
