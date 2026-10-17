/**
 * Room acoustics as a cheap post-process on the voice signal.
 *
 * A shoebox room is modelled in two parts. Early reflections come from
 * image sources (Allen & Berkley 1979): every wall reflection mirrors the
 * mouth, and each mirrored mouth reaches the microphone later and quieter
 * (spherical spreading and the wall reflection factor sqrt(1 - alpha)). The
 * late tail is a feedback delay network (Jot & Chaigne 1991) whose decay
 * matches the Eyring reverberation time of the room, with a little extra
 * loss at high frequencies (air absorption, soft furnishings). The tail
 * starts at the mixing time and its level follows the diffuse-field
 * energy 16 pi r² / A relative to the direct sound at distance r.
 *
 * All walls share one absorption coefficient, the mouth radiates like a
 * point source for the reflections and everything is deterministic.
 */

/** Speed of sound in room air at 20 °C (m/s). */
export const AIR_SPEED = 343;
/** 24 ln(10) / c: the constant of the Sabine and Eyring formulas (s/m). */
const EYRING = (24 * Math.LN10) / AIR_SPEED;
/** Longest room dimension and reverberation time that are accepted. */
const MAX_SIZE = 100;
const MIN_SIZE = 0.1;
const MAX_RT60 = 10;
const MIN_RT60 = 0.03;
const DEFAULT_ABSORPTION = 0.3;
/** Most image sources kept for the early reflections. */
const MAX_TAPS = 160;
/** Feedback delay network size and delay spread around the mean free path. */
const LINES = 8;
const LINE_SPREAD = [0.62, 0.71, 0.83, 0.94, 1.06, 1.19, 1.33, 1.49];
/**
 * Reverberation times at DC and at the Nyquist frequency relative to the
 * nominal one, calibrated so that the broadband decay of the tail matches
 * the nominal RT60 (see experiments/issue-5-room-rt60.mjs).
 */
const LOW_DECAY = 1.15;
const HIGH_DECAY = 0.6;
/** Longest reverberation tail added after the utterance (s). */
export const ROOM_TAIL_LIMIT = 3;
/** Distance from the floor of the mouth of a standing speaker (m). */
const MOUTH_HEIGHT = 1.55;
/** Smallest distance between the microphone and a wall (m). */
const WALL_CLEARANCE = 0.05;

/**
 * Named rooms: sizes in metres and reverberation times in seconds.
 * `anechoic` (no room) is the default.
 */
export const ROOM_PRESETS = Object.freeze({
  anechoic: null,
  studio: Object.freeze({ width: 5, height: 3, depth: 4, rt60: 0.25 }),
  'small-room': Object.freeze({
    width: 4,
    height: 2.6,
    depth: 3.5,
    rt60: 0.45,
  }),
  office: Object.freeze({ width: 6, height: 3, depth: 5, rt60: 0.7 }),
  bathroom: Object.freeze({ width: 2.4, height: 2.5, depth: 2, rt60: 1.1 }),
  classroom: Object.freeze({ width: 9, height: 3.2, depth: 7, rt60: 0.9 }),
  hall: Object.freeze({ width: 30, height: 15, depth: 40, rt60: 2 }),
  cathedral: Object.freeze({ width: 30, height: 25, depth: 70, rt60: 3.5 }),
});

/** A finite number in [low, high], or an error naming the setting. */
export function checkedNumber(value, label, low, high) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < low || number > high) {
    throw new Error(`${label} must be a number from ${low} to ${high}`);
  }
  return number;
}

function roomGeometry(width, height, depth) {
  return {
    volume: width * height * depth,
    surface: 2 * (width * height + width * depth + height * depth),
  };
}

/**
 * Eyring reverberation time (s) of a room with uniform absorption.
 * @param {{width: number, height: number, depth: number, absorption: number}} room
 */
export function reverberationTime(room) {
  const { volume, surface } = roomGeometry(room.width, room.height, room.depth);
  const absorption = Math.min(room.absorption, 0.999);
  return (EYRING * volume) / (-surface * Math.log(1 - absorption));
}

/**
 * Validate a room: a preset name, null / 'anechoic' (no room) or
 * `{width, height, depth}` in metres with `rt60` (s) or `absorption`
 * (0..1, 0.3 by default; rt60 wins when both are given) and an optional
 * `headPosition` [x, y, z] of the mouth in metres from a floor corner. The
 * speaker faces +z (along the depth).
 * @param {string|object|null|undefined} room
 * @returns {object|null}
 */
export function resolveRoom(room) {
  if (room === undefined || room === null || room === 'anechoic') {
    return null;
  }
  let spec = room;
  if (typeof room === 'string') {
    if (!Object.hasOwn(ROOM_PRESETS, room)) {
      throw new Error(
        `Unknown room: ${room} (${Object.keys(ROOM_PRESETS).join(', ')})`
      );
    }
    spec = ROOM_PRESETS[room];
  }
  const [width, height, depth] = ['width', 'height', 'depth'].map((name) =>
    checkedNumber(spec[name], `room ${name}`, MIN_SIZE, MAX_SIZE)
  );
  const { volume, surface } = roomGeometry(width, height, depth);
  let absorption;
  if (spec.rt60 !== undefined) {
    const rt60 = checkedNumber(spec.rt60, 'room rt60', MIN_RT60, MAX_RT60);
    absorption = 1 - Math.exp((-EYRING * volume) / (surface * rt60));
  } else {
    absorption = checkedNumber(
      spec.absorption ?? DEFAULT_ABSORPTION,
      'room absorption',
      0.01,
      1
    );
  }
  absorption = Math.min(absorption, 0.999);
  const size = [width, height, depth];
  const headPosition = spec.headPosition
    ? spec.headPosition.map((value, axis) =>
        checkedNumber(value, 'room headPosition', 0, size[axis])
      )
    : [0.45 * width, Math.min(MOUTH_HEIGHT, 0.55 * height), 0.4 * depth];
  const resolved = { width, height, depth, absorption, headPosition };
  resolved.rt60 = reverberationTime(resolved);
  return resolved;
}

/**
 * Microphone position in the room (m): `direction` and `distance` (cm)
 * are relative to the mouth, as for the microphone option.
 */
function receiverPosition(room, direction, distance) {
  const size = [room.width, room.height, room.depth];
  return room.headPosition.map((value, axis) =>
    Math.min(
      size[axis] - WALL_CLEARANCE,
      Math.max(WALL_CLEARANCE, value + (direction[axis] * distance) / 100)
    )
  );
}

/**
 * Image sources that arrive before `limit` seconds after the direct sound:
 * delay (s) after the direct sound and gain relative to it.
 */
function imageSources(room, receiver, limit) {
  const size = [room.width, room.height, room.depth];
  const source = room.headPosition;
  const direct = Math.max(
    1e-3,
    Math.hypot(...source.map((value, axis) => value - receiver[axis]))
  );
  const reach = direct + limit * AIR_SPEED;
  const reflection = Math.sqrt(1 - room.absorption);
  // Image coordinates per axis: (1 - 2q) s + 2 n L, after |n - q| + |n|
  // reflections (Allen & Berkley).
  const axes = size.map((length, axis) => {
    const images = [];
    const count = Math.ceil(reach / (2 * length)) + 1;
    for (let n = -count; n <= count; n++) {
      for (const q of [0, 1]) {
        const position = (1 - 2 * q) * source[axis] + 2 * n * length;
        const offset = position - receiver[axis];
        if (Math.abs(offset) <= reach) {
          images.push({ offset, order: Math.abs(n - q) + Math.abs(n) });
        }
      }
    }
    return images;
  });
  const taps = [];
  for (const x of axes[0]) {
    for (const y of axes[1]) {
      for (const z of axes[2]) {
        const order = x.order + y.order + z.order;
        if (order === 0) {
          continue;
        }
        const distance = Math.hypot(x.offset, y.offset, z.offset);
        const delay = (distance - direct) / AIR_SPEED;
        if (delay <= limit) {
          taps.push({ delay, gain: (reflection ** order * direct) / distance });
        }
      }
    }
  }
  taps.sort((a, b) => a.delay - b.delay || b.gain - a.gain);
  return { direct, taps: taps.slice(0, MAX_TAPS) };
}

/** Mixing time: when the reflections become dense enough for the tail (s). */
function mixingTime(room) {
  const { volume } = roomGeometry(room.width, room.height, room.depth);
  return Math.min(0.08, Math.max(0.01, 0.002 * Math.sqrt(volume)));
}

/** Feedback delay network with a Hadamard mixing matrix. */
class DelayNetwork {
  constructor(room, sampleRate) {
    const { volume, surface } = roomGeometry(
      room.width,
      room.height,
      room.depth
    );
    const freePath = (4 * volume) / surface / AIR_SPEED;
    this.delays = [];
    for (const spread of LINE_SPREAD) {
      const previous = this.delays.at(-1) ?? 1;
      this.delays.push(
        Math.max(previous + 1, Math.round(freePath * spread * sampleRate))
      );
    }
    this.lines = this.delays.map((delay) => new Float64Array(delay));
    this.positions = new Int32Array(LINES);
    this.state = new Float64Array(LINES);
    this.mix = new Float64Array(LINES);
    // One-pole absorption filters: gain k at DC, k (1 - b) / (1 + b) at
    // Nyquist, so low and high frequencies decay at their own rates.
    this.scales = new Float64Array(LINES);
    this.poles = new Float64Array(LINES);
    this.delays.forEach((delay, index) => {
      const low = 10 ** ((-3 * delay) / (room.rt60 * LOW_DECAY * sampleRate));
      const high = 10 ** ((-3 * delay) / (room.rt60 * HIGH_DECAY * sampleRate));
      const pole = (low - high) / (low + high);
      this.scales[index] = low * (1 - pole);
      this.poles[index] = pole;
    });
    this.minimumDelay = this.delays[0];
  }

  process(input) {
    const { lines, positions, state, mix, scales, poles } = this;
    let output = 0;
    for (let index = 0; index < LINES; index++) {
      const value = lines[index][positions[index]];
      output += index % 2 === 0 ? value : -value;
      state[index] = scales[index] * value + poles[index] * state[index];
      mix[index] = state[index];
    }
    // Fast Walsh-Hadamard transform (orthogonal after scaling by 1/sqrt(8)).
    for (let width = 1; width < LINES; width *= 2) {
      for (let start = 0; start < LINES; start += 2 * width) {
        for (let index = start; index < start + width; index++) {
          const a = mix[index];
          const b = mix[index + width];
          mix[index] = a + b;
          mix[index + width] = a - b;
        }
      }
    }
    const scale = 1 / Math.sqrt(LINES);
    for (let index = 0; index < LINES; index++) {
      const sign = index % 3 === 0 ? -1 : 1;
      lines[index][positions[index]] = mix[index] * scale + sign * input;
      positions[index] = (positions[index] + 1) % this.delays[index];
    }
    return output;
  }

  reset() {
    this.lines.forEach((line) => line.fill(0));
    this.positions.fill(0);
    this.state.fill(0);
  }

  /** Energy of the impulse response over `samples` samples. */
  energy(samples) {
    let sum = 0;
    for (let index = 0; index < samples; index++) {
      const value = this.process(index === 0 ? 1 : 0);
      sum += value * value;
    }
    this.reset();
    return sum;
  }
}

/**
 * Room post-process for one microphone position: the input is the dry
 * signal at the microphone, the output adds reflections and reverberation.
 */
export class Room {
  /**
   * @param {string|object} room Preset name or room (see resolveRoom).
   * @param {{sampleRate?: number, direction?: number[], distance?: number}} [options]
   *   Microphone direction (unit vector, +z ahead of the speaker) and
   *   distance from the mouth in cm.
   */
  constructor(room, options = {}) {
    const resolved = resolveRoom(room);
    if (!resolved) {
      throw new Error('Room needs a room, not an anechoic space');
    }
    this.room = resolved;
    this.sampleRate = options.sampleRate ?? 48000;
    const receiver = receiverPosition(
      resolved,
      options.direction ?? [0, 0, 1],
      options.distance ?? 3
    );
    const mixing = mixingTime(resolved);
    const { direct, taps } = imageSources(resolved, receiver, mixing);
    this.tapDelays = Int32Array.from(taps, (tap) =>
      Math.max(1, Math.round(tap.delay * this.sampleRate))
    );
    this.tapGains = Float64Array.from(taps, (tap) => tap.gain);
    this.network = new DelayNetwork(resolved, this.sampleRate);
    // The tail starts at the mixing time and carries the diffuse energy
    // that arrives after it.
    const start = Math.round(mixing * this.sampleRate);
    this.tailDelay = Math.max(0, start - this.network.minimumDelay);
    const { surface } = roomGeometry(
      resolved.width,
      resolved.height,
      resolved.depth
    );
    const area = -surface * Math.log(1 - resolved.absorption);
    const diffuse =
      ((16 * Math.PI * direct * direct) / area) *
      Math.exp((-6 * Math.LN10 * mixing) / resolved.rt60);
    const length = Math.round(
      Math.min(resolved.rt60, 4 * ROOM_TAIL_LIMIT) * this.sampleRate
    );
    this.tailGain = Math.sqrt(diffuse / this.network.energy(length));
    let longest = this.tailDelay;
    for (const delay of this.tapDelays) {
      longest = Math.max(longest, delay);
    }
    this.size = 2 ** Math.ceil(Math.log2(longest + 1));
    this.history = new Float64Array(this.size);
    this.position = 0;
  }

  /** Seconds of reverberation worth rendering after the voice stops. */
  get tail() {
    return Math.min(this.room.rt60, ROOM_TAIL_LIMIT);
  }

  /**
   * @param {number} input Dry sample at the microphone.
   * @returns {number} Sample with the room.
   */
  process(input) {
    const { history, size, tapDelays, tapGains } = this;
    const mask = size - 1;
    history[this.position] = input;
    let output = input;
    for (let index = 0; index < tapDelays.length; index++) {
      output +=
        tapGains[index] * history[(this.position - tapDelays[index]) & mask];
    }
    const late = history[(this.position - this.tailDelay) & mask];
    output += this.tailGain * this.network.process(late);
    this.position = (this.position + 1) & mask;
    return output;
  }

  reset() {
    this.history.fill(0);
    this.position = 0;
    this.network.reset();
  }
}

/**
 * Impulse response of a room for a microphone position (direct sound at
 * sample 0), e.g. to convolve recordings or to measure the room.
 * @param {string|object} room
 * @param {{sampleRate?: number, direction?: number[], distance?: number, seconds?: number}} [options]
 * @returns {Float32Array}
 */
export function roomImpulseResponse(room, options = {}) {
  const stage = new Room(room, options);
  const seconds = options.seconds ?? stage.room.rt60;
  const response = new Float32Array(Math.ceil(seconds * stage.sampleRate));
  for (let index = 0; index < response.length; index++) {
    response[index] = stage.process(index === 0 ? 1 : 0);
  }
  return response;
}
