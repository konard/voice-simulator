/** Random-walk filter and Rauch–Tung–Striebel smoother. Unlicense. */
import { CHANNEL_DEFAULTS } from '../articulation/plan.js';
import { CODEBOOK_CHANNELS } from './codebook.js';
import { TRACT_WIDTH } from './inversion-search.js';

function weightCandidates({ count, cost, width }, t, weights) {
  const start = t * width;
  let min = Infinity;
  for (let j = 0; j < count[t]; j++) {
    min = Math.min(min, cost[start + j]);
  }
  let sum = 0;
  for (let j = 0; j < count[t]; j++) {
    weights[j] = Math.exp((min - cost[start + j]) * 0.5);
    sum += weights[j];
  }
  for (let j = 0; j < count[t]; j++) {
    weights[j] /= sum;
  }
}

function measure(
  t,
  chosen,
  book,
  candidates,
  { weights, values, observation }
) {
  const table = book.articulation;
  const row = candidates.index[t * candidates.width + chosen];
  const start = t * TRACT_WIDTH;
  weightCandidates(candidates, t, weights);
  for (let c = 0; c < TRACT_WIDTH; c++) {
    const { min, max } = CODEBOOK_CHANNELS[c];
    const scale = (max - min) / 255;
    const code = table[row * TRACT_WIDTH + c];
    let variance = 0;
    for (let j = 0; j < candidates.count[t]; j++) {
      const other = candidates.index[t * candidates.width + j];
      const delta = table[other * TRACT_WIDTH + c] - code;
      variance += weights[j] * delta * delta;
    }
    values[start + c] = min + code * scale;
    observation[start + c] = Math.max(variance, 5.1 ** 2) * scale * scale;
  }
}

function filter(t, path, process, { values, observation, mean, filtered }) {
  const start = t * TRACT_WIDTH;
  for (let c = 0; c < TRACT_WIDTH; c++) {
    const i = start + c;
    const prev = i - TRACT_WIDTH;
    const z = values[i];
    const r = observation[i];
    if (t === 0 || path[t - 1] < 0) {
      mean[i] = z;
      filtered[i] = r;
      continue;
    }
    const p = filtered[prev] + process[c];
    const gain = p / (p + r);
    mean[i] = mean[prev] + gain * (z - mean[prev]);
    filtered[i] = (1 - gain) * p;
  }
}

export function createTractSmoother(track, book, steps, path) {
  const { channels, variance, candidates } = track;
  const size = path.length * TRACT_WIDTH;
  const mean = new Float64Array(size);
  const filtered = new Float64Array(size);
  const values = new Float64Array(size);
  const observation = new Float64Array(size);
  const weights = new Float64Array(candidates.width);
  const process = Float64Array.from(steps, (step) => step * step);
  const measured = new Int8Array(path.length).fill(-1);
  const toGap = new Int32Array(path.length);
  const state = { weights, values, observation, mean, filtered };

  function distancesToGap(first, end) {
    let remaining = Infinity;
    for (let t = end - 1; t >= first; t--) {
      remaining = path[t] < 0 ? 0 : remaining + 1;
      toGap[t] = Math.min(remaining, path.length + 1);
    }
  }

  // Project the RTS means onto the planner's allowed motion. A known cut
  // bounds the approach to neutral from the left as well as the departure.
  function limitMovement(first, last) {
    for (let c = 0; c < TRACT_WIDTH; c++) {
      const { name } = CODEBOOK_CHANNELS[c];
      const channel = channels[name];
      const neutral = CHANNEL_DEFAULTS[name];
      const delta = (3 - 1e-5) * steps[c];
      for (let t = first; t < last; t++) {
        const bound = toGap[t] * delta;
        const target = Math.max(
          neutral - bound,
          Math.min(neutral + bound, channel[t])
        );
        channel[t] =
          t && path[t] >= 0
            ? Math.max(
                channel[t - 1] - delta,
                Math.min(channel[t - 1] + delta, target)
              )
            : target;
      }
    }
  }

  function forward(first, end) {
    for (let t = first; t < end; t++) {
      if (path[t] < 0) {
        continue;
      }
      if (measured[t] !== path[t]) {
        measured[t] = path[t];
        measure(t, path[t], book, candidates, state);
      }
      filter(t, path, process, state);
    }
  }

  function backward(first, last, end) {
    for (let c = 0; c < TRACT_WIDTH; c++) {
      const { name } = CODEBOOK_CHANNELS[c];
      const channel = channels[name];
      const uncertainty = variance[name];
      let x = 0;
      let p = 0;
      for (let t = end - 1; t >= first; t--) {
        const at = t * TRACT_WIDTH + c;
        if (path[t] < 0) {
          x = CHANNEL_DEFAULTS[name];
          p = Infinity;
        } else if (t === end - 1 || path[t + 1] < 0) {
          x = mean[at];
          p = filtered[at];
        } else {
          const predicted = filtered[at] + process[c];
          const gain = filtered[at] / predicted;
          x = mean[at] + gain * (x - mean[at]);
          p = filtered[at] + gain * gain * (p - predicted);
        }
        if (t < last) {
          channel[t] = x;
          uncertainty[t] = p;
        }
      }
    }
  }

  return {
    values,
    smooth(first, last, end) {
      forward(first, end);
      backward(first, last, end);
      distancesToGap(first, end);
      limitMovement(first, last);
    },
  };
}
