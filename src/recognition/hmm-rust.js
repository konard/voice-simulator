/**
 * The Gaussian HMM kernels of the Rust engine (issue 75): state scores as
 * `stateScore` of hmm-model.js, the projection as `applyLda` of
 * hmm-features.js and the tone-stream features as `hmmToneFeatures` of
 * hmm-tone.js, computed by `rec_hmm_scores`, `rec_hmm_lda` and
 * `rec_hmm_tone` of the WebAssembly engine. Unlicense.
 */
import { HMM_TONE_DIMS } from './hmm-tone.js';
import { withWasmMemory } from './wasm-memory.js';

function check(code, name) {
  if (code !== 0) {
    throw new Error(`Rust ${name} failed (${code})`);
  }
}

/**
 * Log likelihoods of `states` for every frame, frame-major
 * (`out[t * states.length + i]`).
 * @param {{exports: object, memory: WebAssembly.Memory}} module
 * @param {object} model an unpacked model (`getHmmModel()`)
 * @param {Float32Array} feats `frames × model.dims` features
 * @param {number} frames
 * @param {ArrayLike<number>} states
 */
export function hmmStateScoresRust(module, model, feats, frames, states) {
  return withWasmMemory(module, (allocate) => {
    const first = allocate(Int32Array, model.first.length, model.first);
    const mu = allocate(Float32Array, model.mu.length, model.mu);
    const inv = allocate(Float32Array, model.inv.length, model.inv);
    const norm = allocate(Float64Array, model.norm.length, model.norm);
    const input = allocate(
      Float32Array,
      frames * model.dims,
      feats.subarray(0, frames * model.dims)
    );
    const chosen = allocate(Uint32Array, states.length, states);
    const out = allocate(Float64Array, frames * states.length);
    check(
      module.exports.rec_hmm_scores(
        first.pointer,
        model.states,
        mu.pointer,
        inv.pointer,
        norm.pointer,
        model.norm.length,
        model.dims,
        input.pointer,
        frames,
        chosen.pointer,
        states.length,
        out.pointer
      ),
      'HMM scores'
    );
    return Float64Array.from(out.view());
  });
}

/**
 * `applyLda(lda, statics)` in Rust.
 * @param {{exports: object, memory: WebAssembly.Memory}} module
 * @param {object} lda the model's projection (`getHmmModel().lda`)
 * @param {Float64Array[]} statics one row of `lda.dim / 2` values per frame
 */
export function hmmLdaRust(module, lda, statics) {
  const stat = lda.dim / 2;
  const frames = statics.length;
  const flat = new Float64Array(frames * stat);
  statics.forEach((row, t) => flat.set(row.subarray(0, stat), t * stat));
  return withWasmMemory(module, (allocate) => {
    const input = allocate(Float64Array, flat.length, flat);
    const rows = allocate(Float32Array, lda.rows.length, lda.rows);
    const mean = allocate(Float32Array, lda.mean.length, lda.mean);
    const out = allocate(Float32Array, frames * lda.dims);
    check(
      module.exports.rec_hmm_lda(
        input.pointer,
        frames,
        stat,
        lda.ctx,
        rows.pointer,
        mean.pointer,
        lda.dims,
        out.pointer
      ),
      'HMM LDA'
    );
    return Float32Array.from(out.view());
  });
}

/**
 * `hmmToneFeatures(lf0, voicing)` in Rust.
 * @param {{exports: object, memory: WebAssembly.Memory}} module
 * @param {ArrayLike<number>} lf0
 * @param {ArrayLike<number>} voicing
 */
export function hmmToneFeaturesRust(module, lf0, voicing) {
  const frames = lf0.length;
  if (voicing.length !== frames) {
    throw new Error('Rust HMM tone failed (lengths differ)');
  }
  return withWasmMemory(module, (allocate) => {
    const pitch = allocate(Float64Array, frames, lf0);
    const voiced = allocate(Float64Array, frames, voicing);
    const out = allocate(Float32Array, frames * HMM_TONE_DIMS);
    check(
      module.exports.rec_hmm_tone(
        pitch.pointer,
        voiced.pointer,
        frames,
        out.pointer
      ),
      'HMM tone'
    );
    return Float32Array.from(out.view());
  });
}
