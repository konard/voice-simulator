/** Batch IAIF and source measures parity (Unlicense, issue 61).
 * Class B: relative RMS <= 1e-6; masks, NaNs, lengths and GCIs agree.
 * Unreliable dB diagnostics can be ill-conditioned near silence: absolute
 * error <= 0.002 dB there; reliable values retain the strict RMS limit. */
import { describe, expect } from 'test-anywhere';
import {
  analyzeFrames,
  inverseFilter,
  synthesize,
  trackPitch,
} from '../src/index.js';
import { float64View } from '../src/engine/wasm-loader.js';
import { inverseModeMeasures } from '../src/recognition/inverse-filter.js';
import { loadRustEngine, noRust } from './helpers/rust-engine.js';
import { itUnless } from './helpers/skip.js';
import { highPass } from './helpers/recognition-truth.js';
import { sourceVowel, addNoise } from './helpers/inverse-source.js';
const it = itUnless(noRust);
const columns = [
  'f0',
  'rd',
  'fit',
  'oq',
  'naq',
  'h1h2',
  'h1h2Source',
  'hnr',
  'cpp',
];
function packedInput(f, pitch, options) {
  const o = {
    tractOrder: 0,
    glottisOrder: 0,
    leak: 0.99,
    step: 0.01,
    minF0: 60,
    maxF0: 400,
    ...options,
  };
  return Float64Array.from([
    f.rate,
    f.hop,
    f.window,
    f.startTime,
    f.count,
    f.sampleCount,
    f.melBands,
    o.tractOrder,
    o.glottisOrder,
    o.leak,
    o.step,
    o.minF0,
    o.maxF0,
    pitch ? 1 : 0,
    ...f.samples.subarray(0, f.sampleCount),
    ...f.speech.subarray(0, f.count),
    ...f.periodicity.subarray(0, f.count),
    ...f.mel.subarray(0, f.count * f.melBands),
    ...(pitch ? pitch.f0.subarray(0, f.count) : []),
  ]);
}
function compare(a, b, label, mask = null) {
  expect(a.length).toBe(b.length);
  let error = 0,
    energy = 0,
    maxDiagnostic = 0;
  for (let n = 0; n < a.length; n++) {
    expect(Number.isNaN(a[n])).toBe(Number.isNaN(b[n]));
    if (!Number.isFinite(b[n])) {
      continue;
    }
    if (mask && !mask[n]) {
      maxDiagnostic = Math.max(maxDiagnostic, Math.abs(a[n] - b[n]));
      continue;
    }
    error += (a[n] - b[n]) ** 2;
    energy += b[n] ** 2;
  }
  const rms = Math.sqrt(error / Math.max(1e-30, energy));
  console.log(
    `inverse parity ${label} relative RMS ${rms} unreliable diagnostic max ${maxDiagnostic}`
  );
  expect(rms <= 1e-6).toBe(true);
  expect(maxDiagnostic <= 0.002).toBe(true);
}

async function parity(frames, pitch = null, options = {}) {
  const engine = await loadRustEngine(),
    e = engine.exports;
  const input = packedInput(frames, pitch, options);
  const capacity = 40 + 3 * frames.sampleCount + 10 * frames.count;
  const p = e.vs_alloc(input.byteLength),
    q = e.vs_alloc(capacity * 8);
  try {
    float64View(engine, p, input.length).set(input);
    const length = e.vs_inverse_filter(p, input.length, q, capacity);
    expect(length > 0).toBe(true);
    const output = float64View(engine, q, length).slice();
    const reference = inverseFilter(frames, { pitch, ...options });
    expect(output[0]).toBe(frames.count);
    expect(output[1]).toBe(frames.sampleCount);
    expect(output[3]).toBe(reference.lowBand ? 1 : 0);
    let at = 4;
    const take = (n) => {
      const result = output.subarray(at, at + n);
      at += n;
      return result;
    };
    compare(take(frames.sampleCount), reference.flow, 'flow');
    compare(take(frames.sampleCount), reference.flowDerivative, 'derivative');
    compare(take(output[2]), reference.gci, 'GCI');
    for (const name of columns) {
      compare(
        take(frames.count),
        reference[name],
        name,
        ['fit', 'h1h2Source'].includes(name) ? reference.reliable : null
      );
    }
    expect(Array.from(take(frames.count))).toEqual(
      Array.from(reference.reliable)
    );
    for (const name of columns) {
      const summary = reference.summary[name];
      compare(
        take(4),
        [
          summary.median ?? NaN,
          summary.low ?? NaN,
          summary.high ?? NaN,
          summary.frames,
        ],
        `summary.${name}`
      );
    }
    expect(at).toBe(length);
  } finally {
    e.vs_free(p, input.byteLength);
    e.vs_free(q, capacity * 8);
  }
}
describe('Rust inverse filter parity', () => {
  it('matches supplied pitch, both rates and stationary refinement', async () => {
    for (const rate of [8000, 16000]) {
      const v = sourceVowel(0.5, 110, rate),
        frames = analyzeFrames(v.samples, rate);
      frames.startTime = 1.25;
      const pitch = {
        count: frames.count,
        hop: frames.hop,
        startTime: frames.startTime,
        f0: new Float32Array(frames.count).fill(110),
      };
      await parity(frames, pitch);
    }
  });
  it('matches noisy voiced frames and custom orders/leak/step', async () => {
    const v = sourceVowel(0.3, 220, 8000),
      frames = analyzeFrames(addNoise(v.samples, -15), 8000);
    const pitch = {
      count: frames.count,
      hop: frames.hop,
      startTime: frames.startTime,
      f0: new Float32Array(frames.count).fill(220),
    };
    await parity(frames, pitch, {
      tractOrder: 10,
      glottisOrder: 3,
      leak: 0.98,
      step: 0.008,
    });
  });
  it('matches missing-low-band masks', async () => {
    const v = sourceVowel(0.5, 110, 8000);
    const frames = analyzeFrames(highPass(v.samples, 8000, 300), 8000);
    const pitch = {
      count: frames.count,
      hop: frames.hop,
      startTime: frames.startTime,
      f0: new Float32Array(frames.count).fill(110),
    };
    expect(inverseFilter(frames, { pitch }).lowBand).toBe(false);
    await parity(frames, pitch);
  });
  it('matches full Rust source measures at the requested mode rows', async () => {
    const module = await loadRustEngine();
    expect(typeof module.exports.rec_inverse_modes).toBe('function');
    expect(typeof module.exports.rec_inverse_modes_f32).toBe('function');
    const legacy = {
      ...module,
      exports: { ...module.exports, rec_inverse_modes_f32: undefined },
    };
    for (const [rate, removeLowBand] of [
      [16000, false],
      [8000, true],
    ]) {
      const vowel = sourceVowel(0.5, 110, rate);
      const samples = removeLowBand
        ? highPass(vowel.samples, rate, 300)
        : vowel.samples;
      const frames = analyzeFrames(samples, rate);
      const pitch = {
        count: frames.count,
        hop: frames.hop,
        startTime: frames.startTime,
        f0: new Float32Array(frames.count).fill(110),
      };
      pitch.f0[0] = 0;
      const options = { pitch, kernels: { module } };
      const rows = [0, 5, 11, 24, frames.count - 1];
      const full = inverseFilter(frames, options);
      expect(full.lowBand).toBe(!removeLowBand);
      const mode = inverseModeMeasures(frames, options, rows);
      expect(mode).toEqual(
        inverseModeMeasures(
          frames,
          { pitch, kernels: { module: legacy } },
          rows
        )
      );
      const empty = inverseModeMeasures(frames, options, []);
      expect(Object.keys(mode)).toEqual(['h1h2Source', 'hnr', 'cpp']);
      for (const name of Object.keys(mode)) {
        expect(mode[name].length).toBe(frames.count);
        for (let t = 0; t < frames.count; t++) {
          const expected = rows.includes(t) ? full[name][t] : NaN;
          expect(Object.is(mode[name][t], expected)).toBe(true);
          expect(Number.isNaN(empty[name][t])).toBe(true);
        }
      }
    }
  });
  it('keeps the original packet for alternate frame column types', async () => {
    const module = await loadRustEngine();
    const { samples } = sourceVowel(0.3, 110, 16000);
    const frames = analyzeFrames(samples, 16000);
    frames.speech = Float64Array.from(frames.speech, (value) => 256 * value);
    const original = {
      ...module,
      exports: { ...module.exports, rec_inverse_modes_f32: undefined },
    };
    const rows = [5, 11, 24];
    expect(inverseModeMeasures(frames, { kernels: { module } }, rows)).toEqual(
      inverseModeMeasures(frames, { kernels: { module: original } }, rows)
    );
  });
  it('matches local pitch on changing speech', async () => {
    const out = synthesize('Hello world.', {
      sampleRate: 8000,
      solver: 'waveguide',
      seed: 1,
    });
    const frames = analyzeFrames(out.samples, 8000);
    await parity(frames);
    await parity(frames, trackPitch(frames));
  });
  it('matches empty/unvoiced output and rejects malformed layouts', async () => {
    for (const n of [0, 1, 400]) {
      await parity(analyzeFrames(new Float32Array(n), 8000));
    }
    const frames = analyzeFrames(new Float32Array(800), 8000);
    await parity(frames, {
      count: frames.count,
      hop: frames.hop,
      startTime: frames.startTime,
      f0: new Float32Array(frames.count).fill(2000),
    });
    const e = (await loadRustEngine()).exports;
    expect(e.vs_inverse_filter(0, 0, 0, 0)).toBe(-6);
    expect(e.vs_inverse_filter(1, 14, 0, 0)).toBe(-2);
    expect(e.rec_inverse_modes_f32(1, 0, 0, 0, 0, 0, 0)).toBe(-2);
  });
});
