/** Time-local mel-cepstral scoring of copy-synthesized readings. Unlicense. */
import { renderPlan } from '../acoustics/voice.js';
import { dtw } from '../metrics/dtw.js';
import {
  cepstra,
  frameSettings,
  mfcc,
  powerFrames,
} from '../metrics/spectrum.js';
import { poolPowerFrames } from './whisper-spectrum.js';

const HOP = 0.01;
const MCD_SCALE = (10 * Math.SQRT2) / Math.LN10;

export function timedCepstra(samples, rate, start, spans = []) {
  const { length, hop } = frameSettings(rate, { hop: HOP });
  const options = { hop: HOP, coefficients: rate < 16000 ? 10 : 13 };
  const center = start + length / (2 * rate);
  const step = hop / rate;
  return {
    start: center,
    step,
    rows: (spans.length
      ? pooledCepstra(samples, rate, options, center, step, spans)
      : mfcc(samples, rate, options)
    ).map((row) => row.subarray(1)),
  };
}

function pooledCepstra(samples, rate, options, center, step, spans) {
  const powers = powerFrames(samples, rate, options);
  const rowAt = (time) =>
    Math.min(
      powers.length,
      Math.max(0, Math.ceil((time - center) / step - 1e-9))
    );
  for (const { start, end } of spans) {
    const from = rowAt(start);
    const to = rowAt(end);
    const pooled = poolPowerFrames(powers.slice(from, to));
    pooled.forEach((row, index) => {
      powers[from + index] = row;
    });
  }
  return cepstra(powers, rate, options);
}

export function renderCepstra(plan, rate, spans) {
  const samples = renderPlan(plan, {
    solver: 'waveguide',
    sampleRate: rate,
    seed: 1,
    engine: 'js',
  });
  return timedCepstra(samples, rate, plan.offset, spans);
}

function nearestIndex({ start, step }, time) {
  return Math.round((time - start) / step);
}

function frameAt(track, time) {
  const index = Math.max(
    0,
    Math.min(track.rows.length - 1, nearestIndex(track, time))
  );
  return track.rows[index];
}

export function recordingBias(recording, reference, frames) {
  const bias = new Float64Array(recording.rows[0].length);
  let count = 0;
  for (const [index, row] of recording.rows.entries()) {
    const time = recording.start + index * recording.step;
    const speech = Math.round((time - frames.startTime) / frames.hop);
    const other = reference.rows[nearestIndex(reference, time)];
    if (!frames.speech[speech] || !other) {
      continue;
    }
    for (let n = 0; n < bias.length; n++) {
      bias[n] += row[n] - other[n];
    }
    count++;
  }
  return count ? bias.map((value) => value / count) : bias;
}

/** Sample MFCCs on the recording's hop grid, with one pair for a sub-hop span. */
export function scoringWindow(track, grid, from, to, start, end) {
  const boundary = (time) => Math.ceil((time - grid.start) / grid.step - 1e-9);
  const first = boundary(from);
  const last = boundary(to);
  if (boundary(start) === boundary(end)) {
    return { rows: [frameAt(track, (start + end) / 2)], first: 0, last: 1 };
  }
  return {
    rows: Array.from({ length: last - first }, (_, index) =>
      frameAt(track, grid.start + (first + index) * grid.step)
    ),
    first: boundary(start) - first,
    last: boundary(end) - first,
  };
}

function distortion(x, y, bias) {
  let squares = 0;
  for (let n = 0; n < bias.length; n++) {
    const delta = x[n] - y[n] - bias[n];
    squares += delta * delta;
  }
  return MCD_SCALE * Math.sqrt(squares);
}

/** Mean bias-corrected mel-cepstral distance of the DTW pairs in the region. */
export function scoreJob(job) {
  const { recording, bias, from, to, start, end, grid } = job;
  const render =
    job.reference ??
    scoringWindow(
      renderCepstra(job.plan, job.rate, job.whisperSpans),
      grid,
      from,
      to,
      start,
      end
    ).rows;
  const distance = (x, y) => distortion(x, y, bias);
  const { path } = dtw(recording.rows, render, { band: 0.1, distance });
  let sum = 0;
  let count = 0;
  for (const [i, j] of path) {
    if (
      i >= recording.first &&
      i < recording.last &&
      j >= recording.first &&
      j < recording.last
    ) {
      sum += distance(recording.rows[i], render[j]);
      count++;
    }
  }
  // A path can skip a short region diagonally across its corners. In that
  // case score only its in-region frames on the shared time grid.
  if (count === 0) {
    for (let i = recording.first; i < recording.last; i++) {
      sum += distance(recording.rows[i], render[i]);
      count++;
    }
  }
  return sum / count;
}
