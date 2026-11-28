/** Advance the emitting states of one HMM frame. Unlicense. */

export function scoreFrame(network, pass, frame) {
  const {
    work,
    active,
    state: { scores, histories, starts },
    peaks,
    framePeak,
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
  // Share the running maximum in its numeric column across both passes.
  framePeak[0] = best;
  scoreNewNodes(network, pass, frame);
}

/** New nodes need only one score, even when the next frontier is large. */
function scoreNewNodes(network, pass, frame) {
  const { work, active, length, entries, emissions, peaks, framePeak } = pass;
  const {
    index: entryIndex,
    columns: { scores: entryScores },
  } = entries;
  const { stamp, value } = emissions;
  const {
    nodes: { first },
    emit,
  } = network;
  let best = framePeak[0];
  for (let row = active; row < length; row++) {
    const id = work[row];
    const queued = entryScores[entryIndex[id] - 1];
    if (!(queued > -Infinity)) {
      peaks[row] = -Infinity;
      continue;
    }
    const mixture = emit[first[id]];
    if (stamp[mixture] !== frame) {
      emissions.evaluate(mixture, frame);
    }
    const score = queued + value[mixture];
    peaks[row] = score;
    best = Math.max(best, score);
  }
  framePeak[0] = best;
}
