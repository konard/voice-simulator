/**
 * Objective speech metrics (issue 18): spectra, DTW, spectral distances,
 * pitch and formant errors, transcript error rates and the comparison of
 * two recordings.
 */

import { describe, it, expect } from 'test-anywhere';
import {
  METRIC_DEFAULTS,
  compareRecordings,
  constantCepstrumDistortion,
  createRandom,
  dtw,
  editDistance,
  errorRate,
  f0Errors,
  fft,
  formantErrors,
  logSpectralDistance,
  melCepstralDistortion,
  melFilterbank,
  mfcc,
  pitchTrack,
  powerFloor,
  powerFrames,
  resample,
  synthesize,
  tokenize,
} from '../src/index.js';
import {
  decimate,
  estimateFormants,
  lpcCoefficients,
  lpcEnvelope,
} from '../src/acoustics/analysis.js';
import { median, yinPitch } from '../src/analysis/voice-features.js';
import { trimSilence } from '../src/metrics/compare.js';
import { normalizeRms } from '../src/metrics/distortion.js';
import { alignEdits } from '../src/metrics/text.js';

function noise(seconds = 1, sampleRate = 16000) {
  const random = createRandom(1);
  return Float64Array.from(
    { length: Math.round(seconds * sampleRate) },
    () => random() * 2 - 1
  );
}

function near(value, expected, tolerance) {
  expect(Math.abs(value - expected) <= tolerance).toBe(true);
}

describe('metrics: spectrum', () => {
  it('has the documented defaults', () => {
    expect(METRIC_DEFAULTS.dynamicRange).toBe(60);
    expect(METRIC_DEFAULTS.sampleRate).toBe(16000);
    expect(METRIC_DEFAULTS.fftSize).toBe(512);
    expect(METRIC_DEFAULTS.window).toBe(0.025);
    expect(METRIC_DEFAULTS.hop).toBe(0.01);
  });

  it('fft finds a sine', () => {
    const re = Float64Array.from({ length: 512 }, (_, n) =>
      Math.sin((2 * Math.PI * 8 * n) / 512)
    );
    const im = new Float64Array(512);
    fft(re, im);
    let total = 0;
    for (let k = 1; k <= 255; k++) {
      total += re[k] ** 2 + im[k] ** 2;
    }
    expect((re[8] ** 2 + im[8] ** 2) / total > 0.99).toBe(true);
  });

  it('fft rejects a length that is not a power of two', () => {
    expect(() => fft(new Float64Array(6), new Float64Array(6))).toThrow();
  });

  it('frames, filters and cepstra have the documented shapes', () => {
    const frames = powerFrames(noise(), 16000);
    expect(frames.length).toBe(98);
    expect(frames[0].length).toBe(257);
    const filters = melFilterbank(26, 512, 16000);
    expect(filters.length).toBe(26);
    expect(Math.max(...filters[10])).toBeLessThanOrEqual(1);
    expect(Math.max(...filters[10]) > 0.8).toBe(true);
    const coefficients = mfcc(noise(), 16000);
    expect(coefficients.length).toBe(98);
    expect(coefficients[0].length).toBe(14);
  });
});

describe('metrics: spectral distances', () => {
  const x = noise();
  const half = x.map((value) => value * 0.5);

  it('lsd of a signal with itself is zero', () => {
    expect(logSpectralDistance(x, x, 16000)).toBe(0);
    expect(
      logSpectralDistance(x, half, 16000, { normalize: true }) < 0.01
    ).toBe(true);
  });

  it('lsd without normalisation measures gain', () => {
    near(logSpectralDistance(x, half, 16000, { normalize: false }), 6.02, 0.01);
  });

  it('mcd ignores gain', () => {
    expect(melCepstralDistortion(x, half, 16000) < 1e-6).toBe(true);
    const raw = melCepstralDistortion(x, half, 16000, { normalize: false });
    expect(raw < 1e-6).toBe(true);
  });

  it('mcd grows with spectral change', () => {
    const y = new Float64Array(x.length);
    for (let n = 0; n < x.length; n++) {
      y[n] = x[n] + 0.9 * (n > 0 ? y[n - 1] : 0);
    }
    expect(melCepstralDistortion(x, y, 16000) > 3).toBe(true);
  });

  it('constant-cepstrum distortion is the mcd from the mean spectrum', () => {
    // Another stretch of the same noise has the same mean spectrum but its
    // own fluctuation, so it is further from the frames than the mean.
    const shifted = x.map((_, n) => x[(n + 4000) % x.length]);
    const constant = constantCepstrumDistortion(x, 16000);
    expect(constant < melCepstralDistortion(x, shifted, 16000)).toBe(true);
    near(constantCepstrumDistortion(half, 16000), constant, 1e-9);
    // A change of spectral shape halfway is missed by any constant.
    const y = new Float64Array(x.length);
    for (let n = 0; n < x.length; n++) {
      y[n] = x[n] + 0.9 * (n > 0 ? y[n - 1] : 0);
    }
    const mid = x.length >> 1;
    const joined = x.map((value, n) => (n < mid ? value : 0.1 * y[n]));
    expect(constantCepstrumDistortion(joined, 16000) > 2 * constant).toBe(true);
    expect(constantCepstrumDistortion(new Float64Array(800), 16000)).toBe(0);
  });
});

describe('metrics: floor and silent frames (issue 19)', () => {
  // experiments/issue-19-regression-probe.mjs prints the values.
  const random = createRandom(1);
  const white = (n, level = 1) =>
    Float64Array.from({ length: n }, () => level * (random() * 2 - 1));

  it('powerFloor keeps 60 dB below the peak', () => {
    near(powerFloor([[0.5, 1], [0.25]]), 1e-6, 1e-15);
    near(powerFloor([[1]], 30), 1e-3, 1e-12);
    expect(powerFloor([[0]])).toBe(1e-10);
  });

  it('an empty band costs at most the dynamic range', () => {
    const x = white(16000);
    const low = resample(resample(x, 16000, 7000), 7000, 16000);
    const floored = logSpectralDistance(x, low, 16000);
    const raw = logSpectralDistance(x, low, 16000, { range: 200 });
    expect(floored < 40).toBe(true);
    expect(raw > 1.5 * floored).toBe(true);
    expect(
      melCepstralDistortion(x, low, 16000) <
        melCepstralDistortion(x, low, 16000, { range: 200 })
    ).toBe(true);
  });

  it('pairs with a silent reference frame are skipped', () => {
    // Coloured noise, then a pause with faint white noise; the test is white
    // noise throughout. Scoring the pause (white against white, near 0)
    // halved the distance before issue 19.
    const burst = white(8000);
    for (let n = 1; n < burst.length; n++) {
      burst[n] += 0.9 * burst[n - 1];
    }
    const reference = new Float64Array(16000);
    reference.set(burst);
    reference.set(white(8000, 1e-4), 8000);
    const test = white(16000);
    const alone = melCepstralDistortion(burst, test.slice(0, 8000), 16000);
    const withPause = melCepstralDistortion(reference, test, 16000);
    expect(withPause > 0.9 * alone).toBe(true);
  });
});

describe('metrics: dtw', () => {
  it('dtw aligns a stretched sequence', () => {
    const result = dtw([[0], [1], [2], [3]], [[0], [1], [1], [2], [3]]);
    expect(result.cost).toBe(0);
    expect(result.path.length).toBe(5);
    expect(result.path[0]).toEqual([0, 0]);
    expect(result.path[4]).toEqual([3, 4]);
    expect(result.normalizedCost).toBe(0);
  });

  it('dtw respects the band', () => {
    const a = [[0], [5], [1], [7], [2]];
    const b = [[5], [0], [7], [1], [2]];
    const result = dtw(a, b, { band: 0 });
    expect(result.path).toEqual([0, 1, 2, 3, 4].map((index) => [index, index]));
    expect(dtw(a, b).path.length > 5).toBe(true);
  });

  it('dtw prefers the diagonal on ties', () => {
    const result = dtw([[0], [0]], [[0], [0]]);
    expect(result.path).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });

  it('traces both stretch directions across packed row boundaries', () => {
    const a = [0, 0, 1, 2, 3];
    const b = [0, 1, 1, 2, 3];
    expect(dtw(a, b).path).toEqual([
      [0, 0],
      [1, 0],
      [2, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ]);
  });

  it('dtw follows the signals with the symmetric weight', () => {
    // b is a delayed by one frame: with weight 1 a diagonal step costs one
    // local distance for two frames and the path stays on the diagonal;
    // with weight 2 (Sakoe & Chiba 1978) it matches the 1 of a with the 1
    // of b.
    const a = [1, 2, 0];
    const b = [0, 1, 0];
    expect(dtw(a, b).path).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
    const symmetric = dtw(a, b, { diagonalWeight: 2 });
    expect(symmetric.path).toEqual([
      [0, 0],
      [0, 1],
      [1, 1],
      [2, 2],
    ]);
    expect(symmetric.cost).toBe(2);
  });

  it('dtw refuses too many cells', () => {
    const long = new Array(5001).fill([0]);
    expect(() => dtw(long, long)).toThrow(RangeError);
  });
});

describe('metrics: pitch and formants', () => {
  it('f0 errors on a known case', () => {
    const result = f0Errors([100, 100, 0, 200], [100, 130, 100, 0]);
    expect(result.gpe).toBe(0.5);
    expect(result.vde).toBe(0.5);
    expect(result.ffe).toBe(0.75);
    near(result.rmseCents, 321.18, 0.01);
    expect(result.voicedFrames).toBe(2);
  });

  it('f0 errors are null without frames voiced in both', () => {
    const result = f0Errors([0, 100], [100, 0]);
    expect(result.rmseCents).toBe(null);
    expect(result.gpe).toBe(null);
    expect(result.vde).toBe(1);
  });

  it('pitchTrack follows a glide', () => {
    const sampleRate = 16000;
    const samples = new Float64Array(sampleRate);
    const truth = (seconds) => 100 + 100 * seconds;
    // Pulses smoothed by two one-pole low-pass filters (a glottal-like
    // -12 dB/octave tilt). Single-sample pulses under a 100 Hz/s glide are
    // judged unvoiced in about half the frames by the YIN aperiodicity
    // threshold (see experiments/issue-18-glide.mjs).
    let phase = 0;
    let first = 0;
    let second = 0;
    for (let index = 0; index < samples.length; index++) {
      const previous = phase;
      phase += truth(index / sampleRate) / sampleRate;
      const pulse = Math.floor(phase) > Math.floor(previous) ? 1 : 0;
      first = pulse + 0.9 * first;
      second = first + 0.9 * second;
      samples[index] = second;
    }
    const track = pitchTrack(samples, sampleRate);
    const errors = [];
    track.forEach((f0, frame) => {
      const centre = frame * 0.01 + 0.02;
      if (centre < 0.98) {
        errors.push(f0 > 0 ? Math.abs(f0 / truth(centre) - 1) : 1);
      }
    });
    expect(median(errors) < 0.02).toBe(true);
  });

  it('pads only the partial YIN windows without changing their pitch', () => {
    const rate = 8000;
    const samples = Float32Array.from({ length: 703 }, (_, i) =>
      Math.sin((2 * Math.PI * i) / 40)
    );
    const track = pitchTrack(samples, rate);
    const padded = new Float64Array(samples.length + 500);
    padded.set(samples);
    expect(track.length).toBe(9);
    expect(track[5]).toBeGreaterThan(0);
    for (let i = 0; i < track.length; i++) {
      const { f0, aperiodicity } = yinPitch(padded, i * 80, 320, rate);
      expect(track[i]).toBe(aperiodicity < 0.35 ? f0 : 0);
    }
  });

  it('formant errors average over frames with formants in both', () => {
    const result = formantErrors(
      [[500, 1500, 2500], null, [600, 1600, 2600]],
      [[550, 1500, 2400], [500, 1500, 2500], null]
    );
    expect(result.frames).toBe(1);
    expect(result.f1.hz).toBe(50);
    expect(result.f1.percent).toBe(10);
    expect(result.f2.hz).toBe(0);
    expect(result.f3.percent).toBe(4);
  });

  it('finds the same formant peaks as a complete LPC envelope', () => {
    for (const rate of [8000, 22050]) {
      const samples = noise(0.04, rate);
      const start = Math.floor(0.01 * rate);
      const length = Math.floor(0.02 * rate);
      const { samples: frame, sampleRate } = decimate(
        samples.slice(start, start + length),
        rate,
        11025
      );
      for (let i = frame.length - 1; i > 0; i--) {
        frame[i] -= 0.94 * frame[i - 1];
      }
      for (let i = 0; i < frame.length; i++) {
        frame[i] *=
          0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (frame.length - 1));
      }
      const { frequencies, magnitudes } = lpcEnvelope(
        lpcCoefficients(frame, 12),
        sampleRate,
        5
      );
      const peaks = Array.from(frequencies).filter(
        (frequency, i) =>
          frequency > 150 &&
          magnitudes[i] > magnitudes[i - 1] &&
          magnitudes[i] >= magnitudes[i + 1]
      );
      expect(peaks.length).toBeGreaterThan(3);
      for (const count of [0, 3, 3.5, -1]) {
        const args = { start: 0.01, duration: 0.02, count };
        const expected = peaks.slice(0, count);
        expect(estimateFormants(samples, rate, args)).toEqual(expected);
        expect(estimateFormants(Array.from(samples), rate, args)).toEqual(
          expected
        );
      }
    }
  });
});

describe('metrics: transcripts', () => {
  it('edit distance of kitten and sitting', () => {
    const result = editDistance([...'kitten'], [...'sitting']);
    expect(result.distance).toBe(3);
    expect(result.substitutions).toBe(2);
    expect(result.insertions).toBe(1);
    expect(result.deletions).toBe(0);
  });

  it('counts edits along the same path as alignment, including ties', () => {
    const sequences = ['', 'a', 'b', 'ab', 'ba', 'aa', 'aba', 'aabb', 'bbaa'];
    for (const reference of sequences) {
      for (const hypothesis of sequences) {
        const { distance, substitutions, deletions, insertions } = alignEdits(
          reference,
          hypothesis
        );
        expect(editDistance(reference, hypothesis)).toEqual({
          distance,
          substitutions,
          deletions,
          insertions,
        });
      }
    }
  });

  it('traces all edit directions and prefers substitutions when tied', () => {
    expect(alignEdits('abxyc', 'abydc')).toEqual({
      distance: 2,
      substitutions: 2,
      insertions: 0,
      deletions: 0,
      pairs: [
        [0, 0],
        [1, 1],
        [2, 2],
        [3, 3],
        [4, 4],
      ],
    });
    expect(alignEdits('abxyc', 'bxyz')).toEqual({
      distance: 2,
      substitutions: 1,
      insertions: 0,
      deletions: 1,
      pairs: [
        [1, 0],
        [2, 1],
        [3, 2],
        [4, 3],
      ],
    });
    expect(alignEdits('', 'a')).toEqual({
      distance: 1,
      substitutions: 0,
      insertions: 1,
      deletions: 0,
      pairs: [],
    });
  });

  it('word error rate', () => {
    const result = errorRate('The cat sat on the mat.', 'the cat sit on mat');
    near(result.rate, 0.3333, 0.0001);
    expect(result.substitutions).toBe(1);
    expect(result.deletions).toBe(1);
    expect(result.insertions).toBe(0);
    expect(result.referenceLength).toBe(6);
  });

  it('character error rate handles Chinese', () => {
    near(errorRate('你好吗', '你好', 'char').rate, 0.3333, 0.0001);
  });

  it('phoneme error rate ignores stress and tone', () => {
    expect(errorRate('ˈhɛloʊ', 'hɛloʊ', 'phone').rate).toBe(0);
    expect(errorRate('ma˨˩˦', 'ma˥', 'phone').rate).toBe(0);
    expect(tokenize('t͡ʃaː bʰ', 'phone')).toEqual(['t͡ʃ', 'aː', 'bʰ']);
  });

  it('tokenize rejects an unknown unit', () => {
    expect(() => tokenize('a', 'syllable')).toThrow(RangeError);
  });
});

describe('metrics: compareRecordings', () => {
  const first = synthesize('Hello.', { tier: 'minimal', seed: 1 });

  it('compareRecordings of a rendering with itself', () => {
    const result = compareRecordings(first, first);
    expect(result.lsd).toBe(0);
    expect(result.mcd).toBe(0);
    expect(result.timing.rmsSeconds).toBe(0);
    expect(result.f0.gpe).toBe(0);
    expect(result.f0.voicedFrames > 10).toBe(true);
    expect(result.formants.f1.hz).toBe(0);
    expect(result.sampleRate).toBe(16000);
    expect(result.duration.ratio).toBe(1);
  });

  it('compareRecordings separates voices', () => {
    const second = synthesize('Hello.', {
      tier: 'minimal',
      seed: 2,
      head: { pitch: 220 },
    });
    const result = compareRecordings(first, second);
    expect(result.mcd > 1).toBe(true);
    expect(result.f0.rmseCents > 300).toBe(true);
    expect(Number.isFinite(result.lsd)).toBe(true);
    expect(Number.isFinite(result.timing.rmsSeconds)).toBe(true);
  });

  it('scores the same power frames and cepstra along the alignment', () => {
    const sampleRate = 8000;
    const a = new Float32Array(2400);
    const b = new Float32Array(2100);
    a.set(noise(0.18, sampleRate), 320);
    b.set(noise(0.16, sampleRate), 160);
    const settings = { window: 0.02, hop: 0.008, range: 32, band: 0.5 };
    const r = normalizeRms(trimSilence(a, sampleRate, settings));
    const t = normalizeRms(trimSilence(b, sampleRate, settings));
    const shortCepstra = (samples) =>
      mfcc(samples, sampleRate, settings).map((c) => c.subarray(1));
    const { path } = dtw(shortCepstra(r), shortCepstra(t), settings);
    const along = { ...settings, path, normalize: false };
    const result = compareRecordings(
      { samples: a, sampleRate },
      { samples: b, sampleRate },
      { ...settings, formants: false }
    );
    expect(result.lsd).toBe(logSpectralDistance(r, t, sampleRate, along));
    expect(result.mcd).toBe(melCepstralDistortion(r, t, sampleRate, along));
    const short = { samples: a.subarray(0, 720), sampleRate };
    const self = compareRecordings(short, short, { formants: false });
    expect(self.lsd).toBe(0);
    expect(self.mcd).toBe(0);
    const repeated = compareRecordings(
      { samples: a, sampleRate },
      { samples: b, sampleRate },
      { ...settings, formants: false }
    );
    expect(repeated).toEqual(result);
  });
});
