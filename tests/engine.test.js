/**
 * createEngine and getEngine (src/engine/index.js): Rust by default, the
 * JavaScript renderer where Rust cannot load or render.
 */

import { describe, it, expect } from 'test-anywhere';

import {
  Waveguide,
  ENGINE_FEATURES,
  createEngine,
  getEngine,
  registerSolver,
  synthesize,
} from '../src/index.js';
import { SPEED_OF_SOUND } from '../src/acoustics/transfer.js';
import { synthesizeWithStorage } from '../src/synthesize.js';
import { noRust } from './helpers/rust-engine.js';
import { itUnless } from './helpers/skip.js';

function peak(samples) {
  let max = 0;
  for (const value of samples) {
    max = Math.max(max, Math.abs(value));
  }
  return max;
}

/** A source that fails the test when it is read. */
const untouchable = {
  get byteLength() {
    throw new Error('the js engine read the WebAssembly source');
  },
  then() {
    throw new Error('the js engine read the WebAssembly source');
  },
};

describe('engines', () => {
  it('preserves waveguide samples with buffered offline solver inputs', async () => {
    const engine = await createEngine({ engine: 'js' });
    const text = 'Stop here. [whisper]Speak softly.[/whisper]';
    for (const tier of ['telephone', 'wideband']) {
      const options = { tier, seed: 1 };
      const expected = synthesize(text, { ...options, engine }).samples;
      const offline = synthesize(text, { ...options, engine: 'js' }).samples;
      expect(offline).toEqual(expected);
    }
  });

  for (const name of ['js', 'rust']) {
    itUnless(name === 'rust' && noRust)(
      `${name} reuses synthesis output without changing the waveform`,
      async () => {
        const engine = await createEngine({ engine: name, threads: 1 });
        const options = { engine, tier: 'telephone', seed: 1 };
        const expected = synthesize('Some short words.', options).samples;
        const storage = new Float32Array(expected.length + 4).fill(NaN);
        const allocate = (length) => storage.subarray(2, 2 + length);
        const reused = synthesizeWithStorage(
          'Some short words.',
          options,
          allocate
        ).samples;
        expect(reused.buffer).toBe(storage.buffer);
        expect(reused).toEqual(expected);
        const shorter = synthesizeWithStorage('Hi.', options, allocate).samples;
        expect(shorter).toEqual(synthesize('Hi.', options).samples);
        expect(expected.buffer).not.toBe(storage.buffer);
      }
    );
  }

  it('js never loads WebAssembly', async () => {
    const engine = await createEngine({ engine: 'js', source: untouchable });
    expect(engine.name).toBe('js');
    expect(engine.reason).toBe(null);
    expect(engine.threads).toBe(1);
    expect(engine.features()).toEqual(ENGINE_FEATURES.map(({ id }) => id));
    const sync = getEngine({ engine: 'js', source: untouchable });
    expect(sync.name).toBe('js');
  });

  it('auto falls back', async () => {
    const engine = await createEngine({
      engine: 'auto',
      source: new Uint8Array([0, 1, 2]),
    });
    expect(engine.name).toBe('js');
    expect(typeof engine.reason).toBe('string');
    expect(engine.reason.length > 0).toBe(true);
    const result = synthesize('Hi.', { engine, tier: 'minimal' });
    expect(peak(result.samples) > 0.01).toBe(true);
    expect(engine.fallbacks).toBe(1);
    expect(engine.fallbackReasons).toEqual([engine.reason]);
  });

  it('rust is an error when it cannot load', async () => {
    let error;
    try {
      await createEngine({ engine: 'rust', source: new Uint8Array([0, 1, 2]) });
    } catch (caught) {
      error = caught;
    }
    expect(error?.code).toBe('ENGINE_UNAVAILABLE');
    let syncError;
    try {
      getEngine({ engine: 'rust', source: new Uint8Array([0, 1, 2]) });
    } catch (caught) {
      syncError = caught;
    }
    expect(syncError?.code).toBe('ENGINE_UNAVAILABLE');
  });

  itUnless(noRust)('auto uses Rust', async () => {
    const engine = await createEngine();
    expect(engine.name).toBe('rust');
    expect(engine.reason).toBe(null);
    const options = { tier: 'minimal', seed: 1 };
    const rust = synthesize('Hello.', options);
    const js = synthesize('Hello.', { ...options, engine: 'js' });
    expect(rust.samples.length).toBe(js.samples.length);
    let difference = 0;
    for (let index = 0; index < js.samples.length; index++) {
      const delta = Math.abs(rust.samples[index] - js.samples[index]);
      difference = Math.max(difference, delta);
    }
    expect(difference < 1e-4).toBe(true);
    // The renderer says which engine renders.
    const { plan } = synthesize('Hi.', options);
    const renderer = engine.createRenderer(plan, { solver: 'waveguide' });
    try {
      expect(renderer.engine).toBe('rust');
      expect(renderer.fallbackReason).toBe(null);
    } finally {
      renderer.free();
    }
  });

  itUnless(noRust)('custom solvers explicitly select JavaScript', async () => {
    registerSolver('test-tube', (options) => {
      const solver = new Waveguide(options);
      solver.stepDuration = (shape) =>
        shape.length / (options.sections * SPEED_OF_SOUND);
      return solver;
    });
    const engine = await createEngine('rust');
    const options = { solver: 'test-tube', sections: 20, sampleRate: 16000 };
    expect(typeof engine.supports(options)).toBe('string');
    expect(engine.supports({ solver: 'waveguide' })).toBe(null);
    const { plan } = synthesize('Hi.', { tier: 'minimal' });
    expect(() => engine.createRenderer(plan, options)).toThrow('test-tube');
    expect(engine.fallbacks).toBe(0);
    const renderer = getEngine('js').createRenderer(plan, options);
    expect(renderer.engine).toBe('js');
    expect(renderer.fallbackReason).toBe(null);
    const samples = new Float32Array(2048);
    expect(renderer.render(samples) > 0).toBe(true);
  });

  it('engines are cached', async () => {
    const first = await createEngine({ engine: 'js' });
    expect(await createEngine('js')).toBe(first);
    expect(getEngine('js')).toBe(first);
    expect(await createEngine({ engine: first })).toBe(first);
    const other = await createEngine({ engine: 'js', threads: 2 });
    expect(other === first).toBe(false);
    const [a, b] = await Promise.all([createEngine(), createEngine()]);
    expect(a).toBe(b);
    first.close();
    expect((await createEngine('js')) === first).toBe(false);
  });

  it('unknown engine is rejected', async () => {
    let error;
    try {
      await createEngine({ engine: 'x' });
    } catch (caught) {
      error = caught;
    }
    expect(error?.message).toBe('Unknown engine: x');
    expect(() => getEngine('x')).toThrow('Unknown engine: x');
  });
});
