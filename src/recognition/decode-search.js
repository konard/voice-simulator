/** Segmental Viterbi search over candidate boundaries and final phone IDs. Unlicense. */
import { WHISPER_WEIGHTS } from './whisper-decode.js';

function comparePaths(a, b) {
  return a.cost - b.cost;
}

function addPath(paths, previous, arc, cost, limit) {
  if (paths.length === limit && cost >= paths[paths.length - 1].cost) {
    return;
  }
  if (limit === 1) {
    paths[0] = { previous, arc, cost };
    return;
  }
  const children = previous.sequence.children;
  const sequence = arc.pause
    ? previous.sequence
    : (children[arc.unit] ?? (children[arc.unit] = { children: [] }));
  const duplicate = paths.findIndex((path) => path.sequence === sequence);
  if (duplicate >= 0) {
    if (paths[duplicate].cost <= cost) {
      return;
    }
    paths.splice(duplicate, 1);
  }
  const position = paths.findIndex((path) => path.cost > cost);
  paths.splice(position < 0 ? paths.length : position, 0, {
    previous,
    arc,
    sequence,
    cost,
  });
  if (paths.length > limit) {
    paths.pop();
  }
}

function stateFor(states, unit) {
  let state = states[unit];
  if (!state) {
    state = { unit, paths: [], edges: null };
    states[unit] = state;
  }
  return state;
}

function acousticCosts(terms, weights) {
  const scores = new Float64Array(terms.length / 3);
  let minimum = Infinity;
  for (let u = 0; u < scores.length; u++) {
    const offset = 3 * u;
    scores[u] =
      terms[offset] +
      weights.duration * terms[offset + 1] +
      weights.class * terms[offset + 2];
    minimum = Math.min(minimum, scores[u]);
  }
  const denominator = scores.reduce(
    (sum, value) => sum + Math.exp(minimum - value),
    0
  );
  return { scores, minimum, denominator };
}

function connectBest(states, parents, span, from, settings, weights) {
  const { width, costs } = settings;
  const { scores, minimum, denominator } = acousticCosts(span.terms, weights);
  for (let unit = 0; unit < width; unit++) {
    const state = stateFor(states, unit);
    const acoustic = scores[unit];
    let best = state.paths[0]?.cost ?? Infinity;
    let hasBest = state.paths.length > 0;
    let arcCost = 0;
    let previous;
    for (const parent of parents) {
      const candidate = parent.paths[0];
      const cost =
        acoustic + weights.phonotactic * costs[parent.unit * width + unit];
      const total = candidate.cost + cost;
      if (!hasBest || !(total >= best)) {
        previous = candidate;
        arcCost = cost;
        best = total;
        hasBest = true;
      }
    }
    if (previous) {
      state.paths[0] = {
        previous,
        arc: {
          from,
          to: span.to,
          unit,
          cost: arcCost,
          confidence: Math.exp(minimum - acoustic) / denominator,
          long: Boolean(span.long?.[unit]),
        },
        cost: best,
      };
    }
  }
}

function connectPause(states, parents, { to, pause }, from, settings) {
  const { width, nbest, lattice } = settings;
  const state = stateFor(states, width);
  for (const parent of parents) {
    const arc = { from, to, unit: width, cost: 0, confidence: 1, pause };
    for (const previous of parent.paths) {
      addPath(state.paths, previous, arc, previous.cost, nbest);
    }
  }
  if (lattice) {
    (state.edges ??= []).push({ from, to, unit: width, cost: 0, pause });
  }
}

function connect(states, parents, span, from, settings) {
  const { to, pause, terms, whisper } = span;
  const { width, costs, nbest, lattice } = settings;
  const weights = whisper ? WHISPER_WEIGHTS : settings.weights;
  if (pause) {
    connectPause(states, parents, span, from, settings);
    return;
  }
  if (nbest === 1 && !lattice) {
    connectBest(states, parents, span, from, settings, weights);
    return;
  }
  const { scores, minimum, denominator } = acousticCosts(terms, weights);
  for (let unit = 0; unit < width; unit++) {
    const state = stateFor(states, unit);
    const acoustic = scores[unit];
    const confidence = Math.exp(minimum - acoustic) / denominator;
    let cheapest = Infinity;
    for (const parent of parents) {
      const cost =
        acoustic + weights.phonotactic * costs[parent.unit * width + unit];
      cheapest = Math.min(cost, cheapest);
      if (
        state.paths.length === nbest &&
        parent.paths[0].cost + cost >= state.paths[nbest - 1].cost
      ) {
        continue;
      }
      const arc = {
        from,
        to,
        unit,
        cost,
        confidence,
        long: Boolean(span.long?.[unit]),
      };
      for (const previous of parent.paths) {
        addPath(state.paths, previous, arc, previous.cost + cost, nbest);
      }
    }
    if (lattice) {
      (state.edges ??= []).push({ from, to, unit, cost: cheapest });
    }
  }
}

function terminalPaths(states, limit) {
  const seen = new Set();
  const result = [];
  for (const path of states.flatMap(({ paths }) => paths).sort(comparePaths)) {
    if (!seen.has(path.sequence)) {
      seen.add(path.sequence);
      result.push(path);
      if (result.length === limit) {
        break;
      }
    }
  }
  return result;
}

export function decodeSearch(prepared, language, options) {
  const { times, spans } = prepared;
  const {
    beam,
    nbest,
    weights,
    lastUnit = language.symbols.length,
    lattice = true,
  } = options;
  const width = language.symbols.length;
  const edges = [];
  const pending = Array.from(times, () => []);
  const frontier = [];
  if (!times.length) {
    return { edges, paths: [], frontier };
  }
  const origin = { cost: 0, sequence: { children: [] } };
  stateFor(pending[0], lastUnit).paths.push(origin);
  const settings = { width, costs: language.costs, weights, nbest, lattice };
  let terminal = [];
  let provisional = [];
  for (let from = 0; from < times.length; from++) {
    const parents = pending[from]
      .filter(Boolean)
      .sort((a, b) => comparePaths(a.paths[0], b.paths[0]))
      .slice(0, beam);
    pending[from] = null;
    if (!parents.length) {
      continue;
    }
    provisional = parents;
    if (lattice) {
      for (const state of parents) {
        if (state.edges) {
          edges.push(...state.edges);
        }
      }
    }
    if (times.at(-1) - times[from] <= 0.4 && times.length - from <= 5) {
      frontier.push(...parents.map(({ paths }) => paths[0]));
    }
    if (from === times.length - 1) {
      terminal = parents;
      break;
    }
    for (const span of spans[from]) {
      connect(pending[span.to], parents, span, from, settings);
    }
  }
  return {
    edges,
    paths: terminalPaths(terminal, nbest),
    frontier,
    provisional: provisional[0]?.paths[0],
  };
}

export function pathArcs(path) {
  const arcs = [];
  for (let step = path; step?.arc; step = step.previous) {
    arcs.push(step.arc);
  }
  return arcs.reverse();
}
