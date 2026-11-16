/**
 * The voxel model of the head (buildVoxelModel of
 * src/acoustics/voxel-model.js) packed into one ArrayBuffer for the Rust
 * 3D FDTD solver (issue 23, docs/RUST-ENGINE.md). The Rust side reads it
 * in `crates/voice-simulator-core/src/fdtd/model.rs`, which carries the
 * same layout table.
 *
 * Layout. All numbers are little-endian. The buffer starts with
 * MODEL_HEADER.WORDS u32 words (MODEL_HEADER below); the arrays follow in
 * this order, each starting at a multiple of 8 bytes (zero padding):
 *
 * | section            | array                    | type | values               |
 * | ------------------ | ------------------------ | ---- | -------------------- |
 * | dx                 | dx                       | f64  | 1                    |
 * | opening (flag)     | binLength, sample        | f64  | 2                    |
 * |                    | origin                   | f64  | 1                    |
 * |                    | bin starts               | i32  | bins + 1             |
 * |                    | weights                  | f64  | points               |
 * |                    | shares                   | f64  | points               |
 * |                    | heads                    | f64  | points + bins        |
 * |                    | tails                    | f64  | points + bins        |
 * |                    | row of each cell (or -1) | i32  | cells                |
 * |                    | cell weights             | f64  | rows * per           |
 * |                    | cell tails               | f64  | rows * (per + 1)     |
 * | cells              | kind                     | i32  | cells                |
 * |                    | tube (-1 for free air)   | i32  | cells                |
 * |                    | arc                      | f64  | cells                |
 * |                    | point (x, y, z)          | f64  | 3 * cells            |
 * | links              | a, b, kind               | i32  | links each           |
 * | openFaces          | open faces               | f64  | cells                |
 * | boundaryAdmittance | admittance               | f64  | 1                    |
 * | enclosure          | 1 with an enclosure      | f64  | 1                    |
 * | lengths            | tract, nose              | f64  | 2                    |
 * | larynxTravel       | travel (cm)              | f64  | 1                    |
 * | sinuses            | tube, area, length       | f64  | 3 * sinuses          |
 * |                    | opening links per place  | i32  | sinuses * places     |
 * |                    | opening links            | i32  | pouch links          |
 * | landmarks          | lips xyz, nostrils xyz   | f64  | 6                    |
 * | teeth (flag)       | edge, width              | f64  | 2                    |
 * |                    | cells, groups            | i32  | teeth cells each     |
 * | openMasks          | open face bits           | i32  | cells                |
 *
 * Bin `b` of the opening table holds the points `starts[b]..starts[b+1]`
 * of weights and shares, and its heads and tails (one more value each)
 * start at `starts[b] + b`. Only the tract cells have opening rows (the
 * table of the JavaScript model is zero elsewhere), which keeps a model
 * with a large enclosure small.
 *
 * `places` (MODEL_HEADER.PLACES) is the number of places of the glottis
 * (`sinus.openings.length`, the same for every sinus): the counts list,
 * for each sinus and then each place from the lowest, how many of the
 * opening links (`sinus.openings[place]`, indices into the links) follow.
 */

import { CELL_AIR } from '../acoustics/voxel-model.js';
import {
  microphonePosition,
  resolveMicrophone,
} from '../acoustics/microphone.js';

/** Indices of the u32 header words of a packed model. */
export const MODEL_HEADER = Object.freeze({
  MAGIC: 0,
  VERSION: 1,
  BYTES: 2,
  CELLS: 3,
  LINKS: 4,
  SINUSES: 5,
  TEETH_CELLS: 6,
  OPENING_PER: 7,
  OPENING_BINS: 8,
  OPENING_POINTS: 9,
  OPENING_ROWS: 10,
  FLAGS: 11,
  PLACES: 12,
  POUCH_LINKS: 13,
  WORDS: 14,
});

/** 'VSMD' as a little-endian u32. */
export const MODEL_MAGIC = 0x444d5356;
export const MODEL_VERSION = 2;
/** Bits of MODEL_HEADER.FLAGS. */
export const MODEL_FLAGS = Object.freeze({ OPENING: 1, TEETH: 2 });

function align(offset) {
  return Math.ceil(offset / 8) * 8;
}

/** The arrays of a model in layout order, as [type, values] pairs. */
export function modelArrays(model) {
  const { cells, links, opening, teeth } = model;
  const count = cells.length;
  const sinuses = model.sinuses ?? [];
  const places = Math.max(0, ...sinuses.map((s) => s.openings?.length ?? 0));
  const openings = sinuses.flatMap((sinus) =>
    Array.from({ length: places }, (_, place) =>
      Array.from(sinus.openings?.[place] ?? [])
    )
  );
  const pouchLinks = openings.flat();
  const arrays = [['f64', [model.dx]]];
  const header = {
    cells: count,
    links: links.a.length,
    sinuses: sinuses.length,
    teethCells: teeth ? teeth.cells.length : 0,
    per: 0,
    bins: 0,
    points: 0,
    rows: 0,
    places,
    pouchLinks: pouchLinks.length,
    flags:
      (opening ? MODEL_FLAGS.OPENING : 0) | (teeth ? MODEL_FLAGS.TEETH : 0),
  };
  if (opening) {
    const { per, bins } = opening;
    const starts = [0];
    for (const bin of bins) {
      starts.push(starts.at(-1) + bin.weights.length);
    }
    const points = starts.at(-1);
    const flat = (name) => bins.flatMap((bin) => Array.from(bin[name]));
    const rows = new Int32Array(count).fill(-1);
    const weights = [];
    const tails = [];
    cells.forEach((cell, index) => {
      if (cell.kind === 0) {
        rows[index] = weights.length / per;
        const start = index * per;
        weights.push(...opening.cellWeights.subarray(start, start + per));
        const tail = index * (per + 1);
        tails.push(...opening.cellTails.subarray(tail, tail + per + 1));
      }
    });
    Object.assign(header, {
      per,
      bins: bins.length,
      points,
      rows: weights.length / per,
    });
    arrays.push(
      ['f64', [opening.binLength, opening.sample]],
      ['f64', [opening.origin ?? 0]],
      ['i32', starts],
      ['f64', flat('weights')],
      ['f64', flat('shares')],
      ['f64', flat('heads')],
      ['f64', flat('tails')],
      ['i32', rows],
      ['f64', weights],
      ['f64', tails]
    );
  }
  arrays.push(
    ['i32', cells.map((cell) => cell.kind)],
    [
      'i32',
      cells.map((cell) =>
        cell.kind === CELL_AIR ? -1 : (cell.tube ?? cell.kind)
      ),
    ],
    ['f64', cells.map((cell) => cell.arc)],
    ['f64', cells.flatMap((cell) => cell.point)],
    ['i32', links.a],
    ['i32', links.b],
    ['i32', links.kind],
    ['f64', model.openFaces],
    ['f64', [model.boundaryAdmittance ?? 1]],
    ['f64', [model.enclosure ? 1 : 0]],
    ['f64', [model.lengths[0], model.lengths[1]]],
    ['f64', [model.larynxTravel ?? 0]],
    ['f64', sinuses.flatMap((sinus) => [sinus.tube, sinus.area, sinus.length])],
    ['i32', openings.map((links) => links.length)],
    ['i32', pouchLinks],
    ['f64', [...model.landmarks.lips, ...model.landmarks.nostrils]]
  );
  if (teeth) {
    arrays.push(
      ['f64', [teeth.edge, teeth.width]],
      ['i32', teeth.cells],
      ['i32', teeth.groups]
    );
  }
  arrays.push(['i32', model.openMasks ?? new Int32Array(count)]);
  return { header, arrays };
}

/**
 * Pack a voxel model for the Rust solver (layout above).
 * @param {ReturnType<typeof import('../acoustics/voxel-model.js').buildVoxelModel>} model
 * @returns {ArrayBuffer}
 */
export function packVoxelModel(model) {
  const { header, arrays } = modelArrays(model);
  let bytes = align(4 * MODEL_HEADER.WORDS);
  for (const [type, values] of arrays) {
    bytes = align(bytes + (type === 'f64' ? 8 : 4) * values.length);
  }
  const buffer = new ArrayBuffer(bytes);
  const view = new DataView(buffer);
  const H = MODEL_HEADER;
  const words = [
    [H.MAGIC, MODEL_MAGIC],
    [H.VERSION, MODEL_VERSION],
    [H.BYTES, bytes],
    [H.CELLS, header.cells],
    [H.LINKS, header.links],
    [H.SINUSES, header.sinuses],
    [H.TEETH_CELLS, header.teethCells],
    [H.OPENING_PER, header.per],
    [H.OPENING_BINS, header.bins],
    [H.OPENING_POINTS, header.points],
    [H.OPENING_ROWS, header.rows],
    [H.FLAGS, header.flags],
    [H.PLACES, header.places],
    [H.POUCH_LINKS, header.pouchLinks],
  ];
  for (const [index, value] of words) {
    view.setUint32(4 * index, value, true);
  }
  let offset = align(4 * MODEL_HEADER.WORDS);
  for (const [type, values] of arrays) {
    for (let index = 0; index < values.length; index++) {
      if (type === 'f64') {
        view.setFloat64(offset + 8 * index, values[index], true);
      } else {
        view.setInt32(offset + 4 * index, values[index], true);
      }
    }
    offset = align(offset + (type === 'f64' ? 8 : 4) * values.length);
  }
  return buffer;
}

/**
 * The header words of a packed model, by MODEL_HEADER name.
 * @param {ArrayBuffer} buffer
 * @returns {Record<string, number>}
 */
export function modelHeader(buffer) {
  const view = new DataView(buffer);
  const header = {};
  for (const [name, index] of Object.entries(MODEL_HEADER)) {
    if (name !== 'WORDS') {
      header[name] = view.getUint32(4 * index, true);
    }
  }
  return header;
}

/** Index of the free-air cell closest to a point (nearestAirCell of fdtd3d.js). */
function nearestAirCell(cells, point) {
  let best = -1;
  let bestDistance = Infinity;
  cells.forEach((cell, index) => {
    if (cell.kind !== CELL_AIR) {
      return;
    }
    const distance = Math.hypot(
      ...cell.point.map((value, axis) => value - point[axis])
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

/**
 * What the Rust 3D solver and the listener need from the Fdtd3d
 * constructor besides the model: the output, whether the free-air shell
 * gets the spherical boundary, the point the receiver cell is chosen
 * for, and the `microphoneDistance` and `simulatesEnclosure` that
 * createListener reads from the solver (#placeMicrophone of fdtd3d.js).
 * @param {object} model the voxel model
 * @param {{microphone?: object, output?: 'flow'|'microphone'}} [options]
 */
export function fdtdListening(model, options = {}) {
  const listening = Boolean(options.microphone || model.enclosure);
  const output = options.output ?? (listening ? 'microphone' : 'flow');
  const microphone = resolveMicrophone(options.microphone);
  const { lips } = model.landmarks;
  const target = microphone
    ? microphonePosition(microphone, lips)
    : [lips[0], lips[1], lips[2] + 3];
  const result = {
    output,
    spherical: Boolean(options.microphone && !model.enclosure),
    target,
  };
  if (output !== 'microphone') {
    return result;
  }
  result.simulatesEnclosure = Boolean(model.enclosure);
  if (microphone) {
    const cell = nearestAirCell(model.cells, target);
    const { point } = model.cells[cell];
    const offset = Math.hypot(
      ...point.map((value, axis) => value - target[axis])
    );
    result.microphoneDistance =
      offset > model.dx
        ? Math.hypot(...point.map((value, axis) => value - lips[axis]))
        : microphone.distance;
  }
  return result;
}
