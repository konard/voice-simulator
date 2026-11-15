/**
 * Serialized listener of the Rust renderer (LISTENER_LENGTH values of
 * RENDERER_CONFIG, src/engine/layout.js): `[stage count, stages...]`.
 * JavaScript resolves the microphone and the room (createListener of
 * src/acoustics/microphone.js: the distance gain and delay, the image
 * sources, the delay network and its calibration); Rust runs the resolved
 * numbers per sample (crates/voice-simulator-core/src/listener.rs).
 */

import { MicrophoneStage } from '../acoustics/microphone.js';
import { Room } from '../acoustics/room.js';
import { LISTENER } from './layout.js';

/** `[MICROPHONE, gain, delay, fraction, size, directional, lowGain, highGain, smoothing]` */
function microphoneValues(stage) {
  return [
    LISTENER.MICROPHONE,
    stage.gain,
    stage.delay,
    stage.fraction,
    stage.size,
    stage.directional ? 1 : 0,
    stage.lowGain,
    stage.highGain,
    stage.smoothing,
  ];
}

/**
 * `[ROOM, size, tailDelay, tailGain, tapCount, delays[8], scales[8],
 * poles[8], tapDelays[tapCount], tapGains[tapCount]]`
 */
function roomValues(stage) {
  const { network } = stage;
  if (network.delays.length !== LISTENER.LINES) {
    return null;
  }
  return [
    LISTENER.ROOM,
    stage.size,
    stage.tailDelay,
    stage.tailGain,
    stage.tapDelays.length,
    ...network.delays,
    ...network.scales,
    ...network.poles,
    ...stage.tapDelays,
    ...stage.tapGains,
  ];
}

/**
 * The values of a fresh listener of createListener, or [] for none.
 * @param {ReturnType<typeof import('../acoustics/microphone.js').createListener>} listener
 * @returns {Float64Array|null} null for a listener Rust cannot run
 */
export function listenerValues(listener) {
  if (!listener) {
    return new Float64Array(0);
  }
  const values = [listener.stages.length];
  for (const stage of listener.stages) {
    let stageValues = null;
    if (stage instanceof MicrophoneStage) {
      stageValues = microphoneValues(stage);
    } else if (stage instanceof Room) {
      stageValues = roomValues(stage);
    }
    if (!stageValues) {
      return null;
    }
    values.push(...stageValues);
  }
  return Float64Array.from(values);
}
