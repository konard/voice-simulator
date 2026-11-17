import {
  analyzeFrames,
  inverseFilter,
  synthesize,
  trackPitch,
  presetHeadConfig,
} from '../../src/index.js';
import {
  sourceVowel,
  median,
  correlation,
  addNoise,
} from '../../tests/helpers/inverse-source.js';
import { highPass } from '../../tests/helpers/recognition-truth.js';
for (const rate of [16000, 8000]) {
  for (const f0 of [110, 220]) {
    for (const tenseness of [0.3, 0.5, 0.7]) {
      const v = sourceVowel(tenseness, f0, rate);
      const frames = analyzeFrames(v.samples, rate);
      const start = globalThis.performance.now();
      const pitch = {
        count: frames.count,
        hop: frames.hop,
        startTime: frames.startTime,
        f0: new Float32Array(frames.count).fill(f0),
      };
      const result = inverseFilter(frames, { pitch });
      console.log({
        rate,
        f0,
        tenseness,
        pitch: median(result.f0),
        lowBand: result.lowBand,
        rd: median(result.rd),
        fit: median(result.fit),
        oq: median(result.oq),
        hnr: median(result.hnr),
        cpp: median(result.cpp),
        reliable: result.reliable.reduce((a, b) => a + b, 0) / frames.count,
        rtf: (globalThis.performance.now() - start) / 1500,
        ...correlation(result.flowDerivative, v.truth, rate),
      });
    }
  }
}
const vowel = sourceVowel();
for (const samples of [
  addNoise(vowel.samples, -5),
  highPass(vowel.samples, 16000, 300),
]) {
  const frames = analyzeFrames(samples, 16000);
  const r = inverseFilter(frames, {
    pitch: {
      count: frames.count,
      hop: frames.hop,
      startTime: frames.startTime,
      f0: new Float32Array(frames.count).fill(110),
    },
  });
  console.log({
    lowBand: r.lowBand,
    hnr: median(r.hnr),
    cpp: median(r.cpp),
    rd: median(r.rd),
  });
}
for (const preset of ['male', 'female']) {
  const s = synthesize('Hello world.', {
    solver: 'waveguide',
    sampleRate: 16000,
    head: presetHeadConfig(preset),
    seed: 1,
  });
  const frames = analyzeFrames(s.samples, s.sampleRate);
  for (const pitch of [null, trackPitch(frames)]) {
    const r = inverseFilter(frames, { pitch });
    console.log({
      preset,
      supplied: !!pitch,
      lowBand: r.lowBand,
      voiced: r.f0.filter((v) => v > 0).length,
      reliable: r.reliable.reduce((a, b) => a + b, 0),
      rd: median(r.rd),
      fit: median(r.fit),
      cpp: median(r.cpp),
    });
  }
}
