/** Five-frame power and autocorrelation pooling for whispered speech. Unlicense. */
import { lpcFromAutocorrelation } from './lpc.js';

export function poolPowerFrames(frames) {
  return frames.map((frame, i) => {
    const from = Math.max(0, i - 2);
    const to = Math.min(frames.length, i + 3);
    const sum = new Float64Array(frame.length);
    for (let row = from; row < to; row++) {
      for (let bin = 0; bin < sum.length; bin++) {
        sum[bin] += frames[row][bin] / (to - from);
      }
    }
    return sum;
  });
}

export function poolLogPower(frames, key, first, last, width, scale) {
  const input = frames[key];
  const output = new Float32Array(input.length);
  for (let i = first; i < last; i++) {
    const from = Math.max(first, i - 2);
    const to = Math.min(last, i + 3);
    for (let band = 0; band < width; band++) {
      let power = 0;
      for (let t = from; t < to; t++) {
        power += Math.exp(input[t * width + band] * scale);
      }
      output[i * width + band] = Math.log(power / (to - from)) / scale;
    }
  }
  return output;
}

export function whisperRowAt(frames, seconds) {
  return Math.max(
    0,
    Math.min(
      frames.count,
      Math.ceil((seconds - frames.startTime) / frames.hop - 1e-9)
    )
  );
}

function autocorrelate(frames, first, last) {
  const { samples, sampleCount, rate, order, window, hop } = frames;
  const length = Math.round(window * rate);
  const hann = Float64Array.from(
    { length },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (length - 1))
  );
  const data = new Float64Array((last - first) * (order + 1));
  const signal = new Float64Array(length);
  for (let row = first; row < last; row++) {
    const start = Math.round(row * hop * rate) - Math.floor(length / 2);
    let previous = start > 0 ? samples[start - 1] : 0;
    for (let i = 0; i < length; i++) {
      const index = start + i;
      const value = index >= 0 && index < sampleCount ? samples[index] : 0;
      signal[i] = (value - 0.97 * previous) * hann[i];
      previous = value;
    }
    for (let lag = 0; lag <= order; lag++) {
      let sum = 0;
      for (let i = lag; i < length; i++) {
        sum += signal[i] * signal[i - lag];
      }
      data[(row - first) * (order + 1) + lag] = sum / length;
    }
  }
  return data;
}

function poolCorrelation(correlation, order, pooled, from, to) {
  pooled.fill(0);
  for (let row = from; row < to; row++) {
    for (let j = 0; j <= order; j++) {
      pooled[j] += correlation[row * (order + 1) + j] / (to - from);
    }
  }
}

/** Five steady 25 ms windows, centred 5 ms apart, away from the render edges. */
export function whisperReferenceLpc(samples, rate, order, lpc, reflection) {
  const frames = {
    samples,
    sampleCount: samples.length,
    rate,
    order,
    window: 0.025,
    hop: 0.005,
  };
  const correlation = autocorrelate(frames, 8, 13);
  const pooled = new Float64Array(order + 1);
  poolCorrelation(correlation, order, pooled, 0, 5);
  return lpcFromAutocorrelation(pooled, order, lpc, reflection);
}

function poolLpcRows(frames, spans, out, from, to) {
  const { order } = frames;
  const pooled = new Float64Array(order + 1);
  for (const span of spans) {
    const first = whisperRowAt(frames, span.start);
    const last = whisperRowAt(frames, span.end);
    const startRow = Math.max(from, first);
    const endRow = Math.min(to, last);
    if (startRow >= endRow) {
      continue;
    }
    const begin = Math.max(first, startRow - 2);
    const correlationEnd = Math.min(last, endRow + 2);
    const correlation = autocorrelate(frames, begin, correlationEnd);
    out.whisper.fill(1, startRow, endRow);
    for (let i = startRow; i < endRow; i++) {
      const left = Math.max(0, i - begin - 2);
      const right = Math.min(correlationEnd - begin, i - begin + 3);
      poolCorrelation(correlation, order, pooled, left, right);
      const start = i * order;
      const end = start + order;
      const residual = lpcFromAutocorrelation(
        pooled,
        order,
        out.lpc.subarray(start, end),
        out.reflection.subarray(start, end)
      );
      out.gain[i] = 10 * Math.log10(residual + 1e-10);
    }
  }
}

function formantFrameView(frames) {
  return {
    ...frames,
    whisper: new Uint8Array(frames.capacity),
    lpc: new Float32Array(frames.lpc.length),
    gain: new Float32Array(frames.gain.length),
    reflection: new Float32Array(frames.reflection.length),
  };
}

function copyLpcRows(frames, out, from, to) {
  for (const key of ['lpc', 'reflection', 'gain']) {
    const stride = key === 'gain' ? 1 : frames.order;
    out[key].set(
      frames[key].subarray(from * stride, to * stride),
      from * stride
    );
  }
}

export function whisperFormantFrames(frames, spans) {
  if (!spans.length) {
    return frames;
  }
  const out = formantFrameView(frames);
  copyLpcRows(frames, out, 0, frames.count);
  poolLpcRows(frames, spans, out, 0, frames.count);
  return out;
}

/** The incremental stages may only consume frames whose mode is decided. */
export function createWhisperFramePool(frames) {
  const out = formantFrameView(frames);
  return {
    frames: out,
    advance({ through, spans }, final) {
      let end = whisperRowAt(frames, through);
      const open = spans.at(-1);
      if (!final && open && whisperRowAt(frames, open.end) >= end - 1) {
        // Leave both future support frames unconsumed at a live whisper edge.
        end = Math.min(
          end,
          Math.max(whisperRowAt(frames, open.start), end - 2)
        );
      }
      if (end > out.count) {
        copyLpcRows(frames, out, out.count, end);
        poolLpcRows(frames, spans, out, out.count, end);
        out.count = end;
      }
      out.sampleCount = frames.sampleCount;
    },
  };
}

export function whisperSpectrum(frames, start, end) {
  const first = whisperRowAt(frames, start);
  const last = whisperRowAt(frames, end);
  const { melBands, startTime, hop } = frames;
  const mel = poolLogPower(frames, 'mel', first, last, melBands, 1);
  const energy = poolLogPower(frames, 'energy', first, last, 1, Math.LN10 / 10);
  const ordered = energy.slice(first, last).sort();
  const nominal = ordered[Math.floor(0.85 * ordered.length)] ?? 0;
  for (let i = first; i < last; i++) {
    let average = 0;
    for (let j = 0; j < melBands; j++) {
      average += mel[i * melBands + j] / melBands;
    }
    for (let j = 0; j < melBands; j++) {
      mel[i * melBands + j] -= average;
    }
  }
  return {
    sample(time, array, offset) {
      const row = Math.max(first, Math.min(last - 1, (time - startTime) / hop));
      const before = Math.floor(row);
      const after = Math.min(last - 1, before + 1);
      const frac = row - before;
      for (let j = 0; j < melBands; j++) {
        const a = mel[before * melBands + j];
        const b = mel[after * melBands + j];
        array[offset + j] = a + frac * (b - a);
      }
      array[offset + melBands] = Math.max(
        -35,
        energy[before] + frac * (energy[after] - energy[before]) - nominal
      );
    },
  };
}
