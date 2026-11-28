/** Per-frame spectral and tone emission scores. Unlicense. */
import { stateScore } from './hmm-model.js';

export class EmissionCache {
  constructor(model) {
    this.model = model;
    this.stamp = new Int32Array(model.states);
    this.value = new Float64Array(model.states);
    this.toneScores = new Float64Array(model.tone?.states ?? 0);
    this.peak = new Float64Array(3);
    this.sum = new Float64Array(3);
    this.feats = undefined;
    this.tone = undefined;
    this.toneWeight = 0;
    this.toneFrame = -1;
  }

  begin(feats, { tone, toneWeight }) {
    this.stamp.fill(-1);
    this.feats = feats;
    this.tone = this.model.tone && toneWeight ? tone : undefined;
    this.toneWeight = toneWeight;
    this.toneFrame = -1;
  }

  clear() {
    this.feats = undefined;
    this.tone = undefined;
  }

  evaluate(m, frame) {
    const { model, value } = this;
    this.stamp[m] = frame;
    stateScore(m, this.feats, frame * model.dims, model, value);
    if (this.tone) {
      const key = model.tone.ofState[m];
      let adjustment = 0;
      if (!(model.tone.stateOfKey[key] < 0)) {
        if (this.toneFrame !== frame) {
          this.#scoreTones(frame);
        }
        adjustment = this.toneScores[key];
      }
      value[m] += adjustment;
    }
  }

  // Tone weight times the log posterior among the classes of the same state.
  #scoreTones(frame) {
    const { tone } = this.model;
    const { states, stateOfKey } = tone;
    const { toneScores: scores, peak, sum } = this;
    this.toneFrame = frame;
    peak.fill(-Infinity);
    sum.fill(0);
    for (let k = 0; k < states; k++) {
      const state = stateOfKey[k];
      if (state >= 0) {
        stateScore(k, this.tone, frame * tone.dims, tone, scores);
        peak[state] = Math.max(peak[state], scores[k]);
      }
    }
    for (let k = 0; k < states; k++) {
      const state = stateOfKey[k];
      if (state >= 0) {
        sum[state] += Math.exp(scores[k] - peak[state]);
      }
    }
    for (let k = 0; k < states; k++) {
      const state = stateOfKey[k];
      scores[k] =
        state < 0
          ? 0
          : this.toneWeight * (scores[k] - peak[state] - Math.log(sum[state]));
    }
  }
}
