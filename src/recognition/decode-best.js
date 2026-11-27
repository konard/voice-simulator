/** Single-best segmental Viterbi search without a lattice. Unlicense. */
import { WHISPER_WEIGHTS } from './whisper-decode.js';

const MISSING = -1;
const ORIGIN = -2;
const PAUSE = 2;

// Index each state by boundary and final phone, including the pause sentinel.
// Only surviving paths need JS objects and links for the streaming consensus.
export function createBestSearchWorkspace() {
  const buffers = { compare: (a, b) => buffers.cost[a] - buffers.cost[b] };
  return (cells, width) => {
    if (!buffers.previous || buffers.previous.length < cells) {
      const capacity = Math.max(cells, (buffers.previous?.length ?? 0) * 2);
      buffers.previous = new Int32Array(capacity);
      buffers.cost = new Float64Array(capacity);
      buffers.arcCost = new Float64Array(capacity);
      buffers.confidence = new Float64Array(capacity);
      buffers.kind = new Uint8Array(capacity);
    }
    if (buffers.acoustic?.length !== width) {
      buffers.parents = new Int32Array(width + 1);
      buffers.acoustic = new Float64Array(width);
    }
    buffers.previous.fill(MISSING, 0, cells);
    return buffers;
  };
}

function collectParents(
  { previous, cost, parents, compare },
  row,
  stride,
  beam
) {
  let count = 0;
  let unordered = false;
  for (let id = row; id < row + stride; id++) {
    if (previous[id] !== MISSING) {
      parents[count++] = id;
      unordered ||= Number.isNaN(cost[id]);
    }
  }
  if (unordered) {
    // Match the generic stable sort even when a caller supplies NaN scores.
    const ids = Array.from(parents.subarray(0, count));
    ids.sort(compare);
    parents.set(ids);
  } else if (count > 1) {
    parents.subarray(0, count).sort(compare);
  }
  return Math.min(count, beam);
}

function pauseSuccessor(buffers, target, count) {
  const { previous, cost, kind, parents } = buffers;
  for (let i = 0; i < count; i++) {
    const parent = parents[i];
    if (previous[target] === MISSING || !(cost[parent] >= cost[target])) {
      previous[target] = parent;
      cost[target] = cost[parent];
      kind[target] = PAUSE;
    }
  }
}

export function fillAcoustic(acoustic, terms, weights) {
  let minimum = Infinity;
  for (let unit = 0; unit < acoustic.length; unit++) {
    const offset = 3 * unit;
    const score =
      terms[offset] +
      weights.duration * terms[offset + 1] +
      weights.class * terms[offset + 2];
    acoustic[unit] = score;
    minimum = Math.min(minimum, score);
  }
  return minimum;
}

function phoneSuccessors(buffers, span, search) {
  const { previous, cost, parents, arcCost, confidence, kind, acoustic } =
    buffers;
  const { stride, count, transitions, uniform, weights } = search;
  const width = stride - 1;
  const start = span.to * stride;
  const minimum = fillAcoustic(acoustic, span.terms, weights);
  let denominator = 0;
  for (let unit = 0; unit < width; unit++) {
    denominator += Math.exp(minimum - acoustic[unit]);
  }
  for (let unit = 0; unit < width; unit++) {
    const target = start + unit;
    const score = acoustic[unit];
    const limit = uniform && Number.isFinite(score) ? 1 : count;
    let best = previous[target] === MISSING ? NaN : cost[target];
    let source = MISSING;
    let edge = 0;
    for (let i = 0; i < limit; i++) {
      const parent = parents[i];
      const row = (parent % stride) * width;
      const next = score + weights.phonotactic * transitions[row + unit];
      const total = cost[parent] + next;
      if (!(total >= best)) {
        source = parent;
        edge = next;
        best = total;
      }
    }
    if (source !== MISSING) {
      previous[target] = source;
      cost[target] = best;
      arcCost[target] = edge;
      confidence[target] = Math.exp(minimum - score) / denominator;
      kind[target] = span.long?.[unit] ? 1 : 0;
    }
  }
}

function openPaths(buffers, stride, origin) {
  const { previous, cost, arcCost, confidence, kind } = buffers;
  const opened = new Map([[origin, { cost: 0, sequence: { children: [] } }]]);
  const trace = [];
  return (end) => {
    if (end === MISSING) {
      return undefined;
    }
    let index = end;
    while (!opened.has(index)) {
      trace.push(index);
      index = previous[index];
    }
    let path = opened.get(index);
    while (trace.length > 0) {
      index = trace.pop();
      const from = Math.floor(previous[index] / stride);
      const to = Math.floor(index / stride);
      const unit = index % stride;
      const arc =
        kind[index] === PAUSE
          ? { from, to, unit, cost: 0, confidence: 1, pause: true }
          : {
              from,
              to,
              unit,
              cost: arcCost[index],
              confidence: confidence[index],
              long: kind[index] === 1,
            };
      path = { previous: path, arc, cost: cost[index] };
      opened.set(index, path);
    }
    return path;
  };
}

function connectSpans(buffers, search, spans, voicedWeights, uniform) {
  for (const span of spans) {
    if (span.pause) {
      const target = span.to * search.stride + search.stride - 1;
      pauseSuccessor(buffers, target, search.count);
    } else {
      search.weights = span.whisper ? WHISPER_WEIGHTS : voicedWeights;
      search.uniform = uniform && Number.isFinite(search.weights.phonotactic);
      phoneSuccessors(buffers, span, search);
    }
  }
}

export function decodeBest(prepared, language, options) {
  const { times, spans } = prepared;
  const width = language.symbols.length;
  const { beam, weights, lastUnit = width } = options;
  const stride = width + 1;
  const edges = [];
  const frontier = [];
  if (!times.length) {
    return { edges, paths: [], frontier };
  }
  const workspace = options.bestSearchWorkspace ?? createBestSearchWorkspace();
  const buffers = workspace(times.length * stride, width);
  const { previous, cost, parents } = buffers;
  previous[lastUnit] = ORIGIN;
  cost[lastUnit] = 0;
  const transitions = language.costs;
  const uniformTransitions = transitions.every((value) => value === 0);
  const search = { stride, transitions, count: 0, uniform: false, weights };
  let terminal = MISSING;
  let provisional = MISSING;
  for (let from = 0; from < times.length; from++) {
    const count = collectParents(buffers, from * stride, stride, beam);
    if (!count) {
      continue;
    }
    provisional = parents[0];
    if (times.at(-1) - times[from] <= 0.4 && times.length - from <= 5) {
      for (let i = 0; i < count; i++) {
        frontier.push(parents[i]);
      }
    }
    if (from === times.length - 1) {
      terminal = provisional;
      break;
    }
    search.count = count;
    let uniform = uniformTransitions;
    for (let i = 0; uniform && i < count; i++) {
      uniform = !Number.isNaN(cost[parents[i]]);
    }
    connectSpans(buffers, search, spans[from], weights, uniform);
  }
  const open = openPaths(buffers, stride, lastUnit);
  return {
    edges,
    paths: terminal === MISSING ? [] : [open(terminal)],
    frontier: frontier.map(open),
    provisional: open(provisional),
  };
}
