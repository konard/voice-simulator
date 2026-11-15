/**
 * Layouts of the arrays the JavaScript side hands to the Rust renderer
 * (issue 22, docs/RUST-ENGINE.md). Each name is the index of one `f64`;
 * the same names and numbers are constants in
 * `crates/voice-simulator-core/src/config.rs` (RENDERER_CONFIG) and
 * `crates/voice-simulator-core/src/frame.rs` (FRAME), and
 * tests/engine-layout.test.js compares the files as text.
 */

/**
 * The renderer configuration, filled once per renderer: HEADER fixed
 * fields, then NOSE_AREA_COUNT nose areas (`noseShape(head).areas`), then
 * LISTENER_LENGTH listener values (LISTENER below). Flags are 0 or 1,
 * seeds are `hashSeed` values and BAND_LIMIT is 0 for none.
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
  HEADER: 28,
});

/**
 * One control frame: the shape of one control block. STRIDE fixed fields,
 * then the area of every section (cm²), so a frame has STRIDE + sections
 * values. LUNG_PRESSURE (Pa) is `state.lungPressure ?? head.lungPressure`.
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
  RESERVED: 15,
  AREAS: 16,
  STRIDE: 16,
});

/** Values of one frame for a tract of `sections` sections. */
export function frameStride(sections) {
  return FRAME.STRIDE + sections;
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
  target[offset + FRAME.RESERVED] = 0;
  target.set(shape.areas, offset + FRAME.AREAS);
}
