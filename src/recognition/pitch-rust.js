/** Scratch-buffer lifetime for the numeric pitch kernels. Unlicense. */
import { withWasmMemory } from './wasm-memory.js';

export function withPitchDsp(module, settings, run) {
  if (!module) {
    return run();
  }
  return withWasmMemory(module, (allocate) => {
    const { size, coarseLength, lagMax, factor, fullLength } = settings;
    const {
      rec_pitch: correlate,
      rec_pitch_refine: refine,
      rec_pitch_mark: mark,
    } = module.exports;
    const coarse = allocate(Float64Array, coarseLength);
    const coarseWindow = allocate(Float64Array, lagMax + 2);
    const peaks = allocate(Float64Array, lagMax + 2);
    const full = allocate(Float64Array, fullLength);
    const fullWindow = allocate(
      Float64Array,
      Math.min(fullLength, factor * (lagMax + 1) + factor + 2)
    );
    const fullCorrelation = allocate(Float64Array, fullWindow.length);
    const refined = allocate(Float64Array, 2);
    const region = allocate(Float32Array, fullLength + 4);
    let coarseReady = false;
    let fullReady = false;
    settings.dsp = {
      correlate(data, window, q) {
        coarse.view().set(data.subarray(0, coarseLength));
        if (!coarseReady) {
          coarseWindow.view().set(window);
          coarseReady = true;
        }
        const count = correlate(
          coarse.pointer,
          coarse.length,
          coarseWindow.pointer,
          coarseWindow.length,
          size,
          peaks.pointer
        );
        if (count > 0) {
          q.set(peaks.view());
        }
        return count > 0;
      },
      load(frame, window) {
        full.view().set(frame);
        fullCorrelation.view().fill(NaN);
        if (!fullReady) {
          fullWindow.view().set(window);
          fullReady = true;
        }
      },
      refine(energy, centre) {
        refine(
          full.pointer,
          full.length,
          fullWindow.pointer,
          fullWindow.length,
          energy,
          centre,
          factor,
          fullCorrelation.pointer,
          refined.pointer
        );
        const [position, height] = refined.view();
        return position < 0 ? null : [position, height];
      },
      mark(frames, anchor, lo, hi, span) {
        const from = Math.max(0, Math.min(anchor, lo - 1));
        const end = Math.min(
          frames.sampleCount,
          Math.max(anchor, hi + 1) + span
        );
        const range = frames.samples.subarray(from, end);
        region.view().set(range);
        return (
          from +
          mark(
            region.pointer,
            range.length,
            anchor - from,
            lo - from,
            hi - from,
            span
          )
        );
      },
    };
    try {
      return run();
    } finally {
      settings.dsp = undefined;
    }
  });
}
