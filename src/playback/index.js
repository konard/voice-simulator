/**
 * Streaming playback (issue 27): the ring buffer shared by the main thread
 * and the AudioWorklet player, and the URL of the processor module to pass
 * to `audioWorklet.addModule`.
 */

export {
  RING,
  RING_HEADER_BYTES,
  createRing,
  ringAvailable,
  ringEnd,
  ringFree,
  ringFromBuffer,
  ringRead,
  ringReset,
  ringWrite,
} from './ring-buffer.js';

/** Name the processor registers (`new AudioWorkletNode(context, name)`). */
export const PLAYER_PROCESSOR_NAME = 'voice-simulator-player';

/** URL of ./worklet-processor.js for `audioWorklet.addModule`. */
export const PLAYER_PROCESSOR_URL = new globalThis.URL(
  './worklet-processor.js',
  import.meta.url
);
