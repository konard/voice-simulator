/** Class B parity of the Gaussian HMM kernels of the word decoder (issue 75). */
import { describe, expect, it as test } from 'test-anywhere';
import {
  applyLda,
  hmmFeatures,
  hmmStatics,
} from '../src/recognition/hmm-features.js';
import { getHmmModel, stateScore } from '../src/recognition/hmm-model.js';
import {
  hmmLdaRust,
  hmmStateScoresRust,
  hmmToneFeaturesRust,
} from '../src/recognition/hmm-rust.js';
import { hmmToneFeatures } from '../src/recognition/hmm-tone.js';
import { loadRustEngine, noRust } from './helpers/rust-engine.js';
import { itUnless } from './helpers/skip.js';

const it = itUnless(noRust);
const RATE = 8000;

/** Half a second of a gliding two-formant buzz with a quiet seeded hiss. */
function sound() {
  const x = new Float32Array(RATE / 2);
  let seed = 7;
  let phase = 0;
  for (let i = 0; i < x.length; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    phase += (2 * Math.PI * (110 + (40 * i) / x.length)) / RATE;
    const t = i / RATE;
    x[i] =
      0.3 * Math.sin(phase) * Math.sin(2 * Math.PI * 700 * t) +
      0.2 * Math.sin(3 * phase) * Math.sin(2 * Math.PI * 1500 * t) +
      0.01 * (seed / 2147483648 - 0.5);
  }
  return x;
}

test('packed HMM features match the training feature rows', () => {
  const { lda } = getHmmModel();
  const samples = sound();
  const { statics, pitch } = hmmStatics(samples);
  const lf0 = statics.map((row) => row[13] / 4);
  const voicing = statics.map((row) => row[14]);
  const packed = hmmFeatures(samples, RATE, lda, pitch);
  const spectralOnly = hmmFeatures(samples, RATE, lda, pitch, {
    includeTone: false,
  });

  expect(packed.frames).toBe(statics.length);
  expect(packed.feats).toEqual(applyLda(lda, statics));
  expect(packed.tone).toEqual(hmmToneFeatures(lf0, voicing));
  expect(spectralOnly.feats).toEqual(packed.feats);
  expect(spectralOnly.tone).toBeUndefined();
});

test('wideband HMM features only need frame-level pitch after resampling', () => {
  const { lda } = getHmmModel();
  const native = sound();
  const wideband = Float32Array.from(
    { length: native.length * 2 },
    (_, i) => native[i >> 1]
  );
  const full = hmmFeatures(wideband, RATE * 2, lda);
  const frameOnly = hmmFeatures(wideband, RATE * 2, lda, undefined, {
    framePitch: true,
  });

  expect(frameOnly.frames).toBe(full.frames);
  expect(frameOnly.feats).toEqual(full.feats);
  expect(frameOnly.tone).toEqual(full.tone);
});

test('reuses HMM feature storage across inputs with different lengths', () => {
  const { lda } = getHmmModel();
  const samples = sound();
  const buffers = new Map();
  const storage = (key, length, Type) => {
    if (!buffers.has(key)) {
      buffers.set(key, new Type(length));
    }
    return buffers.get(key).subarray(0, length);
  };
  hmmFeatures(samples, RATE, lda, undefined, { framePitch: true, storage });
  const short = samples.subarray(1000, 6000);
  const expected = hmmFeatures(short, RATE, lda, undefined, {
    framePitch: true,
  });
  const reused = hmmFeatures(short, RATE, lda, undefined, {
    framePitch: true,
    storage,
  });

  expect(reused.feats.buffer).toBe(buffers.get('hmmFeatures').buffer);
  expect(reused.feats).toEqual(expected.feats);
  expect(reused.tone).toEqual(expected.tone);
});

describe('Rust HMM kernels (issue 75)', () => {
  it('projects the statics as applyLda does', async () => {
    const module = await loadRustEngine();
    const { lda } = getHmmModel();
    const { statics } = hmmStatics(sound());
    const js = applyLda(lda, statics);
    const rust = hmmLdaRust(module, lda, statics);
    expect(rust.length).toBe(js.length);
    let worst = 0;
    for (let i = 0; i < js.length; i++) {
      worst = Math.max(
        worst,
        Math.abs(rust[i] - js[i]) / (1 + Math.abs(js[i]))
      );
    }
    expect(worst < 1e-6).toBe(true);
  });

  it('scores every state as stateScore does', async () => {
    const module = await loadRustEngine();
    const model = getHmmModel();
    const { statics } = hmmStatics(sound());
    const feats = applyLda(model.lda, statics);
    const frames = 12;
    const states = Uint32Array.from({ length: model.states }, (_, i) => i);
    const rust = hmmStateScoresRust(module, model, feats, frames, states);
    let worst = 0;
    for (let t = 0; t < frames; t++) {
      for (const m of states) {
        const js = stateScore(m, feats, t * model.dims, model);
        const got = rust[t * states.length + m];
        worst = Math.max(worst, Math.abs(got - js) / (1 + Math.abs(js)));
      }
    }
    expect(worst < 1e-12).toBe(true);
  });

  it('computes the tone features as hmmToneFeatures does', async () => {
    const module = await loadRustEngine();
    const { statics } = hmmStatics(sound());
    const lf0 = statics.map((v) => v[13] / 4);
    const voicing = statics.map((v) => v[14]);
    const js = hmmToneFeatures(lf0, voicing);
    const rust = hmmToneFeaturesRust(module, lf0, voicing);
    expect(rust.length).toBe(js.length);
    expect(rust.every((v, i) => v === js[i])).toBe(true);
  });

  it('scores the tone mixtures as stateScore does', async () => {
    const module = await loadRustEngine();
    const { lda, tone } = getHmmModel();
    const { tone: feats, frames } = hmmFeatures(sound(), RATE, lda);
    const states = Uint32Array.from({ length: tone.states }, (_, i) => i);
    const rust = hmmStateScoresRust(module, tone, feats, frames, states);
    let worst = 0;
    for (let t = 0; t < frames; t++) {
      for (const k of states) {
        const js = stateScore(k, feats, t * tone.dims, tone);
        const got = rust[t * states.length + k];
        worst = Math.max(worst, Math.abs(got - js) / (1 + Math.abs(js)));
      }
    }
    expect(worst < 1e-12).toBe(true);
  });

  it('refuses a state outside the model', async () => {
    const module = await loadRustEngine();
    const model = getHmmModel();
    const feats = new Float32Array(model.dims);
    expect(() =>
      hmmStateScoresRust(module, model, feats, 1, [model.states])
    ).toThrow(/Rust HMM scores failed/);
  });
});
