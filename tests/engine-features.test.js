/** Build-free inventory and JS probe checks. */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'test-anywhere';
import { ENGINE_FEATURES } from '../src/engine/features.js';
import { getEngine } from '../src/engine/index.js';
import { prepareProbe } from './helpers/engine-features.js';

describe('engine feature inventory', () => {
  it('is frozen and covers every acoustic module', () => {
    expect(Object.isFrozen(ENGINE_FEATURES)).toBe(true);
    const audit = JSON.parse(
      execFileSync(
        process.execPath,
        ['scripts/check-engine-parity.mjs', '--json'],
        { encoding: 'utf8' }
      )
    );
    for (const key of ['missingInRust', 'missingInJs', 'unlisted', 'invalid']) {
      expect(audit[key]).toEqual([]);
    }
  });
  it('rejects an id missing from Rust without a build', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'engine-parity-'));
    try {
      const file = path.join(directory, 'features.rs');
      const original = readFileSync(
        'crates/voice-simulator-core/src/features.rs',
        'utf8'
      );
      writeFileSync(file, original.replace(/^[ \t]*"source\.lf",\r?\n/m, ''));
      const result = spawnSync(
        process.execPath,
        ['scripts/check-engine-parity.mjs', '--json', '--rust-file', file],
        { encoding: 'utf8' }
      );
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout).missingInRust).toEqual(['source.lf']);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  for (const feature of ENGINE_FEATURES) {
    it(`JS probe: ${feature.id}`, () => {
      const { plan, renderOptions } = prepareProbe(feature);
      expect(plan.duration <= 1).toBe(true);
      const renderer = getEngine('js').createRenderer(plan, renderOptions);
      const samples = new Float32Array(renderer.totalSamples);
      // Deno --parallel runs other test workers in this process. Count this
      // probe's thread; concurrent suites have separate CPU budgets.
      const cpuUsage = process.threadCpuUsage ?? process.cpuUsage;
      const started = cpuUsage();
      renderer.render(samples);
      expect(samples.length > 0 && samples.every(Number.isFinite)).toBe(true);
      const cpu = cpuUsage(started);
      expect((cpu.user + cpu.system) / 1000 < 1000).toBe(true);
    });
  }
});
