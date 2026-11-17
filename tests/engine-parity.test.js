/** One direct, seeded render comparison for every declared capability. */
import { describe, expect } from 'test-anywhere';
import { ENGINE_FEATURES, createEngine } from '../src/engine/index.js';
import { renderPlan } from '../src/acoustics/voice.js';
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
