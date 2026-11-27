/** Scratch-buffer lifetime for the numeric pitch kernels. Unlicense. */
import { withWasmMemory } from './wasm-memory.js';

function createDecimator(decimate, allocate, coarse, factor) {
  const block = coarse.length;
  let lowPass;
  return (frames, kernel, half, first, output) => {
    if (!lowPass) {
      const taps = allocate(Float64Array, kernel.length);
      taps.view().set(kernel);
      lowPass = {
        taps,
        samples: allocate(Float32Array, (block - 1) * factor + kernel.length),
      };
    }
    for (let offset = 0; offset < output.length; offset += block) {
      const count = Math.min(block, output.length - offset);
      const start = (first + offset) * factor - half;
      const end = start + (count - 1) * factor + kernel.length;
      const from = Math.min(frames.sampleCount, Math.max(0, start));
      const input = frames.samples.subarray(
        from,
        Math.max(0, Math.min(frames.sampleCount, end))
      );
      lowPass.samples.view().set(input);
      const error = decimate(
        lowPass.samples.pointer,
        input.length,
        lowPass.taps.pointer,
        kernel.length,
        start - from,
        factor,
        coarse.pointer,
        count
      );
      if (error) {
        throw new Error(`Rust pitch decimation failed (${error})`);
      }
      output.set(coarse.view(count), offset);
    }
  };
}

export function withPitchDsp(module, settings, run) {
  if (!module) {
    return run();
  }
  return withWasmMemory(module, (allocate) => {
    const { size, coarseLength, lagMax, factor, fullLength } = settings;
    const {
      rec_pitch_decimate: decimate,
      rec_pitch: correlate,
      rec_pitch_frame: windowFrame,
      rec_pitch_refine: refine,
      rec_pitch_mark: mark,
    } = module.exports;
    const coarse = allocate(Float64Array, coarseLength);
    const coarseWindow = allocate(Float64Array, lagMax + 2);
    const peaks = allocate(Float64Array, lagMax + 2);
    const full = allocate(Float64Array, fullLength);
    const taper = allocate(Float64Array, fullLength);
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
      decimate: createDecimator(decimate, allocate, coarse, factor),
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
      load(frames, start, window, correlation, frame) {
        const from = Math.max(0, start);
        const end = Math.min(frames.sampleCount, start + fullLength);
        const samples = frames.samples.subarray(from, end);
        region.view().set(samples);
        fullCorrelation.view().fill(NaN);
        if (!fullReady) {
          taper.view().set(window);
          fullWindow.view().set(correlation);
          fullReady = true;
        }
        const error = windowFrame(
          region.pointer,
          samples.length,
          Math.min(fullLength, from - start),
          fullLength,
          taper.pointer,
          full.pointer,
          refined.pointer
        );
        if (error) {
          throw new Error(`Rust pitch window failed (${error})`);
        }
        const values = refined.view();
        frame.energy = values[0];
        frame.largest = values[1];
      },
      refine(energy, centre, peak) {
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
        const values = refined.view();
        if (values[0] < 0) {
          return false;
        }
        peak.set(values);
        return true;
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
