/** Advance the emitting states of one HMM frame. Unlicense. */

export function scoreFrame(network, pass, frame) {
  const {
    positions,
    work,
    active,
    length,
    previous,
    current,
    entries,
    emissions,
  } = pass;
  const { nodes, emit, model } = network;
  const { first, count } = nodes;
  const { stay, go } = model;
  const { scores, histories, starts, peaks } = current;
  const {
    scores: priorScores,
    histories: priorHistories,
    starts: priorStarts,
  } = previous;
  const { stamp, value, evaluate } = emissions;
  const { index: entryIndex, columns: entry } = entries;
  let best = -Infinity;
  for (let row = 0; row < length; row++) {
    const id = work[row];
    const f = first[id];
    const wasActive = row < active;
    const prior = (positions[id] - 1) * 6;
    const offset = row * 6;
    const candidate = entryIndex[id] - 1;
    let nodeBest = -Infinity;
    for (let state = 0; state < count[id]; state++) {
      const j = prior + state;
      const mixture = emit[f + state];
      let score = -Infinity;
      let history = 0;
      let start = 0;
      if (wasActive) {
        score = priorScores[j] + stay[mixture];
        history = priorHistories[j];
        start = priorStarts[j];
        if (state > 0) {
          const step = priorScores[j - 1] + go[emit[f + state - 1]];
          if (step > score) {
            score = step;
            history = priorHistories[j - 1];
            start = priorStarts[j - 1];
          }
        }
      }
      if (state === 0 && candidate >= 0 && entry.scores[candidate] > score) {
        score = entry.scores[candidate];
        history = entry.histories[candidate];
        start = entry.starts[candidate];
      }
      if (score > -Infinity) {
        if (stamp[mixture] !== frame) {
          evaluate(mixture, frame);
        }
        score += value[mixture];
      }
      scores[offset + state] = score;
      histories[offset + state] = history;
      starts[offset + state] = start;
      nodeBest = Math.max(nodeBest, score);
    }
    best = Math.max(best, nodeBest);
    peaks[row] = nodeBest;
  }
  return best;
}
