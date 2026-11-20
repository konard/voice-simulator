/** Five-frame power and autocorrelation pooling for whispered speech. Unlicense. */
import { lpcFromAutocorrelation } from './lpc.js';

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

function rowAt(frames, seconds) {
  return Math.max(
    0,
    Math.min(
      frames.count,
      Math.ceil((seconds - frames.startTime) / frames.hop - 1e-9)
    )
  );
}

function autocorrelate(frames) {
  const { samples, sampleCount, count, rate, order, window, hop } = frames;
  const length = Math.round(window * rate);
  const hann = Float64Array.from(
    { length },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (length - 1))
  );
  const data = new Float64Array(count * (order + 1));
  const signal = new Float64Array(length);
  for (let row = 0; row < count; row++) {
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
      data[row * (order + 1) + lag] = sum / length;
    }
  }
  return data;
}

export function whisperFormantFrames(frames, spans) {
  if (!spans.length) {
    return frames;
  }
  const { order } = frames;
  const correlation = autocorrelate(frames);
  const pooled = new Float64Array(order + 1);
  const out = { ...frames, lpc: frames.lpc.slice(), gain: frames.gain.slice() };
  const reflection = new Float64Array(order);
  for (const span of spans) {
    const first = rowAt(frames, span.start);
    const last = rowAt(frames, span.end);
    for (let i = first; i < last; i++) {
      pooled.fill(0);
      const from = Math.max(first, i - 2);
      const to = Math.min(last, i + 3);
      for (let row = from; row < to; row++) {
        for (let j = 0; j <= order; j++) {
          pooled[j] += correlation[row * (order + 1) + j] / (to - from);
        }
      }
      const prediction = out.lpc.subarray(i * order, (i + 1) * order);
      const residual = lpcFromAutocorrelation(
        pooled,
        order,
        prediction,
        reflection
      );
      out.gain[i] = 10 * Math.log10(residual + 1e-10);
    }
  }
  return out;
}

export function whisperSpectrum(frames, start, end) {
  const first = rowAt(frames, start);
  const last = rowAt(frames, end);
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
