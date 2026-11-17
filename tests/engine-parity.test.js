/** One direct, seeded render comparison for every declared capability. */
import { describe, expect } from 'test-anywhere';
import { ENGINE_FEATURES, createEngine } from '../src/engine/index.js';
import { VoiceRenderer, renderPlan } from '../src/acoustics/voice.js';
import { prepareUtterance } from '../src/synthesize.js';
import { noRust } from './helpers/rust-engine.js';
import { itUnless } from './helpers/skip.js';
import { maxError, prepareProbe } from './helpers/engine-features.js';

const it = itUnless(noRust);
async function compare(prepared, tolerance = 1e-4) {
  const engine = await createEngine({
    engine: 'rust',
    threads: 1,
    simd: false,
  });
  expect([...engine.features()].sort()).toEqual(
    ENGINE_FEATURES.map(({ id }) => id).sort()
  );
  const { plan, renderOptions } = prepared;
  const expected = renderPlan(plan, { ...renderOptions, engine: 'js' });
  const renderer = engine.createRenderer(plan, renderOptions);
  try {
    const actual = new Float32Array(renderer.totalSamples);
    renderer.render(actual);
    const error = maxError(actual, expected);
    if (!(error <= tolerance)) {
      throw new Error(`max sample error ${error} exceeds ${tolerance}`);
    }
    expect(engine.fallbacks).toBe(0);
    expect(renderer.engine).toBe('rust');
  } finally {
    renderer.free();
  }
}

describe('engine numerical parity', () => {
  for (const feature of ENGINE_FEATURES) {
    it(`parity: ${feature.id}`, () =>
      compare(prepareProbe(feature), feature.tolerance.maxError));
  }
  it('never falls back', async () => {
    // createEngine caches this instance; all preceding probes used it.
    const engine = await createEngine({
      engine: 'rust',
      threads: 1,
      simd: false,
    });
    expect(engine.fallbacks).toBe(0);
    expect(engine.fallbackReasons).toEqual([]);
  });
  it('preserves the empty transferable state of the fold source', async () => {
    const feature = ENGINE_FEATURES.find(({ id }) => id === 'source.folds');
    const { plan, renderOptions } = prepareProbe(feature);
    const engine = await createEngine('rust');
    const js = new VoiceRenderer(plan, renderOptions);
    const rust = engine.createRenderer(plan, renderOptions);
    try {
      js.render(new Float32Array(1024));
      rust.render(new Float32Array(1024));
      expect([...rust.saveSources()]).toEqual([...js.saveSources()]);
      // A source with no transferable state ignores supplied state.
      const state = new Float64Array(1);
      js.restoreSources(state);
      rust.restoreSources(state);
      const actual = new Float32Array(1024);
      const expected = new Float32Array(1024);
      js.render(expected);
      rust.render(actual);
      expect(maxError(actual, expected) <= feature.tolerance.maxError).toBe(
        true
      );
    } finally {
      rust.free();
    }
  });
  it('preserves the 2D field across render chunks', async () => {
    const feature = ENGINE_FEATURES.find(({ id }) => id === 'solver.fdtd2d');
    const { plan, renderOptions } = prepareProbe(feature);
    const engine = await createEngine({
      engine: 'rust',
      threads: 1,
      simd: false,
    });
    const js = new VoiceRenderer(plan, renderOptions);
    const rust = engine.createRenderer(plan, renderOptions);
    try {
      for (const size of [4096, 101]) {
        const expected = new Float32Array(size);
        const actual = new Float32Array(size);
        expect(rust.render(actual)).toBe(js.render(expected));
        expect(maxError(actual, expected) <= feature.tolerance.maxError).toBe(
          true
        );
        const expectedField = js.solver.field();
        const actualField = rust.field();
        for (const key of ['pressure', 'nose', 'cells']) {
          expect(expectedField[key].length > 0).toBe(true);
          expect(maxError(actualField[key], expectedField[key]) <= 1e-4).toBe(
            true
          );
        }
      }
    } finally {
      rust.free();
    }
  });
  for (const solver of ['waveguide', 'fdtd2d', 'fdtd3d']) {
    for (const interaction of [false, true]) {
      it(`folds with ${solver}, whisper and interaction=${interaction}`, () =>
        compare(
          prepareUtterance('ˈa{W sa W}na', {
            ipa: true,
            tier: 'minimal',
            engine: 'js',
            seed: 'fold-combinations',
            solver,
            dx: 2,
            source: 'folds',
            interaction,
            subglottal: true,
            head: {
              foldLength: 1.7,
              foldMass: 1.2,
              foldStiffness: 0.9,
              foldDamping: 1.1,
              subglottalLength: 1.2,
              subglottalLoss: 5,
            },
          })
        ));
    }
  }
  for (const phonation of [
    'breathy',
    'lax',
    'pressed',
    'creaky',
    'falsetto',
    'harsh',
  ]) {
    it(`phonation: ${phonation}`, () =>
      compare(
        prepareUtterance(`[${phonation}]a[/${phonation}]`, {
          markup: true,
          tier: 'minimal',
          seed: 82,
        })
      ));
  }
});
