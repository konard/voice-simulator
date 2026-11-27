/**
 * Pitch and voicing tracker of the recognizer (issue 59): a harmonic sweep,
 * synthetic speech against the planned f0 (clean, high-passed and in white
 * noise), white noise alone, a stream against a batch, jitter and shimmer
 * of a sustained vowel and the CPU budget.
 */

import { describe, it, expect } from 'test-anywhere';
import {
  PITCH_DEFAULTS,
  analyzeFrames,
  createFrameAnalyzer,
  createPitchTracker,
  f0Errors,
  jitterToHead,
  planUtterance,
  presetHeadConfig,
  renderPlan,
  synthesize,
  trackPitch,
} from '../src/index.js';
import { createRandom, randomNormal } from '../src/random.js';
import { analyzeFrameHops } from '../src/recognition/frontend.js';
import { trackPitchFrames, trackPitchHops } from '../src/recognition/pitch.js';
import {
  highPass,
  maskedPair,
  plannedPitch,
  speechLevel,
} from './helpers/recognition-truth.js';

const TEXT =
  'The north wind and the sun were disputing which was the stronger.';
const PRESETS = ['male', 'female', 'child'];
const RATES = [16000, 8000];

const voices = new Map();

it('shares pitch candidates without changing either hop’s pitch path', () => {
  const sampleRate = 8000;
  const samples = renderPlan(planUtterance('ama'), { sampleRate, seed: 1 });
  const frames = analyzeFrameHops(samples, sampleRate);
  const { pitch, fitPitch } = trackPitchHops(frames);
  expect(fitPitch).toEqual(trackPitch(frames.fine));
  expect(pitch).toEqual(trackPitch(frames.coarse));
});

it('reuses batch pitch scratch across frame counts and candidate widths', () => {
  const sampleRate = 8000;
  const samples = renderPlan(planUtterance('ama'), { sampleRate, seed: 1 });
  const whole = analyzeFrames(samples, sampleRate);
  const short = analyzeFrames(samples.subarray(1000, 1600), sampleRate);
  let retained;
  for (const [frames, candidates] of [
    [whole, undefined],
    [whole, 1],
    [short, 9],
    [whole, 4],
    [short, 1],
  ]) {
    const options = candidates === undefined ? undefined : { candidates };
    const expected = trackPitch(frames, options);
    const actual = trackPitchFrames(frames, options);
    for (const name of ['f0', 'voicing', 'strength']) {
      expect(actual[name]).toEqual(expected[name].subarray(0, frames.count));
    }
    retained ??= { track: actual, original: actual.f0.slice() };
  }
  expect(retained.track.f0).toEqual(retained.original);
});

/** The sentence for `preset` at `sampleRate` (waveguide, seed 1), cached. */
function voice(preset, sampleRate) {
  const key = `${preset}@${sampleRate}`;
  if (!voices.has(key)) {
    voices.set(
      key,
      synthesize(TEXT, {
        head: presetHeadConfig(preset),
        solver: 'waveguide',
        sampleRate,
        seed: 1,
      })
    );
  }
  return voices.get(key);
}

/** f0Errors of `samples` against the plan of `out` over the mask. */
function errorsOf(out, samples) {
  const frames = analyzeFrames(samples, out.sampleRate);
  const track = trackPitch(frames);
  const truth = plannedPitch(out.plan, frames.hop, track.count);
  const [reference, test] = maskedPair(truth.f0, track.f0, truth.mask);
  return { errors: f0Errors(reference, test), reference, test };
}

/** Mean |cents| over the frames voiced in both without a gross error. */
function fineCents(reference, test) {
  let sum = 0;
  let count = 0;
  for (let index = 0; index < reference.length; index++) {
    const ratio = test[index] / reference[index];
    if (reference[index] > 0 && test[index] > 0 && Math.abs(ratio - 1) <= 0.2) {
      sum += Math.abs(1200 * Math.log2(ratio));
      count++;
    }
  }
  return sum / count;
}

/** Seeded white noise of standard deviation `deviation`. */
function whiteNoise(length, deviation, seed) {
  const random = createRandom(seed);
  return Float32Array.from({ length }, () => deviation * randomNormal(random));
}

/** Track of `samples` pushed in chunks of 1, 7, 160 and 1024 samples with
 * an `advance()` after each; `rewritten` counts committed rows that
 * changed later. */
function streamTrack(samples, sampleRate) {
  const analyzer = createFrameAnalyzer(sampleRate);
  const tracker = createPitchTracker(analyzer.frames);
  const committed = new Float32Array(analyzer.frames.capacity);
  const sizes = [1, 7, 160, 1024];
  let rewritten = 0;
  let before = 0;
  for (let start = 0, turn = 0; start < samples.length; turn++) {
    const size = sizes[turn % sizes.length];
    analyzer.push(samples.subarray(start, start + size));
    tracker.advance();
    const { track } = tracker;
    for (let t = 0; t < before; t++) {
      rewritten += committed[t] === track.f0[t] ? 0 : 1;
    }
    committed.set(track.f0.subarray(before, track.committed), before);
    before = track.committed;
    start += size;
  }
  analyzer.flush();
  tracker.advance(true);
  return { track: tracker.track, rewritten };
}

describe('recognition pitch: signals', () => {
  it('exports the defaults of the issue', () => {
    expect(PITCH_DEFAULTS).toEqual({
      minF0: 60,
      maxF0: 600,
      candidates: 4,
      voicingThreshold: 0.45,
      silenceThreshold: 0.03,
      octaveCost: 0.01,
      octaveJumpCost: 0.7,
      voicedUnvoicedCost: 0.28,
      lag: 20,
    });
    // value / 1.128: the exact factor is 2 / sqrt(pi) = 1.12838.
    expect(Math.abs(jitterToHead(1.128) - 1) < 1e-3).toBe(true);
    expect(jitterToHead(null)).toBe(null);
    const frames = analyzeFrames(new Float32Array(1600), 8000);
    expect(() => trackPitch(frames, { maxF0: 2500 })).toThrow(RangeError);
    expect(() => trackPitch(frames, { candidates: 0 })).toThrow(RangeError);
    expect(() => trackPitch(frames, { lag: -1 })).toThrow(RangeError);
  });

  it('follows a sine sweep', () => {
    for (const rate of RATES) {
      const seconds = 2;
      const f0At = (time) => 80 * (500 / 80) ** (time / seconds);
      const samples = new Float32Array(seconds * rate);
      let phase = 0;
      for (let n = 0; n < samples.length; n++) {
        let value = 0;
        for (let k = 1; k <= 5; k++) {
          value += Math.sin(k * phase) / k;
        }
        samples[n] = 0.3 * value;
        phase += (2 * Math.PI * f0At(n / rate)) / rate;
      }
      const track = trackPitch(analyzeFrames(samples, rate));
      let unvoiced = 0;
      let worst = 0;
      // Frames whose 25 ms analysis frame lies inside the sound.
      for (let t = 0; t < track.count; t++) {
        const time = track.startTime + t * track.hop;
        if (time >= 0.0125 && time <= seconds - 0.0125) {
          if (track.f0[t] > 0) {
            worst = Math.max(worst, Math.abs(track.f0[t] / f0At(time) - 1));
          } else {
            unvoiced++;
          }
        }
      }
      expect(unvoiced).toBe(0);
      expect(worst < 0.01).toBe(true);
    }
  });

  it('is silent on noise', () => {
    for (const rate of RATES) {
      const noise = whiteNoise(2 * rate, 0.1, `pitch:silent:${rate}`);
      const track = trackPitch(analyzeFrames(noise, rate));
      expect(track.count).toBe(400);
      let voiced = 0;
      for (let t = 0; t < track.count; t++) {
        voiced += track.f0[t] > 0 ? 1 : 0;
      }
      expect(voiced).toBe(0);
      expect(track.median).toBe(null);
    }
  });
});

describe('recognition pitch: synthetic speech', () => {
  it('tracks clean synthetic speech', () => {
    for (const preset of PRESETS) {
      for (const rate of RATES) {
        const out = voice(preset, rate);
        const { errors, reference, test } = errorsOf(out, out.samples);
        const fine = fineCents(reference, test);
        console.log(
          `pitch clean ${preset}@${rate}: gpe ${errors.gpe.toFixed(4)} ` +
            `vde ${errors.vde.toFixed(4)} fine ${fine.toFixed(1)} cents`
        );
        expect(errors.gpe <= 0.005).toBe(true);
        expect(errors.vde <= 0.04).toBe(true);
        expect(fine <= 15).toBe(true);
      }
    }
  });

  it('survives a missing fundamental', () => {
    // Fourth-order Butterworth: the fundamental (about 110 Hz) is 35 dB
    // down.
    const out = voice('male', 8000);
    const filtered = highPass(out.samples, out.sampleRate, 300, 4);
    const { errors } = errorsOf(out, filtered);
    console.log(`pitch high-passed male@8000: gpe ${errors.gpe.toFixed(4)}`);
    expect(errors.gpe <= 0.02).toBe(true);
  });

  it('survives noise', () => {
    for (const preset of PRESETS) {
      for (const rate of RATES) {
        const out = voice(preset, rate);
        const truth = plannedPitch(out.plan, 0.005);
        const level = speechLevel(out.samples, rate, truth.f0, 0.005);
        for (const [snr, limit] of [
          [20, 0.08],
          [10, 0.15],
        ]) {
          const noise = whiteNoise(
            out.samples.length,
            Math.sqrt(level / 10 ** (snr / 10)),
            `pitch:noise:${preset}:${rate}:${snr}`
          );
          const noisy = Float32Array.from(
            out.samples,
            (value, index) => value + noise[index]
          );
          const { errors } = errorsOf(out, noisy);
          console.log(
            `pitch ${snr} dB ${preset}@${rate}: ffe ${errors.ffe.toFixed(4)}`
          );
          expect(errors.ffe <= limit).toBe(true);
        }
      }
    }
  });

  it('agrees between stream and batch', () => {
    for (const rate of RATES) {
      const out = voice('female', rate);
      const batch = trackPitch(analyzeFrames(out.samples, rate));
      const { track, rewritten } = streamTrack(out.samples, rate);
      expect(track.count).toBe(batch.count);
      expect(track.committed).toBe(batch.count);
      expect(rewritten).toBe(0);
      let differ = 0;
      for (let t = 0; t < batch.count; t++) {
        const a = batch.f0[t];
        const b = track.f0[t];
        if (a > 0 !== b > 0 || (a > 0 && Math.abs(b / a - 1) > 0.01)) {
          differ++;
        }
      }
      expect(differ <= 0.01 * batch.count).toBe(true);
    }
  });

  it('measures jitter', () => {
    const measured = [];
    for (const [jitter, shimmer] of [
      [0.2, 1],
      [1, 4],
      [2, 8],
    ]) {
      const head = { ...presetHeadConfig('male'), jitter, shimmer };
      const plan = planUtterance('aː', { head, durations: [2] });
      const samples = renderPlan(plan, {
        head,
        solver: 'waveguide',
        sampleRate: 16000,
        seed: 1,
      });
      const track = trackPitch(analyzeFrames(samples, 16000));
      expect(track.marks.length >= 100).toBe(true);
      const result = {
        jitter: jitterToHead(track.jitter),
        shimmer: jitterToHead(track.shimmer),
      };
      console.log(
        `pitch jitter ${jitter} -> ${result.jitter.toFixed(3)}, ` +
          `shimmer ${shimmer} -> ${result.shimmer.toFixed(3)}`
      );
      for (const [name, setting] of [
        ['jitter', jitter],
        ['shimmer', shimmer],
      ]) {
        expect(result[name] >= setting / 2).toBe(true);
        expect(result[name] <= setting * 2).toBe(true);
      }
      measured.push(result);
    }
    for (let index = 1; index < measured.length; index++) {
      expect(measured[index].jitter > measured[index - 1].jitter).toBe(true);
      expect(measured[index].shimmer > measured[index - 1].shimmer).toBe(true);
    }
  });

  it('stays within the CPU budget', () => {
    const out = voice('male', 16000);
    const frames = analyzeFrames(out.samples, out.sampleRate);
    trackPitch(frames);
    let best = Infinity;
    for (let run = 0; run < 3; run++) {
      const started = globalThis.performance.now();
      trackPitch(frames);
      best = Math.min(
        best,
        (globalThis.performance.now() - started) / 1000 / out.duration
      );
    }
    console.log(`pitch rtf ${best.toFixed(4)}`);
    expect(best <= 0.2).toBe(true);
  });
});
