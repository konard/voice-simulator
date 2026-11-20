/** Bounded, oral-tract analysis-by-synthesis. Unlicense. */
import { tractShape } from '../articulation/tract-shape.js';
import { simplex } from '../analysis/voice-fit-simplex.js';
import {
  CODEBOOK_CHANNELS,
  frameEnvelope,
  GRID,
  tractResponse,
} from './codebook.js';
import { normalizeEnvelope, renderedResponse } from './codebook-features.js';
import { TRACT_WIDTH } from './inversion-search.js';

const REFINED = [0, 1, 2, 7, 9, 8];

function envelopeDistance(model, observed) {
  let sum = 0;
  let count = 0;
  for (let j = 0; j < model.length; j++) {
    if (Number.isFinite(observed[j])) {
      sum += (model[j] - observed[j]) ** 2;
      count++;
    }
  }
  return count ? sum / count : Infinity;
}

function refineFrame(track, frames, t, book, steps, { grid, scratch }) {
  const state = Object.fromEntries(
    CODEBOOK_CHANNELS.map(({ name }) => [name, track.channels[name][t]])
  );
  const start = REFINED.map((c) => {
    const { name, min, max } = CODEBOOK_CHANNELS[c];
    return (state[name] - min) / (max - min);
  });
  frameEnvelope(frames, t, book, scratch);
  const model = new Float64Array(GRID.length);
  function evaluate(point) {
    let penalty = 0;
    REFINED.forEach((c, j) => {
      const { name, min, max } = CODEBOOK_CHANNELS[c];
      state[name] = min + point[j] * (max - min);
      penalty += (((point[j] - start[j]) * (max - min)) / (2 * steps[c])) ** 2;
    });
    if (frames.whisper?.[t]) {
      renderedResponse({ ...state, whisper: 1 }, track.head, model, grid);
    } else {
      const { areas, length } = tractShape(state, track.head);
      tractResponse(areas, length, grid, model);
    }
    normalizeEnvelope(model);
    return { cost: envelopeDistance(model, scratch.envelope) / 16 + penalty };
  }
  const search = simplex(start, evaluate, 60, 0.05);
  let next = search.next();
  while (!next.done) {
    next = search.next();
  }
  return next.value[0].x;
}

export function refineArticulation(frames, track, book, steps, smoother) {
  const grid = Float64Array.from(GRID, (f) => f / book.lengthScale);
  const scratch = {
    envelope: new Float64Array(GRID.length),
    key: new Float64Array(6),
  };
  const context = { grid, scratch };
  let periodic = 0;
  for (let t = 0; t < track.frameCount; t++) {
    if (
      !frames.speech[t] ||
      (!frames.whisper?.[t] && frames.periodicity[t] < 0.45)
    ) {
      continue;
    }
    if (
      periodic++ % 4 ||
      track.channels.velum[t] >= 0.1 ||
      !track.candidates.count[t]
    ) {
      continue;
    }
    const x = refineFrame(track, frames, t, book, steps, context);
    REFINED.forEach((c, j) => {
      const { min, max } = CODEBOOK_CHANNELS[c];
      smoother.values[t * TRACT_WIDTH + c] = min + x[j] * (max - min);
    });
    smoother.remeasure(t);
  }
}
