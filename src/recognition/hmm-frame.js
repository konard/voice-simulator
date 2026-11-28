/** Advance the emitting states of one HMM frame. Unlicense. */

export function scoreFrame(network, pass, frame) {
  const {
    positions,
    work,
    active,
    length,
    previous: {
      scores: priorScores,
      histories: priorHistories,
      starts: priorStarts,
    },
    current: { scores, histories, starts, peaks },
    entries: { index: entryIndex, columns: entry },
    emissions: { stamp, value, evaluate },
  } = pass;
  const {
    nodes: { first, count },
    emit,
    model: { stay, go },
  } = network;
  let best = -Infinity;
  for (let row = 0; row < length; row++) {
    const id = work[row];
    const f = first[id];
    const offset = row * 6;
    const candidate = entryIndex[id] - 1;
    const firstMixture = emit[f];
    const wasActive = row < active;
    let prior = 0;
    let nodeBest = -Infinity;
    let history = 0;
    let start = 0;
    if (wasActive) {
      prior = (positions[id] - 1) * 6;
      nodeBest = priorScores[prior] + stay[firstMixture];
      history = priorHistories[prior];
      start = priorStarts[prior];
    }
    if (candidate >= 0 && entry.scores[candidate] > nodeBest) {
      nodeBest = entry.scores[candidate];
      history = entry.histories[candidate];
      start = entry.starts[candidate];
    }
    if (nodeBest > -Infinity) {
      if (stamp[firstMixture] !== frame) {
        evaluate(firstMixture, frame);
      }
      nodeBest += value[firstMixture];
    }
    scores[offset] = nodeBest;
    histories[offset] = history;
    starts[offset] = start;
    const states = count[id];
    if (wasActive) {
      let priorMixture = firstMixture;
      for (let state = 1; state < states; state++) {
        const j = prior + state;
        const mixture = emit[f + state];
        let score = priorScores[j] + stay[mixture];
        let source = j;
        const step = priorScores[j - 1] + go[priorMixture];
        if (step > score) {
          score = step;
          source--;
        }
        if (score > -Infinity) {
          if (stamp[mixture] !== frame) {
            evaluate(mixture, frame);
          }
          score += value[mixture];
        }
        scores[offset + state] = score;
        histories[offset + state] = priorHistories[source];
        starts[offset + state] = priorStarts[source];
        nodeBest = Math.max(nodeBest, score);
        priorMixture = mixture;
      }
    } else {
      // New nodes can emit only their first state in this frame.
      for (let i = offset + 1, end = offset + states; i < end; i++) {
        scores[i] = -Infinity;
        histories[i] = 0;
        starts[i] = 0;
      }
    }
    best = Math.max(best, nodeBest);
    peaks[row] = nodeBest;
  }
  return best;
}
