/** Candidate scoring and temporal search for acoustic inversion. Unlicense. */
import { CHANNELS } from '../articulation/plan.js';
import { CODEBOOK_CHANNELS, frameEnvelope } from './codebook.js';
import { L0 } from './codebook-features.js';
import { whisperCodebook } from './whisper-codebook.js';

export const TRACT_WIDTH = CODEBOOK_CHANNELS.length;
export const CLOSURE_CANDIDATES = 32;

export function tractSteps(voice, frameRate) {
  return Float64Array.from(
    CODEBOOK_CHANNELS,
    ({ name, min, max }) =>
      -0.5 *
      (max - min) *
      Math.expm1(-voice.articulationSpeed / (CHANNELS[name] * frameRate))
  );
}

function transitionWeights(steps, smoothness) {
  return Float64Array.from(steps, (step, i) => {
    const { min, max } = CODEBOOK_CHANNELS[i];
    return smoothness * ((max - min) / (255 * step)) ** 2;
  });
}

/** Squared distance in units of one planner step, on the quantized grid. */
function movement(a, b, table, weights) {
  let sum = 0;
  a *= TRACT_WIDTH;
  b *= TRACT_WIDTH;
  for (let c = 0; c < TRACT_WIDTH; c++) {
    const delta = table[a + c] - table[b + c];
    sum += delta * delta * weights[c];
  }
  return sum;
}

function isClosure(table, row) {
  const i = row * TRACT_WIDTH;
  const lip = table[i + 5] > 127 && (table[i + 6] * 2) / 255 < 0.05;
  const tongue = table[i + 7] > 127 && (table[i + 8] * 2) / 255 < 0.05;
  return lip || tongue;
}

function closureSeeds(book) {
  const { neutral, vowel, nasalVowel, consonant } = book.stats.rows;
  const end = neutral + vowel + nasalVowel + consonant;
  const seeds = [];
  for (let row = 0; row < end; row++) {
    if (isClosure(book.articulation, row)) {
      seeds.push(row);
    }
  }
  return seeds;
}

function localCost(row, t, envelopeCost, frames, formants, book) {
  const scale = book.lengthScale;
  // Stored formants are in physical Hz for the book's rounded build length.
  // Move them onto the same 16.5 cm axis as the scaled observations.
  const referenceScale = book.referenceLength / L0;
  const weight =
    frames.whisper?.[t] || frames.periodicity[t] >= 0.45 ? 1 : 0.25;
  let cost = envelopeCost / 16;
  for (let k = 0; k < 3; k++) {
    const i = t * 4 + k;
    const reference = referenceScale * book.formants[row * 8 + k];
    if (formants.valid[i] && reference > 0) {
      const delta = scale * formants.frequency[i] - reference;
      const variance =
        scale * scale * formants.variance[i] + (0.03 * reference) ** 2;
      cost += (delta * delta) / variance;
    }
  }
  return weight * cost;
}

function scoreSpeech(t, { frames, formants, book, k, scratch, candidates }) {
  const { width, count, index, cost } = candidates;
  frameEnvelope(frames, t, book, scratch);
  book.query(scratch.envelope, k, scratch.query);
  const start = t * width;
  let best = -1;
  for (let j = 0; j < k && scratch.query.index[j] >= 0; j++) {
    const row = scratch.query.index[j];
    index[start + j] = row;
    cost[start + j] = localCost(
      row,
      t,
      scratch.query.cost[j],
      frames,
      formants,
      book
    );
    count[t]++;
    if (best < 0 || cost[start + j] < cost[start + best]) {
      best = j;
    }
  }
  return best < 0 ? -1 : index[start + best];
}

function nearestClosures(row, seeds, table, weights) {
  if (row < 0) {
    return [];
  }
  return seeds
    .map((index) => ({ index, cost: movement(index, row, table, weights) }))
    .sort((a, b) => a.cost - b.cost || a.index - b.index)
    .slice(0, CLOSURE_CANDIDATES)
    .map(({ index }) => index);
}

/** Costs only need the last row. Back-pointers use a bounded ring in a stream. */
function viterbi(candidates, table, weights, history) {
  const { width, count, index, cost } = candidates;
  const back = new Int8Array(history * width);
  const winner = new Int8Array(history);
  let previous = new Float64Array(width);
  let current = new Float64Array(width);

  return {
    step(t) {
      const older = t ? count[t - 1] : 0;
      const start = t * width;
      const slot = (t % history) * width;
      let best = -1;
      for (let j = 0; j < count[t]; j++) {
        let predecessor = -1;
        let lowest = Infinity;
        for (let i = 0; i < older; i++) {
          const score =
            previous[i] +
            movement(
              index[start - width + i],
              index[start + j],
              table,
              weights
            );
          if (score < lowest) {
            lowest = score;
            predecessor = i;
          }
        }
        back[slot + j] = predecessor;
        current[j] = cost[start + j] + (predecessor < 0 ? 0 : lowest);
        if (best < 0 || current[j] < current[best]) {
          best = j;
        }
      }
      winner[t % history] = best;
      const baseline = current[best];
      for (let j = 0; j < count[t]; j++) {
        current[j] -= baseline;
      }
      [previous, current] = [current, previous];
    },
    trace(first, end, path) {
      let j = -1;
      for (let t = end - 1; t >= first; t--) {
        const slot = t % history;
        j = j < 0 ? winner[slot] : j;
        path[t] = j;
        j = j < 0 ? -1 : back[slot * width + j];
      }
    },
  };
}

export function createTractSearch(
  frames,
  formants,
  book,
  settings,
  steps,
  { candidates, history, head }
) {
  const table = book.articulation;
  const weights = transitionWeights(steps, 1);
  const seeds = closureSeeds(book);
  const scratch = {
    envelope: new Float64Array(24),
    key: new Float64Array(6),
    query: {
      index: new Int32Array(settings.candidates),
      cost: new Float64Array(settings.candidates),
    },
  };
  const context = {
    frames,
    formants,
    book,
    k: settings.candidates,
    scratch,
    candidates,
  };
  const search = viterbi(
    candidates,
    table,
    Float64Array.from(weights, (w) => w * settings.smoothness),
    history
  );
  let bestSpeech = -1;
  let quietBook;

  return {
    speech(t) {
      context.book = frames.whisper?.[t]
        ? (quietBook ??= whisperCodebook(book, head))
        : book;
      bestSpeech = scoreSpeech(t, context);
      search.step(t);
    },
    gap(first, end, closure, scored) {
      const rows = closure
        ? nearestClosures(bestSpeech, seeds, table, weights)
        : [];
      for (let t = first; t < end; t++) {
        const start = t * candidates.width;
        candidates.count[t] = rows.length;
        candidates.index.set(rows, start);
        candidates.cost.fill(0, start, start + rows.length);
        search.step(t);
        scored(t + 1);
      }
    },
    trace: search.trace,
  };
}
