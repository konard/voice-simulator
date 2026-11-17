/** Voice-fit acceptance and API regression tests. Unlicense, issue 63. */
import { describe, it, expect } from 'test-anywhere';
import {
  fitVoice,
  fitVoiceSteps,
  createVoiceFitter,
  synthesize,
  HEAD_PARAMETERS,
  DEFAULT_HEAD,
  matchVoice,
  saveVoice,
  loadVoice,
} from '../src/index.js';
const TEXT = 'The north wind and the sun.';
const HEADS = [
  { vocalTractLength: 14, pitch: 210, tenseness: 0.45, speechRate: 1.15 },
  { vocalTractLength: 18.5, pitch: 100, tenseness: 0.75, speechRate: 0.9 },
];
const recordings = HEADS.map((head) =>
  synthesize(TEXT, {
    head,
    sampleRate: 16000,
    solver: 'waveguide',
    seed: 1,
    engine: 'js',
  })
);
const error = (x, y) => Math.abs(x / y - 1);
describe('fitVoice', () => {
  it('recovers synthetic voices with a transcript', () => {
    recordings.forEach(({ samples, sampleRate }, i) => {
      const result = fitVoice(samples, sampleRate, {
        transcript: TEXT,
        maxRenders: 10,
      });
      console.log(
        'voice fit transcript',
        i,
        JSON.stringify(
          Object.fromEntries(
            Object.keys(HEADS[i]).map((k) => [k, result.head[k]])
          )
        ),
        result.distance,
        result.renders
      );
      for (const [key, tolerance] of [
        ['vocalTractLength', 0.06],
        ['pitch', 0.03],
        ['speechRate', 0.1],
      ]) {
        expect(error(result.head[key], HEADS[i][key]) < tolerance).toBe(true);
      }
      expect(Math.abs(result.head.tenseness - HEADS[i].tenseness) < 0.2).toBe(
        true
      );
      expect(result.renders <= 10).toBe(true);
    });
  });
  it('recovers synthetic voices without a transcript', () => {
    recordings.forEach(({ samples, sampleRate }, i) => {
      const result = fitVoice(samples, sampleRate, { refine: false });
      expect(
        error(result.head.vocalTractLength, HEADS[i].vocalTractLength) < 0.08
      ).toBe(true);
      expect(error(result.head.pitch, HEADS[i].pitch) < 0.03).toBe(true);
      expect(result.renders).toBe(0);
    });
  });
  it('works at 8000 Hz', () => {
    const audio = synthesize(TEXT, {
      head: HEADS[0],
      sampleRate: 8000,
      solver: 'waveguide',
      seed: 1,
      engine: 'js',
    });
    const result = fitVoice(audio.samples, 8000, { refine: false });
    expect(error(result.head.vocalTractLength, 14) < 0.1).toBe(true);
  });
  it('reports uncertainty and preserves unfitted defaults', () => {
    const a = recordings[0],
      result = fitVoice(a.samples, a.sampleRate, { refine: false });
    for (const p of HEAD_PARAMETERS) {
      const info = result.parameters[p.key];
      if (info.source === 'default') {
        expect(info.value).toBe(p.default);
      } else {
        expect(Number.isFinite(info.sd) && info.sd > 0).toBe(true);
        expect(info.frames > 0).toBe(true);
      }
    }
    expect(result.parameters.pitch.sd < 5).toBe(true);
    expect(result.parameters.headWidth.source).toBe('default');
  });
  it('continues from a state', () => {
    for (const a of recordings) {
      const middle = Math.floor(a.samples.length / 2);
      const fitter = createVoiceFitter();
      fitter.update(a.samples.subarray(0, middle), a.sampleRate);
      const resumed = createVoiceFitter({
        state: JSON.parse(JSON.stringify(fitter.state)),
      });
      resumed.update(a.samples.subarray(middle), a.sampleRate);
      const whole = fitVoice(a.samples, a.sampleRate, { refine: false });
      const split = resumed.result();
      for (const key of [
        'vocalTractLength',
        'pitch',
        'pitchRange',
        'tenseness',
        'speechRate',
      ]) {
        expect(error(split.head[key], whole.head[key]) < 0.02).toBe(true);
      }
      expect(split.state.histograms.f0.length).toBe(
        whole.state.histograms.f0.length
      );
      const refined = resumed.result({
        refine: true,
        samples: a.samples,
        sampleRate: a.sampleRate,
        maxRenders: 1,
      });
      expect(refined.renders).toBe(1);
      expect(refined.state.voicedFrames).toBe(split.state.voicedFrames);
    }
  });
  it('is deterministic', () => {
    const a = recordings[0],
      o = { transcript: TEXT, maxRenders: 2 };
    expect(fitVoice(a.samples, a.sampleRate, o)).toEqual(
      fitVoice(a.samples, a.sampleRate, o)
    );
  });
  it('keeps matchVoice working', () => {
    const a = recordings[0];
    const result = matchVoice(a.samples, a.sampleRate, {
      iterations: 1,
      transcript: TEXT,
    });
    expect(Object.keys(result).sort()).toEqual([
      'distance',
      'features',
      'head',
      'preset',
      'rendered',
    ]);
  });
});
describe('voice fitting API', () => {
  it('honours parts, budgets, callbacks and the generator return value', () => {
    const a = recordings[0],
      calls = [];
    const steps = fitVoiceSteps(a.samples, a.sampleRate, {
      parts: ['pitch'],
      maxRenders: 3,
      onStep: (s) => calls.push(s),
    });
    let next = steps.next();
    expect(next.value.renders).toBe(0);
    while (!next.done) {
      next = steps.next();
    }
    expect(calls.length).toBe(next.value.renders);
    expect(next.value.renders <= 3).toBe(true);
    expect(next.value.head.vocalTractLength).toBe(
      DEFAULT_HEAD.vocalTractLength
    );
    expect(next.value.parameters.tenseness.source).toBe('default');
    expect(loadVoice(saveVoice({ head: next.value.head })).head.pitch).toBe(
      next.value.head.pitch
    );
  });
  it('rejects silence, malformed state and invalid budgets', () => {
    expect(() => fitVoice(new Float32Array(8000), 8000)).toThrow(
      'No voiced speech found in the recording'
    );
    expect(() => createVoiceFitter({ state: {} })).toThrow();
    expect(() => createVoiceFitter({ maxRenders: -1 })).toThrow();
  });
});
