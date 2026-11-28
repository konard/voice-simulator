/** Adapt frame arrays to the Rust inverse-filter ABI. Unlicense. */
import { withWasmMemory } from './wasm-memory.js';

const HEADER = 14;

function nativeModeColumns(frames, pitch) {
  return (
    frames.samples instanceof Float32Array &&
    frames.periodicity instanceof Float32Array &&
    frames.mel instanceof Float32Array &&
    frames.speech instanceof Uint8Array &&
    (!pitch || pitch.f0 instanceof Float32Array)
  );
}

function compactModes(module, frames, pitch, header, select, rows) {
  const { count, sampleCount: n, melBands } = frames;
  return withWasmMemory(module, (allocate) => {
    const metadata = allocate(Float64Array, HEADER, header);
    const indices = allocate(Float64Array, rows.length, rows);
    const speech = allocate(
      Uint8Array,
      count,
      frames.speech.subarray(0, count)
    );
    const length = n + count * (1 + melBands + Number(Boolean(pitch)));
    const input = allocate(Float32Array, length);
    const output = allocate(Float32Array, select.length * count);
    const values = input.view();
    values.set(frames.samples.subarray(0, n));
    values.set(frames.periodicity.subarray(0, count), n);
    values.set(frames.mel.subarray(0, count * melBands), n + count);
    if (pitch) {
      values.set(pitch.f0.subarray(0, count), length - count);
    }
    const written = module.exports.rec_inverse_modes_f32(
      metadata.pointer,
      input.pointer,
      speech.pointer,
      indices.pointer,
      indices.length,
      output.pointer,
      output.length
    );
    if (written < 0) {
      throw new RangeError(`Rust inverse filter failed (${written})`);
    }
    const result = output.view(written);
    return Object.fromEntries(
      select.map((name, column) => [
        name,
        result.slice(column * count, (column + 1) * count),
      ])
    );
  });
}

export function inverseFilterRust(
  module,
  frames,
  options,
  measures,
  select,
  rows
) {
  const {
    count,
    sampleCount: n,
    rate,
    hop,
    window,
    startTime,
    melBands,
  } = frames;
  const { pitch, tractOrder, glottisOrder, leak, step, minF0, maxF0 } = options;
  const header = [
    rate,
    hop,
    window,
    startTime,
    count,
    n,
    melBands,
    tractOrder,
    glottisOrder,
    leak,
    step,
    minF0,
    maxF0,
    Number(Boolean(pitch)),
  ];
  const { rec_inverse_modes, rec_inverse_modes_f32, rec_inverse_filter } =
    module.exports;
  const project = select && rows;
  if (
    project &&
    typeof rec_inverse_modes_f32 === 'function' &&
    nativeModeColumns(frames, pitch)
  ) {
    return compactModes(module, frames, pitch, header, select, rows);
  }
  const useModes = project && typeof rec_inverse_modes === 'function';
  const packetLength =
    HEADER + n + count * (2 + melBands + Number(Boolean(pitch)));
  const length = packetLength + (useModes ? rows.length : 0);
  const capacity = useModes
    ? select.length * count
    : 4 + 3 * n + count * (measures.length + 1) + measures.length * 4;
  return withWasmMemory(module, (allocate) => {
    const input = allocate(Float64Array, length);
    const output = allocate(Float64Array, capacity);
    const packet = input.view();
    packet.set(header);
    packet.set(frames.samples.subarray(0, n), HEADER);
    packet.set(frames.speech.subarray(0, count), HEADER + n);
    packet.set(frames.periodicity.subarray(0, count), HEADER + n + count);
    packet.set(
      frames.mel.subarray(0, count * melBands),
      HEADER + n + 2 * count
    );
    if (pitch) {
      packet.set(pitch.f0.subarray(0, count), packetLength - count);
    }
    if (useModes) {
      packet.set(rows, packetLength);
    }
    const kernel = useModes ? rec_inverse_modes : rec_inverse_filter;
    const written = kernel(
      input.pointer,
      input.length,
      output.pointer,
      output.length
    );
    if (written < 0) {
      throw new RangeError(`Rust inverse filter failed (${written})`);
    }
    const values = output.view(written);
    if (select) {
      const first = useModes ? 0 : 4 + 2 * n + values[2];
      return Object.fromEntries(
        select.map((name, column) => {
          const start =
            first + (useModes ? column : measures.indexOf(name)) * count;
          return [
            name,
            Float32Array.from(values.subarray(start, start + count)),
          ];
        })
      );
    }
    let at = 4;
    function take(Type, size) {
      const copy = Type.from(values.subarray(at, at + size));
      at += size;
      return copy;
    }
    const result = {
      hop,
      startTime,
      count,
      rate,
      flow: take(Float32Array, n),
      flowDerivative: take(Float32Array, n),
      gci: Array.from(take(Float64Array, values[2])),
      lowBand: Boolean(values[3]),
      summary: {},
    };
    for (const name of measures) {
      result[name] = take(Float32Array, count);
    }
    result.reliable = take(Uint8Array, count);
    const nullable = (value) => (Number.isNaN(value) ? null : value);
    for (const name of measures) {
      result.summary[name] = {
        median: nullable(values[at++]),
        low: nullable(values[at++]),
        high: nullable(values[at++]),
        frames: values[at++],
      };
    }
    return result;
  });
}
