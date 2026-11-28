/**
 * Streaming analysis front end of the recognizer (issue 58): the transform,
 * linear prediction, the chunked resampler and the analysis frames of a
 * recording and of a stream.
 */

import { describe, it, expect } from 'test-anywhere';
import {
  FRONTEND_DEFAULTS,
  analyzeFrames,
  createFft,
  createFrameAnalyzer,
  createRandom,
  createResampler,
  lpcAutocorrelation,
  lpcBurg,
  lpcCovariance,
  lpcLevel,
  predictorFromReflection,
  resample,
  synthesize,
  trackPitch,
} from '../src/index.js';
import {
  analyzeFrameHops,
  analyzeOwnedFrames,
  analyzePitchFrames,
  createSpeechAnalyzer,
} from '../src/recognition/frontend.js';

/** Every array of a frame set with its row width. */
const COLUMNS = [
  'energy',
  'zcr',
  'tilt',
  'gravity',
  'periodicity',
  'noise',
  'gain',
  'speech',
  'lpc',
  'reflection',
  'mel',
  'cepstrum',
  'band',
];

function width(frames, name) {
  return frames[name].length / frames.capacity;
}

/** Largest difference over the valid rows of two frame sets. */
function largestDifference(left, right) {
  let largest = 0;
  for (const name of COLUMNS) {
    const length = left.count * width(left, name);
    for (let index = 0; index < length; index++) {
      const difference = Math.abs(left[name][index] - right[name][index]);
      largest = Math.max(largest, Number.isNaN(difference) ? 1 : difference);
    }
  }
  return largest;
}

/** Push `samples` in chunks of 1, 7, 160 and 1024 samples in turn. */
function streamFrames(samples, sampleRate) {
  const analyzer = createFrameAnalyzer(sampleRate, {
    maxSeconds: samples.length / sampleRate,
  });
  const sizes = [1, 7, 160, 1024];
  let added = 0;
  for (let start = 0, turn = 0; start < samples.length; turn++) {
    const size = sizes[turn % sizes.length];
    added += analyzer.push(samples.subarray(start, start + size));
    start += size;
  }
  added += analyzer.flush();
  expect(added).toBe(analyzer.frames.count);
  return analyzer.frames;
}

function expectedCount(frames) {
  return Math.floor((frames.sampleCount - 1) / (frames.hop * frames.rate)) + 1;
}

/** Seeded uniform white noise of RMS `10^(level / 20)`. */
function whiteNoise(length, level, seed) {
  const random = createRandom(seed);
  const amplitude = 10 ** (level / 20) * Math.sqrt(3);
  return Float32Array.from({ length }, () => (random() * 2 - 1) * amplitude);
}

it('shares waveform analysis across hops while preserving independent noise tracking', () => {
  const sampleRate = 8000;
  const samples = whiteNoise(8401, -28, 77);
  samples.fill(0, 0, 3200);
  samples.fill(0, 7900);
  const { fine, coarse } = analyzeFrameHops(samples, sampleRate);
  expect(fine).toEqual(analyzeFrames(samples, sampleRate, { hop: 0.005 }));
  expect(coarse).toEqual(analyzeFrames(samples, sampleRate, { hop: 0.01 }));
});

it('measures the pitch inputs without building unused spectral columns', () => {
  const sampleRate = 16000;
  const samples = whiteNoise(12001, -30, 77);
  samples.fill(0, 0, 3200);
  for (let i = 4000; i < 7600; i++) {
    samples[i] += 0.2 * Math.sin((2 * Math.PI * 150 * i) / sampleRate);
  }
  samples.fill(0, 11500);
  for (const rate of [sampleRate, 8000]) {
    const options = { hop: 0.01, rate };
    const full = analyzeFrames(samples, sampleRate, options);
    const pitchOnly = analyzePitchFrames(samples, sampleRate, options);
    expect(pitchOnly.energy).toEqual(full.energy);
    expect(pitchOnly.noise).toEqual(full.noise);
    expect(pitchOnly.mel).toBeUndefined();
    expect(trackPitch(pitchOnly)).toEqual(trackPitch(full));
  }
});

it('matches copied pitch frames at both edges of an 8 kHz sample view', () => {
  const sampleRate = 8000;
  const samples = whiteNoise(8347, -22, 88).subarray(19, 8293);
  for (const hop of [0.005, 0.01]) {
    const borrowed = analyzePitchFrames(samples, sampleRate, { hop });
    const copied = analyzePitchFrames(Array.from(samples), sampleRate, { hop });
    expect(borrowed.samples).toBe(samples);
    expect(borrowed.count).toBe(copied.count);
    expect(borrowed.energy).toEqual(copied.energy);
    expect(borrowed.noise).toEqual(copied.noise);
    expect(trackPitch(borrowed)).toEqual(trackPitch(copied));
  }
});

it('analyzes an owned waveform without copying its samples or changing any frame', () => {
  const rate = 8000;
  const samples = whiteNoise(1683, -24, 331).subarray(9, 1610);
  for (const size of [0, 7, 1601]) {
    const view = samples.subarray(0, size);
    const owned = analyzeOwnedFrames(view, rate, { hop: 0.01 });
    const copied = analyzeFrames(view, rate, { hop: 0.01 });
    expect(owned.samples).toBe(view);
    expect(owned).toEqual({ ...copied, samples: view });
  }
});

it('keeps the speech gate identical with compact streaming frames', () => {
  const sampleRate = 16000;
  const samples = whiteNoise(8001, -40, 77);
  for (let i = 2000; i < 6200; i++) {
    samples[i] += 0.15 * Math.sin((2 * Math.PI * 170 * i) / sampleRate);
  }
  const options = { rate: 8000, maxSeconds: 0.6 };
  const full = createFrameAnalyzer(sampleRate, options);
  const gate = createSpeechAnalyzer(sampleRate, options);
  for (const analyzer of [full, gate]) {
    analyzer.push(samples.subarray(0, 4000));
    analyzer.trim(3);
    analyzer.push(samples.subarray(4000));
    analyzer.flush();
  }
  for (const column of ['energy', 'noise', 'periodicity', 'speech']) {
    expect(gate.frames[column]).toEqual(full.frames[column]);
  }
  expect(gate.frames.sampleCount).toBe(full.frames.sampleCount);
  expect(gate.frames.count).toBe(full.frames.count);
  expect(gate.frames.mel).toBeUndefined();
});

describe('recognition front end: transforms', () => {
  it('transforms like a direct sum', () => {
    const random = createRandom('issue-58-fft');
    const size = 64;
    const x = Float64Array.from({ length: size }, () => random() * 2 - 1);
    const y = Float64Array.from({ length: size }, () => random() * 2 - 1);
    const fft = createFft(size);
    expect(fft.size).toBe(size);
    const re = Float64Array.from(x);
    const im = Float64Array.from(y);
    fft.forward(re, im);
    let largest = 0;
    for (let k = 0; k < size; k++) {
      let sumRe = 0;
      let sumIm = 0;
      for (let n = 0; n < size; n++) {
        const angle = (-2 * Math.PI * k * n) / size;
        sumRe += x[n] * Math.cos(angle) - y[n] * Math.sin(angle);
        sumIm += x[n] * Math.sin(angle) + y[n] * Math.cos(angle);
      }
      largest = Math.max(
        largest,
        Math.abs(sumRe - re[k]),
        Math.abs(sumIm - im[k])
      );
    }
    expect(largest < 1e-9).toBe(true);
    fft.inverse(re, im);
    for (let n = 0; n < size; n++) {
      expect(Math.abs(re[n] - x[n]) < 1e-12).toBe(true);
      expect(Math.abs(im[n] - y[n]) < 1e-12).toBe(true);
    }
    for (const bad of [0, 1, 3, 48, 131072, 2.5]) {
      expect(() => createFft(bad)).toThrow(RangeError);
    }
  });

  it('recovers a known predictor', () => {
    const random = createRandom('issue-58-lpc');
    const x = new Float64Array(4000);
    for (let n = 0; n < x.length; n++) {
      x[n] =
        (n > 0 ? 1.3 * x[n - 1] : 0) -
        (n > 1 ? 0.8 * x[n - 2] : 0) +
        (random() * 2 - 1);
    }
    for (const method of [lpcBurg, lpcAutocorrelation, lpcCovariance]) {
      const a = new Float64Array(2);
      const k = new Float64Array(2);
      const power = method(x, 2, a, k);
      expect(Math.abs(a[0] - -1.3) < 0.05).toBe(true);
      expect(Math.abs(a[1] - 0.8) < 0.05).toBe(true);
      // e is uniform in [-1, 1): variance 1/3.
      expect(Math.abs(power - 1 / 3) < 0.05).toBe(true);
      const stepped = predictorFromReflection(k, 2, new Float64Array(2));
      expect(Math.abs(stepped[0] - a[0]) < 1e-9).toBe(true);
      expect(Math.abs(stepped[1] - a[1]) < 1e-9).toBe(true);
      // 10 log10(E / |A|^2) at 0 Hz, A(1) = 1 + a1 + a2.
      const level = 10 * Math.log10(power / (1 + a[0] + a[1]) ** 2);
      expect(Math.abs(lpcLevel(a, 2, power, 0, 8000) - level) < 1e-9).toBe(
        true
      );
    }
  });

  it('resamples in chunks like resample()', () => {
    const random = createRandom('issue-58-resampler');
    const input = Float32Array.from({ length: 44100 }, () => random() - 0.5);
    for (const [from, to] of [
      [44100, 16000],
      [22050, 11025],
      [16000, 8000],
    ]) {
      const whole = resample(input, from, to);
      const stream = createResampler(from, to);
      const joined = [];
      for (let start = 0; start < input.length; start += 1000) {
        joined.push(...stream.push(input.subarray(start, start + 1000)));
      }
      joined.push(...stream.flush());
      expect(joined.length).toBe(whole.length);
      let largest = 0;
      for (let n = 0; n < whole.length; n++) {
        largest = Math.max(largest, Math.abs(joined[n] - whole[n]));
      }
      expect(largest <= 1e-6).toBe(true);
    }
  });
});

describe('recognition front end: frames', () => {
  it('measures a sine', () => {
    const rate = 16000;
    const sine = Float32Array.from({ length: rate }, (_, n) =>
      Math.sin((2 * Math.PI * 1000 * n) / rate)
    );
    const frames = analyzeFrames(sine, rate);
    expect(frames.rate).toBe(16000);
    expect(frames.size).toBe(512);
    expect(frames.order).toBe(18);
    expect(frames.count).toBe(200);
    for (let t = 10; t < frames.count - 10; t++) {
      expect(Math.abs(frames.energy[t] - -3.01) <= 0.1).toBe(true);
      expect(Math.abs(frames.gravity[t] - 1000) <= 20).toBe(true);
      expect(Math.abs(frames.zcr[t] - 0.125) <= 0.01).toBe(true);
      expect(frames.periodicity[t] > 0.95).toBe(true);
    }
  });

  it('gives the same frames for a stream', () => {
    for (const sampleRate of [16000, 44100]) {
      const voice = synthesize('Hello world.', {
        tier: 'wideband',
        sampleRate,
      });
      expect(voice.sampleRate).toBe(sampleRate);
      const batch = analyzeFrames(voice.samples, sampleRate);
      const stream = streamFrames(voice.samples, sampleRate);
      expect(batch.rate).toBe(16000);
      expect(stream.count).toBe(batch.count);
      expect(batch.count).toBe(expectedCount(batch));
      expect(stream.sampleCount).toBe(batch.sampleCount);
      expect(largestDifference(batch, stream) <= 1e-6).toBe(true);
    }
  });

  it('writes resampled recording data directly with the same samples and frames as streaming', () => {
    for (const rate of [16000, 44100, 12000.5]) {
      const samples = whiteNoise(4099, -18, 73).subarray(11, 4082);
      const options = { rate: 8000, maxSeconds: samples.length / rate };
      const streaming = createFrameAnalyzer(rate, options);
      for (let index = 0; index < samples.length; index += 97) {
        streaming.push(samples.subarray(index, index + 97));
      }
      streaming.flush();
      expect(analyzeFrames(samples, rate, options)).toEqual(streaming.frames);
    }
  });

  it('works at 8000 Hz', () => {
    const voice = synthesize('Hello world.', { tier: 'telephone' });
    expect(voice.sampleRate).toBe(8000);
    const frames = analyzeFrames(voice.samples, 8000);
    expect(frames.rate).toBe(8000);
    expect(frames.size).toBe(256);
    expect(frames.sampleCount).toBe(voice.samples.length);
    expect(frames.count).toBe(expectedCount(frames));
    expect(frames.capacity).toBe(
      Math.ceil(voice.samples.length / 8000 / FRONTEND_DEFAULTS.hop)
    );
    expect(width(frames, 'lpc')).toBe(10);
    expect(width(frames, 'reflection')).toBe(10);
    expect(width(frames, 'mel')).toBe(24);
    expect(width(frames, 'cepstrum')).toBe(13);
    expect(width(frames, 'band')).toBe(6);
    for (const name of COLUMNS) {
      const length = frames.count * width(frames, name);
      for (let index = 0; index < length; index++) {
        expect(Number.isNaN(frames[name][index])).toBe(false);
      }
    }
    // Bands above 4000 Hz are empty at 8000 Hz.
    expect(frames.band[5 * 6 + 5]).toBe(-100);
    expect(() => createFrameAnalyzer(7999)).toThrow(RangeError);
    expect(() => createFrameAnalyzer(8000, { rate: 16000 })).toThrow(
      RangeError
    );
    expect(createFrameAnalyzer(11025).frames.rate).toBe(11025);
    expect(createFrameAnalyzer(48000).frames.rate).toBe(16000);
  });

  it('finds speech between pauses', () => {
    const voice = synthesize('Hello world.', { tier: 'wideband' });
    const rate = voice.sampleRate;
    const pad = Math.round(0.5 * rate);
    // 0.5 s of -50 dB noise before and after the sentence.
    const samples = whiteNoise(voice.samples.length + 2 * pad, -50, 58);
    samples.set(voice.samples, pad);
    const frames = analyzeFrames(samples, rate);
    const hop = frames.hop;
    const ratio = (from, to, value) => {
      let hits = 0;
      let total = 0;
      for (let t = Math.ceil(from / hop); t * hop < to; t++) {
        total++;
        hits += frames.speech[t] === value ? 1 : 0;
      }
      return hits / total;
    };
    const end = (samples.length - 1) / rate;
    const half = frames.window / 2;
    expect(ratio(0.3, 0.5 - half, 0) >= 0.95).toBe(true);
    // Noise after the sentence, past the hangover of the last frame.
    const after = 0.5 + voice.duration + half + 0.05;
    expect(ratio(after, end, 0) >= 0.95).toBe(true);
    let hits = 0;
    let total = 0;
    for (const segment of voice.plan.segments) {
      if (segment.kind !== 'vowel') {
        continue;
      }
      const start = 0.5 + segment.start;
      for (
        let t = Math.ceil(start / hop);
        t * hop < start + segment.duration;
        t++
      ) {
        total++;
        hits += frames.speech[t];
      }
    }
    expect(total > 50).toBe(true);
    expect(hits / total >= 0.9).toBe(true);
  });

  it('tracks the noise floor', () => {
    const rate = 16000;
    const frames = analyzeFrames(whiteNoise(3 * rate, -30, 3), rate);
    let sum = 0;
    let count = 0;
    for (let t = 0; t < frames.count; t++) {
      sum += 10 ** (frames.energy[t] / 10);
      count++;
    }
    const mean = 10 * Math.log10(sum / count);
    for (let t = Math.ceil(2 / frames.hop); t < frames.count; t++) {
      expect(Math.abs(frames.noise[t] - mean) <= 3).toBe(true);
      expect(frames.speech[t]).toBe(0);
    }
  });
});

describe('recognition front end: streaming', () => {
  it('keeps frames after trim', () => {
    const voice = synthesize('Hello world.', { tier: 'wideband' });
    const rate = voice.sampleRate;
    const analyzer = createFrameAnalyzer(rate, { maxSeconds: 2 });
    const half = Math.floor(voice.samples.length / 2);
    analyzer.push(voice.samples.subarray(0, half));
    const frames = analyzer.frames;
    const before = {};
    for (const name of COLUMNS) {
      before[name] = frames[name].slice();
    }
    const count = frames.count;
    const samples = frames.samples.slice(0, frames.sampleCount);
    analyzer.trim(40);
    expect(frames.count).toBe(count - 40);
    expect(Math.abs(frames.startTime - 40 * frames.hop) < 1e-12).toBe(true);
    for (const name of COLUMNS) {
      const size = width(frames, name);
      for (let index = 0; index < frames.count * size; index++) {
        expect(frames[name][index]).toBe(before[name][index + 40 * size]);
      }
    }
    const shift = Math.round(40 * frames.hop * frames.rate);
    expect(frames.sampleCount).toBe(samples.length - shift);
    for (let n = 0; n < frames.sampleCount; n++) {
      expect(frames.samples[n]).toBe(samples[n + shift]);
    }
    // The rest of the stream continues as without trim.
    analyzer.push(voice.samples.subarray(half));
    analyzer.flush();
    const batch = analyzeFrames(voice.samples, rate);
    expect(frames.count + 40).toBe(batch.count);
    for (const name of COLUMNS) {
      const size = width(frames, name);
      for (let index = 0; index < frames.count * size; index++) {
        const difference = Math.abs(
          frames[name][index] - batch[name][index + 40 * size]
        );
        expect(difference <= 1e-6).toBe(true);
      }
    }
    expect(() => analyzer.trim(frames.count + 1)).toThrow(RangeError);
    analyzer.reset();
    expect(frames.count).toBe(0);
    expect(frames.startTime).toBe(0);
  });

  it('throws when the frame set is full', () => {
    const analyzer = createFrameAnalyzer(16000, { maxSeconds: 0.1 });
    expect(analyzer.frames.capacity).toBe(20);
    analyzer.push(new Float32Array(1600));
    expect(() => analyzer.push(new Float32Array(1))).toThrow(RangeError);
    analyzer.flush();
    expect(analyzer.frames.count).toBe(20);
    expect(() => createFrameAnalyzer(16000, { hop: 0.02 })).toThrow(RangeError);
    expect(() => createFrameAnalyzer(16000, { lpc: 'magic' })).toThrow(
      RangeError
    );
  });

  it('stays within the CPU budget', () => {
    for (const [tier, sampleRate] of [
      ['wideband', 16000],
      ['telephone', 8000],
    ]) {
      const voice = synthesize(
        'The quick brown fox jumps over the lazy dog. She sells sea shells.',
        { tier }
      );
      expect(voice.sampleRate).toBe(sampleRate);
      const samples = new Float32Array(10 * sampleRate);
      for (let n = 0; n < samples.length; n += voice.samples.length) {
        samples.set(
          voice.samples.subarray(
            0,
            Math.min(voice.samples.length, samples.length - n)
          ),
          n
        );
      }
      analyzeFrames(samples.subarray(0, sampleRate), sampleRate);
      let best = Infinity;
      for (let run = 0; run < 3; run++) {
        const started = globalThis.performance.now();
        analyzeFrames(samples, sampleRate);
        best = Math.min(
          best,
          (globalThis.performance.now() - started) / 1000 / 10
        );
      }
      console.log(`frontend rtf ${best.toFixed(4)} at ${sampleRate} Hz`);
      expect(best <= 0.2).toBe(true);
    }
  });
});
