/** Known-source recovery and source measures, issue 61 (Unlicense). */
import { describe, it, expect } from 'test-anywhere';
import {
  analyzeFrames,
  inverseFilter,
  INVERSE_FILTER_DEFAULTS,
  lfHarmonics,
  rdToTenseness,
  presetHeadConfig,
  synthesize,
  trackPitch,
} from '../src/index.js';
import { lfParameters } from '../src/acoustics/glottis.js';
import { inverseModeMeasures } from '../src/recognition/inverse-filter.js';
import { highPass } from './helpers/recognition-truth.js';
import {
  sourceVowel,
  addNoise,
  median,
  correlation,
} from './helpers/inverse-source.js';

/** Sustained noiseless vowels are absorbed into the front-end noise floor.
 * Use their known, aligned pitch, exercising the supplied-track API. */
function known(samples, rate, f0) {
  const frames = analyzeFrames(samples, rate);
  const pitch = {
    count: frames.count,
    hop: frames.hop,
    startTime: frames.startTime,
    f0: new Float32Array(frames.count).fill(f0),
  };
  return { frames, pitch };
}
const cache = new Map();
function vowel(tenseness = 0.5, f0 = 110, rate = 16000) {
  const key = `${tenseness}/${f0}/${rate}`;
  if (!cache.has(key)) {
    const v = sourceVowel(tenseness, f0, rate);
    const { frames, pitch } = known(v.samples, rate, f0);
    cache.set(key, {
      ...v,
      frames,
      pitch,
      result: inverseFilter(frames, { pitch }),
    });
  }
  return cache.get(key);
}

describe('batch glottal inverse filter', () => {
  it('keeps the source measures used by mode recognition', () => {
    for (const rate of [8000, 16000]) {
      const { frames, pitch, result } = vowel(0.5, 110, rate);
      const measures = inverseModeMeasures(frames, { pitch });
      expect(measures).toEqual({
        h1h2Source: result.h1h2Source,
        hnr: result.hnr,
        cpp: result.cpp,
      });
      const rows = [4, 20, frames.count - 1];
      const selected = inverseModeMeasures(frames, { pitch }, rows);
      for (const key of ['h1h2Source', 'hnr', 'cpp']) {
        expect(rows.map((row) => selected[key][row])).toEqual(
          rows.map((row) => result[key][row])
        );
        expect(Number.isNaN(selected[key][0])).toBe(true);
      }
    }
  });

  it('preserves sparse source cues on wideband and bandlimited speech', () => {
    const v = vowel();
    for (const [samples, lowBand] of [
      [v.samples, true],
      [highPass(v.samples, v.rate, 300), false],
    ]) {
      const { frames, pitch } = known(samples, v.rate, v.f0);
      const options = { pitch, minF0: 35, maxF0: 800 };
      const full = inverseFilter(frames, options);
      expect(full.lowBand).toBe(lowBand);
      const rows = Array.from({ length: frames.count }, (_, t) => t).filter(
        (t) => t % 3 === 1
      );
      const cues = inverseModeMeasures(frames, options, rows);
      for (const key of ['h1h2Source', 'hnr', 'cpp']) {
        expect(Array.from(cues[key])).toEqual(
          Array.from(full[key], (value, t) => (t % 3 === 1 ? value : NaN))
        );
      }
    }
  });

  it('returns the pulse of a known source', () => {
    for (const rate of [16000, 8000]) {
      const v = vowel(0.5, 110, rate);
      const r = correlation(v.result.flowDerivative, v.truth, rate).correlation;
      console.log(`inverse pulse ${rate} correlation ${r}`);
      expect(r >= (rate === 16000 ? 0.9 : 0.8)).toBe(true);
      expect(v.result.flow.length).toBe(v.samples.length);
      expect(v.result.flowDerivative instanceof Float32Array).toBe(true);
      expect(v.result.gci instanceof Float64Array).toBe(true);
    }
  });
  it('orders Rd like the source', () => {
    for (const f0 of [110, 220]) {
      let previous = Infinity;
      for (const tenseness of [0.3, 0.5, 0.7]) {
        const v = vowel(tenseness, f0);
        const rd = median(v.result.rd);
        // #32 couples breathiness to Rd: the exact fixture in #61 has
        // breathiness=0, hence Rd is 0.3 below its pre-#32 nominal values.
        const truth = lfParameters(tenseness, 0).rd;
        const nominal = 3 * (1 - tenseness);
        console.log(
          `inverse Rd f0 ${f0} tenseness ${tenseness} median ${rd} truth ${truth} error ${rd - truth} issue-target ${nominal} error ${rd - nominal}`
        );
        expect(rd < previous).toBe(true);
        expect(Math.abs(rd - truth) <= 0.4).toBe(true);
        previous = rd;
      }
    }
  });
  it('finds closure instants', () => {
    const { truth, result, rate } = vowel();
    const marks = Array.from(result.gci, (n) => n * rate);
    const period = rate / 110;
    const peaks = [];
    for (let n = Math.round(0.1 * rate); n < truth.length - 0.1 * rate; n++) {
      if (
        truth[n] < truth[n - 1] &&
        truth[n] <= truth[n + 1] &&
        truth[n] < -0.5
      ) {
        peaks.push(n);
      }
    }
    let single = 0,
      accurate = 0;
    for (const peak of peaks) {
      const near = marks.filter((n) => Math.abs(n - peak) < period / 2);
      if (near.length === 1) {
        single++;
      }
      if (near.some((n) => Math.abs(n - peak) <= 0.00025 * rate)) {
        accurate++;
      }
    }
    console.log(
      `inverse GCI single ${single / peaks.length} accurate ${accurate / peaks.length}`
    );
    expect(single / peaks.length >= 0.95).toBe(true);
    expect(accurate / peaks.length >= 0.8).toBe(true);
  });
  it('measures a known noise level', () => {
    const rate = 16000,
      f0 = 150;
    const signal = Float32Array.from({ length: rate * 1.5 }, (_, n) => {
      let value = 0;
      for (let k = 1; k <= 5; k++) {
        value += Math.sin((2 * Math.PI * f0 * k * n) / rate) / k;
      }
      return value;
    });
    const { frames, pitch } = known(addNoise(signal, -20), rate, f0);
    const hnr = median(inverseFilter(frames, { pitch }).hnr);
    console.log(`inverse HNR ${hnr}`);
    expect(Math.abs(hnr - 20) <= 3).toBe(true);
  });
  it('sees added noise in the cepstral peak', () => {
    const clean = vowel(0.5, 220);
    const { frames, pitch } = known(
      addNoise(clean.samples, -5),
      clean.rate,
      clean.f0
    );
    const noise = inverseFilter(frames, { pitch });
    const difference = median(clean.result.cpp) - median(noise.cpp);
    console.log(`inverse CPP clean-minus-noise ${difference}`);
    expect(difference >= 4).toBe(true);
  });
  it('flags a telephone band', () => {
    const v = vowel();
    const { frames, pitch } = known(
      highPass(v.samples, v.rate, 300),
      v.rate,
      v.f0
    );
    const result = inverseFilter(frames, { pitch });
    expect(result.lowBand).toBe(false);
    for (const name of ['rd', 'oq', 'naq', 'h1h2', 'h1h2Source']) {
      expect(result[name].every(Number.isNaN)).toBe(true);
    }
    expect(Number.isFinite(median(result.hnr))).toBe(true);
    expect(Number.isFinite(median(result.cpp))).toBe(true);
    expect(result.summary.rd.frames).toBe(0);
    expect(result.summary.rd.median).toBe(null);
  });
});

describe('inverse filter integration', () => {
  it('works on synthetic speech with local and supplied pitch', () => {
    for (const rate of [16000, 8000]) {
      for (const preset of ['male', 'female']) {
        const out = synthesize('Hello world.', {
          sampleRate: rate,
          solver: 'waveguide',
          seed: 1,
          head: presetHeadConfig(preset),
        });
        const frames = analyzeFrames(out.samples, rate);
        for (const pitch of [null, trackPitch(frames)]) {
          const result = inverseFilter(frames, { pitch });
          const voiced = result.f0.filter((v) => v > 0).length;
          const reliable = result.reliable.reduce((a, b) => a + b, 0);
          console.log(
            `inverse speech ${preset}@${rate} supplied ${!!pitch} reliable ${reliable}/${voiced}`
          );
          expect(voiced > 0).toBe(true);
          if (rate === 16000) {
            expect(reliable / voiced >= 0.6).toBe(true);
          }
        }
      }
    }
  });
  it('stays within the CPU budget', () => {
    const out = synthesize('Hello world.', {
      sampleRate: 16000,
      solver: 'waveguide',
      seed: 1,
    });
    const frames = analyzeFrames(out.samples, 16000);
    inverseFilter(frames); // warm tables and JIT, excluding synthesis/front end
    let rtf = Infinity;
    for (let run = 0; run < 3; run++) {
      const start = globalThis.performance.now();
      inverseFilter(frames);
      rtf = Math.min(
        rtf,
        (globalThis.performance.now() - start) /
          1000 /
          (out.samples.length / 16000)
      );
    }
    console.log(`inverse filter rtf ${rtf}`);
    expect(
      rtf <= Number(globalThis.process?.env?.INVERSE_FILTER_RTF_LIMIT ?? 0.4)
    ).toBe(true);
  });
  it('keeps absolute time, valid lengths, summaries and deterministic outputs', () => {
    const v = vowel();
    const frames = { ...v.frames, startTime: 2 };
    const pitch = { ...v.pitch, startTime: 2 };
    const trace = [];
    const a = inverseFilter(frames, { pitch, trace: (e) => trace.push(e) });
    expect(a.gci[0] >= 2).toBe(true);
    expect(a.gci[a.gci.length - 1] <= 3.5).toBe(true);
    expect(trace.length > 0).toBe(true);
    for (const name of [
      'f0',
      'rd',
      'fit',
      'oq',
      'naq',
      'h1h2',
      'h1h2Source',
      'hnr',
      'cpp',
    ]) {
      expect(Array.from(a[name])).toEqual(Array.from(v.result[name]));
      const s = a.summary[name];
      expect(s.frames > 0).toBe(true);
      expect(s.low <= s.median && s.median <= s.high).toBe(true);
    }
    expect(Array.from(a.flowDerivative)).toEqual(
      Array.from(v.result.flowDerivative)
    );
    const table = lfHarmonics(0.5);
    table.fill(0);
    expect(lfHarmonics(0.5).some((v) => v !== 0)).toBe(true);
    expect(lfParameters(0.5).ta > 0).toBe(true);
    expect(rdToTenseness(1.5)).toBe(0.5);
    expect(INVERSE_FILTER_DEFAULTS.pitch).toBe(null);
  });
  it('handles silence, short clips and invalid options', () => {
    for (const n of [0, 1, 80, 1600]) {
      const frames = analyzeFrames(new Float32Array(n), 16000);
      const result = inverseFilter(frames);
      expect(result.flow.length).toBe(n);
      expect(result.flow.every((v) => v === 0)).toBe(true);
      expect(result.gci.length).toBe(0);
      expect(result.reliable.every((v) => v === 0)).toBe(true);
      expect(result.summary.hnr.median).toBe(null);
    }
    const high = known(new Float32Array(800), 8000, 2000);
    const boundary = inverseFilter(high.frames, { pitch: high.pitch });
    expect(boundary.h1h2Source.every(Number.isNaN)).toBe(true);
    expect(boundary.reliable.every((v) => v === 0)).toBe(true);
    const v = vowel();
    for (const options of [
      { leak: 1 },
      { step: 0 },
      { tractOrder: 0 },
      { minF0: 0 },
      { minF0: 1000, maxF0: 2000 },
      { maxF0: Infinity },
      { pitch: { ...v.pitch, startTime: 1 } },
    ]) {
      expect(() => inverseFilter(v.frames, options)).toThrow();
    }
    expect(() => lfHarmonics(NaN)).toThrow();
  });
  it('ignores unused sample capacity after a trim', () => {
    const v = vowel();
    const samples = new Float32Array(v.frames.sampleCount + 1000).fill(NaN);
    samples.set(v.frames.samples.subarray(0, v.frames.sampleCount));
    const frames = {
      ...v.frames,
      speech: new Uint8Array(v.frames.count).fill(1),
      periodicity: new Float32Array(v.frames.count).fill(1),
    };
    for (const pitch of [null, v.pitch]) {
      const expected = inverseFilter(frames, { pitch });
      const actual = inverseFilter({ ...frames, samples }, { pitch });
      for (const name of ['flowDerivative', 'f0', 'rd', 'hnr', 'cpp']) {
        expect(Array.from(actual[name])).toEqual(Array.from(expected[name]));
      }
    }
  });
});
