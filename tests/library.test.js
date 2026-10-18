/**
 * Public library API: synthesis, streaming, LOD governor and head model.
 */

import { describe, it, expect } from 'test-anywhere';
import {
  AUDIO_TIERS,
  DEFAULT_AUDIO_TIER,
  LodGovernor,
  VISUAL_TIERS,
  chooseTier,
  chooseTierWithGpu,
  fallbackLevel,
  OverloadDetector,
  decodeWav,
  encodeWav,
  getAudioTier,
  headModel,
  headModelObj,
  measureAudioTier,
  measureAudioTierAsync,
  prepareUtterance,
  randomHeadConfig,
  synthesize,
  synthesizeStream,
} from '../src/index.js';
import { runCli } from '../bin/voice-simulator.js';

describe('synthesize', () => {
  it('turns text of each language into audible audio', () => {
    for (const [text, lang] of [
      ['Hello', 'en'],
      ['Привет', 'ru'],
      ['नमस्ते', 'hi'],
      ['你好', 'zh'],
    ]) {
      const result = synthesize(text, { tier: 'minimal' });
      expect(result.lang).toBe(lang);
      expect(result.sampleRate).toBe(22050);
      expect(result.duration > 0.2).toBe(true);
      let peak = 0;
      for (const sample of result.samples) {
        expect(Number.isFinite(sample)).toBe(true);
        peak = Math.max(peak, Math.abs(sample));
      }
      expect(peak > 0.05).toBe(true);
      expect(peak <= 1).toBe(true);
    }
  });

  it('is deterministic for a seed and accepts IPA input', () => {
    const options = { tier: 'minimal', ipa: true, head: 'random', seed: 7 };
    const first = synthesize('ˈmama', options);
    const second = synthesize('ˈmama', options);
    expect(first.ipa).toBe('ˈmama');
    expect(first.head).toEqual(randomHeadConfig(7));
    expect(Array.from(first.samples)).toEqual(Array.from(second.samples));
  });

  it('applies tiers and lets explicit options override them', () => {
    expect(getAudioTier('high').solver).toBe('fdtd3d');
    expect(getAudioTier(0)).toBe(AUDIO_TIERS[0]);
    expect(getAudioTier(undefined)).toBe(null);
    expect(() => getAudioTier('nope')).toThrow();
    const prepared = prepareUtterance('a', {
      tier: 'high',
      ipa: true,
      solver: 'waveguide',
      sampleRate: 16000,
    });
    expect(prepared.renderOptions.solver).toBe('waveguide');
    expect(prepared.renderOptions.dx).toBe(1);
    expect(prepared.renderOptions.sampleRate).toBe(16000);
  });

  it('defaults to full 3D acoustics at 0.5 cm and keeps the waveguide a choice away', () => {
    expect(DEFAULT_AUDIO_TIER).toBe('studio');
    const names = AUDIO_TIERS.map((tier) => tier.name);
    expect(names.slice(-2)).toEqual(['studio', 'reference']);
    for (let level = 1; level < AUDIO_TIERS.length; level++) {
      expect(AUDIO_TIERS[level].cost > AUDIO_TIERS[level - 1].cost).toBe(true);
    }
    const byDefault = prepareUtterance('a', { ipa: true }).renderOptions;
    expect(byDefault.solver).toBe('fdtd3d');
    expect(byDefault.dx).toBe(0.5);
    expect(byDefault.sampleRate).toBe(48000);
    const earlier = prepareUtterance('a', { ipa: true, tier: 'medium' });
    expect(earlier.renderOptions.solver).toBe('waveguide');
    // A solver alone keeps its own defaults, not the default tier's.
    const waveguide = prepareUtterance('a', { ipa: true, solver: 'waveguide' });
    expect(waveguide.renderOptions.solver).toBe('waveguide');
    expect(waveguide.renderOptions.dx).toBe(undefined);
  });

  it('names the default tier and the waveguide fallback in the CLI help', async () => {
    const lines = [];
    expect(
      await runCli(['--help'], { stdout: (line) => lines.push(line) })
    ).toBe(0);
    expect(lines.join('\n')).toContain(
      'default studio: 3D; medium: real-time waveguide'
    );
  });

  it('round-trips through WAV encoding', () => {
    const { samples, sampleRate } = synthesize('ba', {
      tier: 'minimal',
      ipa: true,
    });
    const decoded = decodeWav(encodeWav(samples, sampleRate));
    expect(decoded.sampleRate).toBe(sampleRate);
    expect(decoded.samples.length).toBe(samples.length);
  });
});

describe('synthesizeStream', () => {
  it('yields the same samples as offline synthesis in chunks', async () => {
    const options = { tier: 'minimal', seed: 3, chunkSize: 1000 };
    const offline = synthesize('Hi there', options);
    const chunks = [];
    for await (const chunk of synthesizeStream('Hi there', options)) {
      expect(chunk.length <= 1000).toBe(true);
      chunks.push(...chunk);
    }
    expect(chunks.length).toBe(offline.samples.length);
    expect(chunks.slice(0, 5000)).toEqual(
      Array.from(offline.samples.slice(0, 5000))
    );
  });
});

describe('LodGovernor', () => {
  const tiers = [{ cost: 1 }, { cost: 2 }, { cost: 4 }, { cost: 8 }];

  it('steps down immediately when the load exceeds the target', () => {
    const governor = new LodGovernor({ tiers, level: 3 });
    expect(governor.record(1.2, 1)).toBe(true);
    // 1.2 at cost 8 predicts 0.6 at cost 4, which fits under 0.8.
    expect(governor.level).toBe(2);
    expect(Math.abs(governor.load - 0.6) < 1e-9).toBe(true);
  });

  it('skips several levels when one step is not enough', () => {
    const governor = new LodGovernor({ tiers, level: 3 });
    governor.record(4, 1);
    expect(governor.level).toBe(0);
  });

  it('steps up only after the dwell time and with headroom', () => {
    const governor = new LodGovernor({ tiers, dwell: 5 });
    for (let index = 0; index < 4; index++) {
      expect(governor.record(0.2, 1)).toBe(false);
    }
    expect(governor.record(0.2, 1)).toBe(true);
    expect(governor.level).toBe(1);
    // 0.4 at cost 2 would be 0.8 at cost 4: no headroom, stay.
    for (let index = 0; index < 20; index++) {
      governor.record(0.4, 1);
    }
    expect(governor.level).toBe(1);
  });

  it('keeps about 20% headroom under a steady load model', () => {
    // Simulated machine: work = 0.3 s per unit of cost per second.
    const governor = new LodGovernor({ tiers, dwell: 3 });
    for (let step = 0; step < 200; step++) {
      governor.record(0.3 * governor.tier.cost, 1);
    }
    expect(governor.level).toBe(1);
    expect(governor.load <= 0.8).toBe(true);
  });

  it('respects maxLevel', () => {
    const governor = new LodGovernor({ tiers, dwell: 1, maxLevel: 1 });
    for (let step = 0; step < 10; step++) {
      governor.record(0.01, 1);
    }
    expect(governor.level).toBe(1);
  });
});

describe('chooseTier', () => {
  it('stops at the first tier above the target', () => {
    const measured = [];
    const result = chooseTier(
      (tier) => {
        measured.push(tier.cost);
        return tier.cost * 0.25;
      },
      { tiers: [{ cost: 1 }, { cost: 2 }, { cost: 4 }, { cost: 8 }] }
    );
    expect(result.level).toBe(1);
    expect(measured).toEqual([1, 2, 4]);
  });

  it('skips tiers predicted to be far too slow', () => {
    const measured = [];
    const result = chooseTier(
      (tier) => {
        measured.push(tier.cost);
        return tier.cost * 0.1;
      },
      { tiers: [{ cost: 1 }, { cost: 2 }, { cost: 60 }, { cost: 300 }] }
    );
    expect(measured).toEqual([1, 2]);
    expect(result.level).toBe(1);
    expect(result.measured).toEqual([true, true, false]);
    expect(Math.abs(result.loads[2] - 6) < 1e-9).toBe(true);
  });

  it('measures the 3D tiers above the CPU choice on the GPU', async () => {
    const tiers = [
      { cost: 1, solver: 'waveguide' },
      { cost: 2, solver: 'waveguide' },
      { cost: 60, solver: 'fdtd3d' },
      { cost: 120, solver: 'fdtd3d' },
      { cost: 400, solver: 'fdtd3d' },
    ];
    const run = (gpuLoad) => {
      const measured = [];
      const measure = (tier, { gpu }) => {
        measured.push(`${gpu ? 'gpu' : 'cpu'}${tier.cost}`);
        return Promise.resolve(gpu ? gpuLoad(tier) : tier.cost * 0.1);
      };
      return chooseTierWithGpu(measure, { tiers, gpu: true }).then(
        (result) => ({ ...result, measured })
      );
    };
    const fast = await run((tier) => tier.cost / 200);
    expect(fast.measured).toEqual(['cpu1', 'cpu2', 'gpu60', 'gpu120']);
    expect(fast.level).toBe(3);
    expect(fast.gpu).toBe(true);
    expect(fast.gpuLoads).toEqual([null, null, 0.3, 0.6, null]);
    const slow = await run((tier) => tier.cost);
    expect(slow.level).toBe(1);
    expect(slow.gpu).toBe(false);
    const cpu = await chooseTierWithGpu(
      (tier) => Promise.resolve(tier.cost * 0.1),
      { tiers }
    );
    expect([cpu.level, cpu.gpu]).toEqual([1, false]);
  });

  it('measures tiers asynchronously on the CPU without a device', async () => {
    const load = await measureAudioTierAsync(AUDIO_TIERS[0], {
      seconds: 0.05,
    });
    expect(load > 0).toBe(true);
  });

  it('stops measuring a tier once it exceeds the limit', () => {
    const slow = { ...AUDIO_TIERS[2], name: 'slow' };
    const began = globalThis.performance.now();
    const load = measureAudioTier(slow, { seconds: 1, limit: 0.001 });
    expect(load > 0.001).toBe(true);
    expect(globalThis.performance.now() - began < 500).toBe(true);
  });

  it('detects overload early and picks a cheaper tier', () => {
    const detector = new OverloadDetector();
    expect(detector.record(0.01, 0.021)).toBe(false);
    expect(detector.record(0.05, 0.021)).toBe(true);
    expect(fallbackLevel(AUDIO_TIERS, 4, detector.load)).toBe(3);
    expect(fallbackLevel(AUDIO_TIERS, 3, 1.3)).toBe(2);
    expect(fallbackLevel(AUDIO_TIERS, 2, 3)).toBe(0);
    const late = new OverloadDetector();
    expect(late.record(2, 1)).toBe(false);
  });

  it('measures real tiers with a positive load', () => {
    expect(measureAudioTier(AUDIO_TIERS[0], { seconds: 0.05 }) > 0).toBe(true);
    expect(VISUAL_TIERS[0].meshLod).toBe(0);
  });
});

describe('headModel', () => {
  it('builds head, tract, nose, lips and articulator meshes', () => {
    const meshes = headModel(randomHeadConfig(4), { lod: 0 });
    expect(meshes.map((mesh) => mesh.name)).toEqual([
      'head',
      'tract',
      'nose',
      'lips',
      'upperTeeth',
      'lowerTeeth',
      'tongue',
      'palate',
      'velum',
    ]);
    for (const mesh of meshes) {
      expect(mesh.positions.length > 0).toBe(true);
      expect(mesh.indices.length % 3).toBe(0);
    }
  });

  it('has more triangles at higher LOD and exports OBJ', () => {
    const triangles = (lod) =>
      headModel({}, { lod }).reduce(
        (sum, mesh) => sum + mesh.indices.length / 3,
        0
      );
    expect(triangles(3) > triangles(0)).toBe(true);
    const obj = headModelObj({}, { lod: 0 });
    expect(obj).toContain('o head');
    expect(obj).toContain('o lips');
    expect(obj).toContain('o tongue');
  });
});
