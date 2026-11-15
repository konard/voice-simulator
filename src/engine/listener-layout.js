/**
 * Serialized listener of the Rust renderer (LISTENER_LENGTH values of
 * RENDERER_CONFIG, src/engine/layout.js): `[stage count, stages...]`.
 * JavaScript resolves the microphone and the room (createListener of
 * src/acoustics/microphone.js); Rust runs the resolved numbers per sample.
 */

/**
 * The values of a listener of createListener, or [] for none.
 * @param {ReturnType<typeof import('../acoustics/microphone.js').createListener>} listener
 * @returns {Float64Array|null} null for a listener Rust cannot run
 */
export function listenerValues(listener) {
  if (!listener) {
    return new Float64Array(0);
  }
  return null;
}
