/** Adapt frame arrays to the Rust inverse-filter ABI. Unlicense. */
import { withWasmMemory } from './wasm-memory.js';

const HEADER = 14;

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
  const { rec_inverse_modes, rec_inverse_filter } = module.exports;
  const useModes = select && rows && typeof rec_inverse_modes === 'function';
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
    packet.set([
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
    ]);
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
