/** Advance the emitting states of one HMM frame. Unlicense. */

export function scoreFrame(network, pass, frame) {
  const {
    work,
    active,
    length,
    previous: {
      scores: priorScores,
      histories: priorHistories,
      starts: priorStarts,
    },
    current: {
      state: { scores, histories, starts },
      peaks,
    },
    entries: { index: entryIndex, columns: entry },
    emissions: { stamp, value, evaluate },
  } = pass;
  const {
    nodes: { first, count },
    emit,
    model: { stay, go },
  } = network;
  let best = -Infinity;
  for (let row = 0; row < active; row++) {
    const id = work[row];
    const f = first[id];
    const offset = row * 6;
    const candidate = entryIndex[id] - 1;
    const firstMixture = emit[f];
    let nodeBest = priorScores[offset] + stay[firstMixture];
    let history = priorHistories[offset];
    let start = priorStarts[offset];
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
    let priorMixture = firstMixture;
    for (let state = 1; state < states; state++) {
      const j = offset + state;
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
      scores[j] = score;
      histories[j] = priorHistories[source];
      starts[j] = priorStarts[source];
      nodeBest = Math.max(nodeBest, score);
      priorMixture = mixture;
    }
    best = Math.max(best, nodeBest);
    peaks[row] = nodeBest;
  }
  // New nodes need only one score, even when the next frontier is large.
  for (let row = active; row < length; row++) {
    const id = work[row];
    const mixture = emit[first[id]];
    const queued = entry.scores[entryIndex[id] - 1];
    let score = -Infinity;
    if (queued > score) {
      score = queued;
    }
    if (score > -Infinity) {
      if (stamp[mixture] !== frame) {
        evaluate(mixture, frame);
      }
      score += value[mixture];
    }
    peaks[row] = score;
    best = Math.max(best, score);
  }
  return best;
}
