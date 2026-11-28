/** Advance the emitting states of one HMM frame. Unlicense. */

export function scoreFrame(network, pass, frame) {
  const {
    work,
    active,
    state: { scores, histories, starts },
    peaks,
    entries: { index: entryIndex, columns: entry },
    emissions,
  } = pass;
  const { stamp, value } = emissions;
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
    // A state can stay or advance by one. Carry the old predecessor as
    // we overwrite the row, keeping the emission evaluation in order.
    let priorScore = scores[offset];
    let priorHistory = histories[offset];
    let priorStart = starts[offset];
    let nodeBest = priorScore + stay[firstMixture];
    let history = priorHistory;
    let start = priorStart;
    if (candidate >= 0 && entry.scores[candidate] > nodeBest) {
      nodeBest = entry.scores[candidate];
      history = entry.histories[candidate];
      start = entry.starts[candidate];
    }
    if (nodeBest > -Infinity) {
      if (stamp[firstMixture] !== frame) {
        emissions.evaluate(firstMixture, frame);
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
      const oldScore = scores[j];
      const oldHistory = histories[j];
      const oldStart = starts[j];
      let score = oldScore + stay[mixture];
      const step = priorScore + go[priorMixture];
      history = oldHistory;
      start = oldStart;
      if (step > score) {
        score = step;
        history = priorHistory;
        start = priorStart;
      }
      if (score > -Infinity) {
        if (stamp[mixture] !== frame) {
          emissions.evaluate(mixture, frame);
        }
        score += value[mixture];
      }
      scores[j] = score;
      histories[j] = history;
      starts[j] = start;
      nodeBest = Math.max(nodeBest, score);
      priorScore = oldScore;
      priorHistory = oldHistory;
      priorStart = oldStart;
      priorMixture = mixture;
    }
    best = Math.max(best, nodeBest);
    peaks[row] = nodeBest;
  }
  pass.framePeak[0] = scoreNewNodes(network, pass, frame, best);
}

/** New nodes need only one score, even when the next frontier is large. */
function scoreNewNodes(network, pass, frame, best) {
  const { work, active, length, entries, emissions, peaks } = pass;
  const { index: entryIndex, columns: entry } = entries;
  const { stamp, value } = emissions;
  const {
    nodes: { first },
    emit,
  } = network;
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
        emissions.evaluate(mixture, frame);
      }
      score += value[mixture];
    }
    peaks[row] = score;
    best = Math.max(best, score);
  }
  return best;
}
