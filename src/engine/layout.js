/**
 * Layouts of the arrays the JavaScript side hands to the Rust renderer
 * (issue 22, docs/RUST-ENGINE.md). The same names and numbers are
 * constants in `crates/voice-simulator-core/src/config.rs`
 * (RENDERER_CONFIG), `frame.rs` (FRAME), `listener.rs` (LISTENER) and
 * `source_state.rs` (SOURCE_STATE);
 * tests/engine-layout.test.js compares the files as text.
 */

/**
 * The renderer configuration, filled once per renderer: HEADER fixed
 * fields, then NOSE_AREA_COUNT nose areas (`noseShape(head).areas`), then
 * LISTENER_LENGTH listener values (LISTENER below). Flags are 0 or 1,
 * seeds are `hashSeed` values and BAND_LIMIT is 0 for none. SOLVER is
 * SOLVER_CODES[solver]; the 3D fields (FDTD_OUTPUT to MICROPHONE_Z) come
 * from `fdtdListening` (src/engine/pack-model.js) and are 0 for the
 * waveguide. BREATH_GAIN to RADIATION_BAFFLE are the head's advanced
 * source and loss values (issue 41). LENGTH_SCALE is the `lengthScale` of
 * the 3D solver (where a shape's length puts the glottis, issue 40).
 */
export const RENDERER_CONFIG = Object.freeze({
  SAMPLE_RATE: 0,
  SECTIONS: 1,
  NOSE_SECTIONS: 2,
  BLOCK_SIZE: 3,
  TOTAL_SAMPLES: 4,
  GLOTTIS_SEED: 5,
  NOISE_SEED: 6,
  TENSENESS: 7,
  BREATHINESS: 8,
  JITTER: 9,
  SHIMMER: 10,
  ASPIRATION_LEVEL: 11,
  GLOTTAL_CHINK: 12,
  LUNG_PRESSURE: 13,
  VOCAL_TRACT_LENGTH: 14,
  FRICATION_LEVEL: 15,
  OUTPUT_GAIN: 16,
  WALL_LOSS: 17,
  NASAL_LOSS: 18,
  PHARYNX_WIDTH: 19,
  PIRIFORM: 20,
  TEETH: 21,
  BAND_LIMIT: 22,
  PIRIFORM_INDEX: 23,
  PIRIFORM_AREA: 24,
  PIRIFORM_SECTIONS: 25,
  NOSE_AREA_COUNT: 26,
  LISTENER_LENGTH: 27,
  WALL_MASS: 28,
  WALL_RESISTANCE: 29,
  WALL_STIFFNESS: 30,
  SOLVER: 31,
  FDTD_OUTPUT: 32,
  FDTD_SPHERICAL: 33,
  MICROPHONE_X: 34,
  MICROPHONE_Y: 35,
  MICROPHONE_Z: 36,
  BREATH_GAIN: 37,
  BREATH_EXPONENT: 38,
  BREATHINESS_RD: 39,
  CHINK_NOISE: 40,
  ORAL_COMPLIANCE: 41,
  RE_CRITICAL: 42,
  GLOTTIS_VOICED: 43,
  GLOTTIS_OPEN: 44,
  GLOTTIS_BREATHY: 45,
  WALL_SOURCE: 46,
  STROUHAL: 47,
  FRICATION_GAIN: 48,
  TRANSIENT_GAIN: 49,
  LOSS_SHAPE: 50,
  RADIATION_BAFFLE: 51,
  LENGTH_SCALE: 52,
  HEADER: 53,
});

/** Values of RENDERER_CONFIG.SOLVER and FDTD_OUTPUT. */
export const SOLVER_CODES = Object.freeze({ waveguide: 0, fdtd3d: 1 });
export const FDTD_OUTPUT_CODES = Object.freeze({ flow: 0, microphone: 1 });

/**
 * One control frame: the shape of one control block. STRIDE fixed fields,
 * then the area of every section (cm²), then EXTRA (= FRAME_EXTRA_VALUES)
 * more values, so a frame has STRIDE + sections + FRAME_EXTRA_VALUES
 * values. LUNG_PRESSURE (Pa) is `state.lungPressure ?? head.lungPressure`.
 * TEETH is 1 when the shape has incisors (`shape.teeth`), and the first
 * extra value is then their gap (cm), else 0. EFFORT (dB) and TENSION are
 * `shape.glottis.effort` and `.tension` (issue 52).
 */
export const FRAME = Object.freeze({
  LENGTH: 0,
  VELUM_AREA: 1,
  VELUM_INDEX: 2,
  FRICATION_INDEX: 3,
  FRICATION_POSITION: 4,
  FRICATION_AREA: 5,
  FRICATION_GAIN: 6,
  FRICATION_SIBILANCE: 7,
  FRICATION_OBSTACLE: 8,
  F0: 9,
  VOICING: 10,
  ASPIRATION: 11,
  CLOSURE: 12,
  LOUDNESS: 13,
  LUNG_PRESSURE: 14,
  TEETH: 15,
  EFFORT: 16,
  TENSION: 17,
  EXTRA: 18,
  AREAS: 19,
  STRIDE: 19,
});

/** Values after the areas of a frame: the incisor gap. */
export const FRAME_EXTRA_VALUES = 1;

/**
 * The listener values of RENDERER_CONFIG: `[stage count, stages...]`,
 * each stage starting with its kind (src/engine/listener-layout.js). The
 * same names and numbers are constants in
 * `crates/voice-simulator-core/src/listener.rs`.
 */
export const LISTENER = Object.freeze({
  MICROPHONE: 1,
  ROOM: 2,
  MICROPHONE_VALUES: 9,
  ROOM_VALUES: 29,
  LINES: 8,
});

/**
 * The source state a renderer started mid-utterance takes over (issue 29):
 * `Glottis.saveState()` returns LENGTH values in this order, the last one
 * the state of its random generator (`random.save()`). The same names and
 * numbers are constants in `crates/voice-simulator-core/src/source_state.rs`.
 */
export const SOURCE_STATE = Object.freeze({
  PHASE: 0,
  PERIOD: 1,
  JITTER: 2,
  SHIMMER: 3,
  SMOOTHED: 4,
  INTENSITY: 5,
  NOISE_MODULATION: 6,
  PULSE_TENSENESS: 7,
  RANDOM: 8,
  LENGTH: 9,
});

/** Values of one frame for a tract of `sections` sections. */
export function frameStride(sections) {
  return FRAME.STRIDE + sections + FRAME_EXTRA_VALUES;
}

/**
 * Fill the frame at `offset` of `target` from a tract shape (`tractShape`
 * of src/articulation/tract-shape.js).
 * @param {Float64Array} target
 * @param {number} offset
 * @param {ReturnType<typeof import('../articulation/tract-shape.js').tractShape>} shape
 * @param {number} lungPressure Pa
 */
export function writeFrame(target, offset, shape, lungPressure) {
  const { frication, glottis } = shape;
  target[offset + FRAME.LENGTH] = shape.length;
  target[offset + FRAME.VELUM_AREA] = shape.velumArea;
  target[offset + FRAME.VELUM_INDEX] = shape.velumIndex;
  target[offset + FRAME.FRICATION_INDEX] = frication.index;
  target[offset + FRAME.FRICATION_POSITION] = frication.position;
  target[offset + FRAME.FRICATION_AREA] = frication.area;
  target[offset + FRAME.FRICATION_GAIN] = frication.gain;
  target[offset + FRAME.FRICATION_SIBILANCE] = frication.sibilance;
  target[offset + FRAME.FRICATION_OBSTACLE] = frication.obstacle;
  target[offset + FRAME.F0] = glottis.f0;
  target[offset + FRAME.VOICING] = glottis.voicing;
  target[offset + FRAME.ASPIRATION] = glottis.aspiration;
  target[offset + FRAME.CLOSURE] = glottis.closure;
  target[offset + FRAME.LOUDNESS] = glottis.loudness;
  target[offset + FRAME.LUNG_PRESSURE] = lungPressure;
  target[offset + FRAME.TEETH] = shape.teeth ? 1 : 0;
  target[offset + FRAME.EFFORT] = glottis.effort ?? 0;
  target[offset + FRAME.TENSION] = glottis.tension ?? 0;
  target[offset + FRAME.EXTRA] = FRAME_EXTRA_VALUES;
  target.set(shape.areas, offset + FRAME.AREAS);
  target[offset + FRAME.AREAS + shape.areas.length] = shape.teeth?.gap ?? 0;
}

/** The shared memory of the threads build; see wasm-loader.js. */
export { THREAD_MEMORY } from './wasm-loader.js';
