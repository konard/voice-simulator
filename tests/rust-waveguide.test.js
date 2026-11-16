/**
 * The Rust port of the waveguide voice renderer (issue 22) gives the same
 * numbers as the JavaScript reference: the biquad, the LF glottis and the
 * waveguide on their own, then whole renders. All of them are parity
 * class B (docs/RUST-ENGINE.md): they call sin, cos, exp, log, pow or
 * tanh, so the error is measured against the JavaScript output as
 * `error(a, e) = sqrt(sum((a - e)^2) / sum(e^2))`.
 *
 * Skipped with a visible reason when src/engine/voice-simulator.wasm has
 * not been built; CI builds it and runs this file with REQUIRE_WASM=1.
 */

import { describe, expect, it as alwaysIt } from 'test-anywhere';

import { Biquad, createNoise } from '../src/acoustics/filters.js';
import {
  GLOTTIS_BREATHY,
  GLOTTIS_OPEN,
  GLOTTIS_VOICED,
  RE_CRITICAL,
} from '../src/acoustics/aerodynamics.js';
import { Glottis } from '../src/acoustics/glottis.js';
import { Radiation, RADIATION_BAFFLE } from '../src/acoustics/radiation.js';
import {
  NoiseSources,
  OutputStage,
  renderPlan,
} from '../src/acoustics/voice.js';
import { piriformBranch, Waveguide } from '../src/acoustics/waveguide.js';
import { noseShape } from '../src/articulation/tract-shape.js';
import {
  renderPlanRust,
  RustVoiceRenderer,
} from '../src/engine/rust-renderer.js';
import { float64View } from '../src/engine/wasm-loader.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { hashSeed } from '../src/random.js';
import { prepareUtterance } from '../src/synthesize.js';
import { loadRustEngine, noRust } from './helpers/rust-engine.js';
import { itUnless } from './helpers/skip.js';

const it = itUnless(noRust);

/** Relative RMS error of `actual` against `expected`. */
export function error(actual, expected) {
  expect(actual.length).toBe(expected.length);
  let difference = 0;
  let energy = 0;
  for (let index = 0; index < expected.length; index++) {
    difference += (actual[index] - expected[index]) ** 2;
    energy += expected[index] ** 2;
  }
  return Math.sqrt(difference / energy);
}

/**
 * Copy `values` into the engine, run `call(pointer, count)` on them and
 * copy the block back.
 * @returns {{result: number, values: Float64Array}}
 */
function inEngine(engine, values, call) {
  const { vs_alloc: alloc, vs_free: free } = engine.exports;
  const bytes = Math.max(values.length * 8, 8);
  const pointer = alloc(bytes);
  expect(pointer).not.toBe(0);
  try {
    float64View(engine, pointer, values.length).set(values);
    const result = call(pointer, values.length);
    return {
      result,
      values: float64View(engine, pointer, values.length).slice(),
    };
  } finally {
    free(pointer, bytes);
  }
}

describe('Rust sources (issue 22)', () => {
  it('biquad matches', async () => {
    const engine = await loadRustEngine();
    const noise = createNoise(1);
    const input = Float64Array.from({ length: 4096 }, () => noise());
    const filter = new Biquad().lowpass(3600, 0.54, 25455);
    const expected = input.map((value) => filter.process(value));
    const { result, values } = inEngine(engine, input, (pointer, count) =>
      engine.exports.vs_biquad_run(0, 3600, 0.54, 25455, pointer, count)
    );
    expect(result).toBe(0);
    const measured = error(values, expected);
    globalThis.console.log(`biquad error ${measured}`);
    expect(measured < 1e-9).toBe(true);
  });

  /** Advanced source values of a head away from their defaults (issue 41). */
  const SOURCE_HEAD = {
    breathinessRd: 2.1,
    breathGain: 2.2,
    breathExponent: 1.7,
    chinkNoise: 1.2,
    reCritical: 1750,
    glottisVoiced: 0.08,
    glottisOpen: 0.3,
    glottisBreathy: 0.17,
  };
  for (const [label, head, effort] of [
    ['default', undefined],
    ['head values', SOURCE_HEAD],
    // Vocal effort (issue 52): gain, tilt shelf, tension and noise rule.
    ['effort', undefined, { effort: 12, tension: 0.072 }],
    ['soft effort', undefined, { effort: -10, tension: -0.06 }],
    // Phonation types (issue 54): breath noise, creak, falsetto, harsh.
    ['breathy', undefined, { effort: 0, tension: -0.23, breath: 1 }],
    ['creaky', undefined, { effort: 0, tension: 0.33, creak: 1 }],
    [
      'falsetto',
      undefined,
      { effort: 0, tension: -0.17, falsetto: 1, breath: 0.3 },
    ],
    ['harsh', undefined, { effort: 0, tension: 0.33, harsh: 1 }],
  ]) {
    it(`glottis matches (${label})`, async () => {
      await glottisMatches(head, effort);
    });
  }

  async function glottisMatches(head, effort = { effort: 0, tension: 0 }) {
    const engine = await loadRustEngine();
    const dt = 1 / 46667;
    const count = Math.round(0.5 / dt);
    const control = {
      f0: 120,
      voicing: 1,
      aspiration: 0.1,
      closure: 0,
      loudness: 1,
      ...effort,
    };
    const noise = createNoise(2);
    const input = Float64Array.from({ length: count }, () => noise());
    const glottis = new Glottis({ seed: 1, breathiness: 0.5, chink: 3, head });
    let periods = 0;
    const expected = input.map((value) => {
      const previous = glottis.phase;
      const sample = glottis.step(dt, control, value);
      if (glottis.phase < previous) {
        periods++;
      }
      return sample;
    });
    const parameters = [
      glottis.tenseness,
      glottis.breathiness,
      100 * glottis.jitterDepth,
      100 * glottis.shimmerDepth,
      glottis.aspirationLevel,
      glottis.chink,
      glottis.lungPressure,
      dt,
      control.f0,
      control.voicing,
      control.aspiration,
      control.closure,
      control.loudness,
      glottis.rdSlope,
      glottis.breathGain,
      glottis.breathExponent,
      glottis.chinkNoise,
      head?.reCritical ?? RE_CRITICAL,
      head?.glottisVoiced ?? GLOTTIS_VOICED,
      head?.glottisOpen ?? GLOTTIS_OPEN,
      head?.glottisBreathy ?? GLOTTIS_BREATHY,
      control.effort,
      control.tension,
      control.breath ?? 0,
      control.creak ?? 0,
      control.falsetto ?? 0,
      control.harsh ?? 0,
    ];
    const { values } = inEngine(engine, input, (pointer, length) =>
      inEngine(engine, parameters, (params) => {
        const result = engine.exports.vs_glottis_run(
          hashSeed('1:glottis'),
          params,
          pointer,
          length
        );
        expect(result).toBe(periods);
        return result;
      })
    );
    const measured = error(values, expected);
    globalThis.console.log(`glottis error ${measured}, ${periods} periods`);
    expect(measured < 1e-6).toBe(true);
  }

  it('radiation matches', async () => {
    const engine = await loadRustEngine();
    const rate = (22 * 35000) / 16.5;
    const noise = createNoise(3);
    const input = Float64Array.from({ length: 4096 }, () => noise());
    const radiation = new Radiation();
    radiation.configure(3, rate, RADIATION_BAFFLE);
    const expected = input.map((value) => radiation.process(value));
    const { result, values } = inEngine(engine, input, (pointer, count) =>
      engine.exports.vs_radiation_run(3, rate, RADIATION_BAFFLE, pointer, count)
    );
    expect(result).toBe(0);
    const measured = error(values, expected);
    globalThis.console.log(`radiation error ${measured}`);
    expect(measured).toBe(0);
  });
});

describe('Rust waveguide and output (issue 22)', () => {
  it('waveguide matches', async () => {
    const engine = await loadRustEngine();
    const sections = 22;
    const noseSections = 14;
    const head = {
      ...DEFAULT_HEAD,
      glottalChink: 2,
      lossShape: 1.8,
      radiationBaffle: 0.7,
    };
    const areas = Array.from({ length: sections }, (_, index) =>
      index >= 14 && index <= 16 ? 0.3 : 3
    );
    const nose = noseShape(head).areas;
    const velumArea = 0.4;
    const velumIndex = 10;
    const waveguide = new Waveguide({ sections, noseSections, head });
    waveguide.setNose(nose);
    waveguide.setShape(areas, velumArea, velumIndex);
    const input = new Float64Array(4096);
    input[0] = 1;
    const expected = input.map((value) => waveguide.step(value, 1, 0, 0));
    const branch = piriformBranch(sections, 16.5, head);
    const parameters = [
      sections,
      noseSections,
      head.wallLoss,
      head.nasalLoss,
      head.glottalChink,
      head.vocalTractLength,
      branch.index,
      branch.area,
      branch.sections,
      velumArea,
      velumIndex,
      head.wallMass,
      head.wallResistance,
      head.wallStiffness,
      head.lossShape,
      head.radiationBaffle,
      ...areas,
      ...nose,
    ];
    const { values } = inEngine(engine, input, (pointer, length) =>
      inEngine(engine, parameters, (params, count) => {
        const result = engine.exports.vs_waveguide_run(
          params,
          count,
          pointer,
          length
        );
        expect(result).toBe(0);
        return result;
      })
    );
    const measured = error(values, expected);
    globalThis.console.log(`waveguide error ${measured}`);
    expect(measured < 1e-9).toBe(true);
  });
  for (const [label, sampleRate, bandLimit] of [
    ['wide', 22050, undefined],
    ['band-limited', 8000, 3400],
  ]) {
    it(`noise sources and output stage match (${label})`, async () => {
      const engine = await loadRustEngine();
      const rate = (22 * 35000) / 16.5;
      const frequency = 2500;
      const noise = createNoise(4);
      const input = Float64Array.from({ length: 4096 }, () => noise());
      const sources = new NoiseSources(1);
      const output = new OutputStage(sampleRate, 1.2, bandLimit);
      sources.configure(rate);
      sources.tune(frequency);
      output.configure(rate);
      const expected = input.map((value) => {
        const aspiration = sources.aspiration.process(sources.white());
        const frication = sources.frication.process(sources.white());
        return output.finish(output.filter(value + aspiration + frication));
      });
      const { result, values } = inEngine(engine, input, (pointer, count) =>
        engine.exports.vs_stages_run(
          hashSeed('1:noise'),
          sampleRate,
          1.2,
          bandLimit ?? 0,
          rate,
          frequency,
          pointer,
          count
        )
      );
      expect(result).toBe(0);
      const measured = error(values, expected);
      globalThis.console.log(`stages (${label}) error ${measured}`);
      expect(measured < 1e-9).toBe(true);
    });
  }
});

// The references below render with `engine: 'js'`: since issue 25 the
// default engine is Rust, so without it a test would compare Rust with Rust.

/** Largest absolute difference of two equally long arrays. */
function maxDifference(actual, expected) {
  expect(actual.length).toBe(expected.length);
  let max = 0;
  for (let index = 0; index < expected.length; index++) {
    max = Math.max(max, Math.abs(actual[index] - expected[index]));
  }
  return max;
}

describe('Rust renderer (issue 22)', () => {
  for (const tier of ['minimal', 'low', 'medium']) {
    it(`renders like VoiceRenderer (${tier})`, async () => {
      const engine = await loadRustEngine();
      const { plan, renderOptions } = prepareUtterance('Hello world.', {
        tier,
        seed: 1,
      });
      const expected = renderPlan(plan, { ...renderOptions, engine: 'js' });
      const actual = renderPlanRust(engine, plan, renderOptions);
      const measured = maxDifference(actual, expected);
      globalThis.console.log(`render (${tier}) max abs diff ${measured}`);
      expect(measured < 1e-4).toBe(true);
    });
  }

  it('renders vocal effort like VoiceRenderer (issue 52)', async () => {
    const engine = await loadRustEngine();
    const { plan, renderOptions } = prepareUtterance(
      '[soft]Hello[/soft] [crescendo]there, my[/crescendo] [shout]friend![/shout]',
      { tier: 'minimal', seed: 1, markup: true }
    );
    expect(Math.max(...plan.channels.effort)).toBe(20);
    expect(renderOptions.levelOffsetDb).toBe(-20);
    const expected = renderPlan(plan, { ...renderOptions, engine: 'js' });
    const actual = renderPlanRust(engine, plan, renderOptions);
    const measured = maxDifference(actual, expected);
    globalThis.console.log(`render (effort) max abs diff ${measured}`);
    expect(measured < 1e-4).toBe(true);
  });

  it('renders phonation types like VoiceRenderer (issue 54)', async () => {
    const engine = await loadRustEngine();
    const { plan, renderOptions } = prepareUtterance(
      '[breathy]Hello[/breathy] [creaky]there,[/creaky] [falsetto]my[/falsetto] [harsh]friend.[/harsh]',
      { tier: 'minimal', seed: 1, markup: true }
    );
    for (const channel of ['breath', 'creak', 'falsetto', 'harsh']) {
      expect(Math.max(...plan.channels[channel]) > 0.5).toBe(true);
    }
    const expected = renderPlan(plan, { ...renderOptions, engine: 'js' });
    const actual = renderPlanRust(engine, plan, renderOptions);
    const measured = maxDifference(actual, expected);
    globalThis.console.log(`render (phonation) max abs diff ${measured}`);
    expect(measured < 1e-4).toBe(true);
  });

  it('renders paralinguistic sounds like VoiceRenderer (issue 56)', async () => {
    const engine = await loadRustEngine();
    const { plan, renderOptions, timeline } = prepareUtterance(
      '[inhale] Well, um, haha [sigh] ok [cough] [click].',
      { tier: 'minimal', seed: 1, markup: true }
    );
    expect(timeline.sounds.map((sound) => sound.name)).toEqual([
      'inhale',
      'um',
      'laugh',
      'sigh',
      'cough',
      'click',
    ]);
    const expected = renderPlan(plan, { ...renderOptions, engine: 'js' });
    const actual = renderPlanRust(engine, plan, renderOptions);
    const measured = maxDifference(actual, expected);
    globalThis.console.log(`render (sounds) max abs diff ${measured}`);
    expect(measured < 1e-4).toBe(true);
  });

  it('renders a microphone in a room like VoiceRenderer', async () => {
    const engine = await loadRustEngine();
    const { plan, renderOptions } = prepareUtterance('Hello world.', {
      tier: 'minimal',
      seed: 1,
    });
    const options = {
      ...renderOptions,
      room: 'studio',
      microphone: { distance: 30 },
    };
    const expected = renderPlan(plan, { ...options, engine: 'js' });
    const actual = renderPlanRust(engine, plan, options);
    const measured = maxDifference(actual, expected);
    globalThis.console.log(`render (room) max abs diff ${measured}`);
    expect(measured < 1e-4).toBe(true);
  });

  it('renders a non-default head like VoiceRenderer (issue 41)', async () => {
    const engine = await loadRustEngine();
    // Every advanced value the Rust core reads, away from its default, and
    // the head's own microphone and room.
    const head = {
      ...DEFAULT_HEAD,
      breathiness: 0.4,
      glottalChink: 2,
      breathinessRd: 2,
      breathGain: 2.5,
      breathExponent: 1.8,
      chinkNoise: 1,
      oralCompliance: 0.0015,
      reCritical: 1750,
      glottisVoiced: 0.07,
      glottisOpen: 0.3,
      glottisBreathy: 0.15,
      wallSource: 0.3,
      strouhal: 0.25,
      fricationGain: 0.8,
      transientGain: 1e-5,
      lossShape: 1.8,
      radiationBaffle: 0.7,
      micDistance: 30,
      micAzimuth: 30,
      roomRt60: 0.3,
    };
    const { plan, renderOptions } = prepareUtterance('Sister, push it.', {
      tier: 'minimal',
      seed: 1,
      head,
    });
    const expected = renderPlan(plan, { ...renderOptions, engine: 'js' });
    const actual = renderPlanRust(engine, plan, renderOptions);
    const measured = maxDifference(actual, expected);
    globalThis.console.log(`render (head) max abs diff ${measured}`);
    expect(measured < 1e-4).toBe(true);
    // The head values reach the render: the default head sounds different.
    const plain = prepareUtterance('Sister, push it.', {
      tier: 'minimal',
      seed: 1,
    });
    const reference = renderPlanRust(engine, plain.plan, plain.renderOptions);
    // The room adds a tail: compare the common part.
    const common = Math.min(reference.length, actual.length);
    const changed = maxDifference(
      reference.subarray(0, common),
      actual.subarray(0, common)
    );
    expect(changed > 1e-3).toBe(true);
  });

  it('gives the same samples for any chunking', async () => {
    const engine = await loadRustEngine();
    const { plan, renderOptions } = prepareUtterance('Hello world.', {
      tier: 'minimal',
      seed: 1,
    });
    const whole = renderPlanRust(engine, plan, renderOptions);
    for (const size of [1, 37, 1024]) {
      const renderer = new RustVoiceRenderer(engine, plan, renderOptions);
      const samples = new Float32Array(renderer.totalSamples);
      try {
        for (let start = 0; start < samples.length; start += size) {
          renderer.render(samples.subarray(start, start + size));
        }
        expect(renderer.done).toBe(true);
        expect(renderer.render(new Float32Array(8))).toBe(0);
      } finally {
        renderer.free();
      }
      expect(maxDifference(samples, whole)).toBe(0);
    }
  });

  it('gives the field of the waveguide', async () => {
    const engine = await loadRustEngine();
    const { plan, renderOptions } = prepareUtterance('a', {
      tier: 'minimal',
    });
    const renderer = new RustVoiceRenderer(engine, plan, renderOptions);
    try {
      await renderer.renderAsync(new Float32Array(2000));
      expect(renderer.position).toBe(2000);
      const { pressure, nose } = renderer.field();
      expect(pressure.length).toBe(renderOptions.sections);
      expect(nose.length > 0).toBe(true);
      expect(pressure.some((value) => value !== 0)).toBe(true);
    } finally {
      renderer.free();
    }
  });
});

describe('Rust renderer options (issue 22)', () => {
  const { plan } = prepareUtterance('a', { tier: 'minimal' });
  for (const options of [
    { solver: 'fdtd2d' },
    { device: {} },
    { solver: 'fdtd3d', device: {} },
    { source: 'folds' },
    { bandLimit: 0 },
  ]) {
    alwaysIt(`refuses ${JSON.stringify(options)}`, () => {
      expect(() => new RustVoiceRenderer(null, plan, options)).toThrow();
      try {
        new RustVoiceRenderer(null, plan, options);
      } catch (error) {
        expect(error.code).toBe('ENGINE_UNSUPPORTED');
      }
    });
  }
});
