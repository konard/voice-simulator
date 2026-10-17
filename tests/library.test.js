/**
 * Public library API: synthesis, streaming, LOD governor and head model.
 */

import { describe, it, expect } from 'test-anywhere';
import {
  AUDIO_TIERS,
  LodGovernor,
  VISUAL_TIERS,
  chooseTier,
  decodeWav,
  encodeWav,
  getAudioTier,
  headModel,
  headModelObj,
  measureAudioTier,
  prepareUtterance,
  randomHeadConfig,
  synthesize,
  synthesizeStream,
} from '../src/index.js';

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

  it('measures real tiers with a positive load', () => {
    expect(measureAudioTier(AUDIO_TIERS[0], { seconds: 0.05 }) > 0).toBe(true);
    expect(VISUAL_TIERS[0].meshLod).toBe(0);
  });
});

describe('headModel', () => {
  it('builds head, tract, nose and lips meshes', () => {
    const meshes = headModel(randomHeadConfig(4), { lod: 0 });
    expect(meshes.map((mesh) => mesh.name)).toEqual([
      'head',
      'tract',
      'nose',
      'lips',
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
  });
});
