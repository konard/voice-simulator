/**
 * Microphone position and the listening chain after the acoustic solver.
 *
 * The solvers produce the sound at a reference point close to the lips:
 * the 1D waveguide (and the 3D solver in flow mode) the radiated volume
 * flow, which is heard as the far field of the mouth, and the 3D solver in
 * microphone mode the pressure at a voxel. A microphone further away hears
 * the sound later (propagation delay), quieter (spherical spreading, 1/r)
 * and, off the axis of the mouth, with less treble: the head shadows the
 * high frequencies (speech directivity, e.g. Chu & Warnock 2002, Monson et
 * al. 2012), while low frequencies spread almost evenly. Rooms add their
 * reflections and reverberation on top (see room.js).
 */

import {
  AIR_SPEED,
  Room,
  checkedNumber,
  resolveRoom,
  reverberationTime,
} from './room.js';

/** Distance of the reference microphone from the lips (cm). */
export const MICROPHONE_REFERENCE = 3;
const MIN_DISTANCE = 1;
const MAX_DISTANCE = 1000;
/** Crossover between the omnidirectional and the directional band (Hz). */
const DIRECTIVITY_CROSSOVER = 1500;
/** Loss behind the head relative to straight ahead (dB). */
const DIRECTIVITY_HIGH = 12;
const DIRECTIVITY_LOW = 2;

/**
 * Validate a microphone position relative to the lips: `distance` in cm
 * (3 by default), `azimuth` in degrees (0 = straight ahead, 90 = to the
 * speaker's left, +x), `elevation` in degrees (positive = up) and
 * `compensate` (keep the loudness of the reference microphone, like
 * raising the preamplifier gain of a distant microphone).
 * @param {{distance?: number, azimuth?: number, elevation?: number, compensate?: boolean}|null|undefined} microphone
 * @returns {{distance: number, azimuth: number, elevation: number, compensate: boolean}|null}
 */
export function resolveMicrophone(microphone) {
  if (microphone === undefined || microphone === null) {
    return null;
  }
  return {
    distance: checkedNumber(
      microphone.distance ?? MICROPHONE_REFERENCE,
      'microphone distance',
      MIN_DISTANCE,
      MAX_DISTANCE
    ),
    azimuth: checkedNumber(
      microphone.azimuth ?? 0,
      'microphone azimuth',
      -180,
      180
    ),
    elevation: checkedNumber(
      microphone.elevation ?? 0,
      'microphone elevation',
      -90,
      90
    ),
    compensate: Boolean(microphone.compensate),
  };
}

/**
 * Unit vector from the lips to the microphone in head coordinates
 * (x lateral, y up, z ahead of the face).
 * @param {{azimuth: number, elevation: number}} microphone
 * @returns {number[]}
 */
export function microphoneDirection(microphone) {
  const azimuth = (microphone.azimuth * Math.PI) / 180;
  const elevation = (microphone.elevation * Math.PI) / 180;
  return [
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation),
  ];
}

/**
 * Microphone position in head coordinates (cm).
 * @param {object} microphone Microphone option (see resolveMicrophone).
 * @param {number[]} lips Lip position (headLandmarks(head).lips).
 * @returns {number[]}
 */
export function microphonePosition(microphone, lips) {
  const resolved = resolveMicrophone(microphone ?? {});
  const direction = microphoneDirection(resolved);
  return lips.map((value, axis) => value + direction[axis] * resolved.distance);
}

/**
 * Distance gain, propagation delay and directivity between the point the
 * solver simulated and the microphone.
 */
export class MicrophoneStage {
  /**
   * @param {object} microphone Resolved microphone.
   * @param {{sampleRate: number, simulated?: number, directivity?: boolean}} options
   *   `simulated` is the distance (cm) the solver already covered and
   *   `directivity` whether the head shadow still has to be added.
   */
  constructor(microphone, options) {
    const simulated = options.simulated ?? MICROPHONE_REFERENCE;
    const { distance } = microphone;
    const reference = microphone.compensate
      ? distance / MICROPHONE_REFERENCE
      : 1;
    this.gain = (simulated / distance) * reference;
    const delay =
      (Math.max(0, distance - simulated) / 100 / AIR_SPEED) *
      options.sampleRate;
    this.delay = Math.floor(delay);
    this.fraction = delay - this.delay;
    this.size = 2 ** Math.ceil(Math.log2(this.delay + 2));
    this.history = new Float64Array(this.size);
    this.position = 0;
    const direction = microphoneDirection(microphone);
    // 0 straight ahead, 1 straight behind the head.
    const behind = (1 - direction[2]) / 2;
    this.directional = options.directivity !== false && behind > 0;
    this.lowGain = 10 ** ((-DIRECTIVITY_LOW * behind) / 20);
    this.highGain = 10 ** ((-DIRECTIVITY_HIGH * behind) / 20);
    this.smoothing = Math.exp(
      (-2 * Math.PI * DIRECTIVITY_CROSSOVER) / options.sampleRate
    );
    this.low = 0;
  }

  process(input) {
    let value = input * this.gain;
    if (this.directional) {
      this.low = value + this.smoothing * (this.low - value);
      value = this.low * this.lowGain + (value - this.low) * this.highGain;
    }
    if (this.delay === 0 && this.fraction === 0) {
      return value;
    }
    const { history, size } = this;
    const mask = size - 1;
    history[this.position] = value;
    const newer = history[(this.position - this.delay) & mask];
    const older = history[(this.position - this.delay - 1) & mask];
    this.position = (this.position + 1) & mask;
    return newer + (older - newer) * this.fraction;
  }
}

/** Room equivalent to a box around the head (cm -> m). */
function enclosureRoom(enclosure) {
  const { low, high, lips, absorption } = enclosure;
  const [width, height, depth] = [0, 1, 2].map(
    (axis) => (high[axis] - low[axis]) / 100
  );
  return {
    width,
    height,
    depth,
    absorption: Math.max(0.01, absorption),
    headPosition: lips.map((value, axis) => (value - low[axis]) / 100),
  };
}

/**
 * Listening chain after the solver, or null when the output is heard at
 * the reference point in free field (the default, which keeps the output
 * unchanged).
 * @param {{microphone?: object, room?: string|object, enclosure?: object|null, solver: object, sampleRate: number}} options
 *   `enclosure` is the resolved box around the head (enclosureBounds);
 *   solvers that simulate it themselves set `simulatesEnclosure`.
 * @returns {{process: (value: number) => number, tail: number}|null}
 */
export function createListener(options) {
  const microphone = resolveMicrophone(options.microphone);
  const { solver, sampleRate, enclosure } = options;
  const stages = [];
  let tail = 0;
  if (microphone) {
    const simulated = solver.microphoneDistance;
    const stage = new MicrophoneStage(microphone, {
      sampleRate,
      simulated,
      directivity: simulated === undefined,
    });
    stages.push(stage);
    tail += Math.ceil(stage.delay + stage.fraction) / sampleRate;
  }
  const position = microphone ?? resolveMicrophone({});
  const rooms = [];
  if (enclosure && !solver.simulatesEnclosure) {
    rooms.push(enclosureRoom(enclosure));
  } else if (enclosure) {
    tail += Math.min(1, reverberationTime(enclosureRoom(enclosure)));
  }
  const room = resolveRoom(options.room);
  if (room) {
    rooms.push(room);
  }
  for (const spec of rooms) {
    const stage = new Room(spec, {
      sampleRate,
      direction: microphoneDirection(position),
      distance: position.distance,
    });
    stages.push(stage);
    tail += stage.tail;
  }
  if (stages.length === 0 && tail === 0) {
    return null;
  }
  return {
    stages,
    tail,
    process(value) {
      let result = value;
      for (const stage of stages) {
        result = stage.process(result);
      }
      return result;
    },
  };
}
