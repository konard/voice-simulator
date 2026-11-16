/**
 * The silent device benchmark (issue 28, src/perf/device-benchmark.js),
 * with a fake clock and fake renderers unless a test says otherwise.
 */

import { describe, it, expect } from 'test-anywhere';

import {
  AUDIO_TIERS,
  BASE_AUDIO_LEVEL,
  BENCHMARK_VERSION,
  audioTierIndex,
  batteryLevelCap,
  benchmarkDevice,
  chooseLevel,
  startLevel,
} from '../src/index.js';

const SAMPLE_RATE = 48000;

/**
 * A fake clock and a `measure` whose renderers advance it: tier `index`
 * renders at `loadOf(index, info)` (work seconds per audio second), and
 * creating a renderer takes `setup` seconds.
 */
function fakeDevice(loadOf, { setup = 0, blockSeconds } = {}) {
  const device = { clock: 0, calls: [], pauses: [] };
  device.now = () => device.clock;
  device.pause = async () => {
    device.pauses.push(device.clock);
  };
  device.measure = (tier, info) => {
    device.calls.push({ tier: tier.name, ...info });
    device.clock += 1000 * setup;
    const load = loadOf(info.index, info);
    const sampleRate = blockSeconds ? 512 / blockSeconds : SAMPLE_RATE;
    return {
      sampleRate,
      render(block) {
        device.clock += (1000 * load * block.length) / sampleRate;
        return block.length;
      },
    };
  };
  return device;
}

function run(device, options = {}) {
  return benchmarkDevice({
    engine: 'js',
    now: device.now,
    pause: device.pause,
    measure: device.measure,
    ...options,
  });
}

/** Seven tiers of equal cost, so no load is predicted above the target. */
const EVEN_TIERS = Array.from({ length: 7 }, (_, index) => ({
  name: `tier${index}`,
  solver: 'waveguide',
  cost: 1,
}));

describe('benchmarkDevice', () => {
  it('stays inside the budget', async () => {
    // Every probe renders 0.8 s of audio at load 0.5: 0.4 s of work.
    const device = fakeDevice((index, info) => (info.warmup ? 0 : 0.5));
    const result = await run(device, { tiers: EVEN_TIERS, probe: 0.8 });
    expect(result.loads.length).toBe(7);
    expect(result.measured.filter(Boolean).length).toBe(2);
    expect(result.measured.slice(2).every((value) => value === false)).toBe(
      true
    );
    expect(result.cpuSeconds).toBeLessThanOrEqual(1.02);
    expect(result.partial).toBe(false);
    expect(result.version).toBe(BENCHMARK_VERSION);
  });

  it('pauses every slice', async () => {
    const device = fakeDevice(() => 0.5, { blockSeconds: 0.01 });
    const result = await run(device, { probe: 0.2, maxLevel: 3 });
    // Each block takes 5 ms of fake work.
    expect(device.pauses.length).toBeGreaterThan(0);
    const work = [0, ...device.pauses, device.clock];
    for (let index = 1; index < work.length; index++) {
      expect(work[index] - work[index - 1]).toBeLessThanOrEqual(25);
    }
    expect(result.longestSlice).toBeLessThanOrEqual(0.025);
    expect(result.cpuSeconds).toBeGreaterThan(0);
  });

  it('keeps 20 % headroom', async () => {
    const loads = [0.3, 0.5, 0.79, 0.81];
    const device = fakeDevice((index, info) =>
      info.warmup ? 1 : loads[index]
    );
    const result = await run(device, { maxLevel: 3 });
    result.loads.forEach((load, index) =>
      expect(Math.abs(load - loads[index])).toBeLessThan(1e-9)
    );
    expect(result.measured).toEqual([true, true, true, true]);
    expect(result.level).toBe(2);
    expect(result.tier).toBe(AUDIO_TIERS[2]);
  });

  it('predicted tiers need more margin', async () => {
    expect(chooseLevel([0.2, 0.5, 0.6], [true, false, false])).toBe(1);
    expect(chooseLevel([0.2, 0.5, 0.6], [true, true, true])).toBe(2);
    // The budget allows tier 0 only; the others are predicted from it.
    const tiers = [1, 2.5, 3].map((cost, index) => ({
      name: `tier${index}`,
      solver: 'waveguide',
      cost,
    }));
    const device = fakeDevice((index, info) => (info.warmup ? 0 : 0.2));
    const result = await run(device, { tiers, budget: 0.02 });
    expect(result.measured).toEqual([true, false, false]);
    expect(Math.abs(result.loads[1] - 0.5)).toBeLessThan(1e-9);
    expect(Math.abs(result.loads[2] - 0.6)).toBeLessThan(1e-9);
    expect(result.level).toBe(1);
  });

  it('warm-up is not counted', async () => {
    const device = fakeDevice((index, info) => (info.warmup ? 0.7 : 0.1));
    const result = await run(device, { maxLevel: 2 });
    expect(device.calls[0].warmup).toBe(true);
    expect(device.calls[0].index).toBe(0);
    expect(device.calls.slice(1).every((call) => !call.warmup)).toBe(true);
    for (const load of result.loads) {
      expect(Math.abs(load - 0.7)).toBeGreaterThan(0.1);
    }
  });

  it('speech interrupts and resume continues', async () => {
    let speech = false;
    const device = fakeDevice(() => 0.1);
    const measure = device.measure;
    device.measure = (tier, info) => {
      const renderer = measure(tier, info);
      if (info.warmup || info.index !== 1) {
        return renderer;
      }
      // Speech arrives once the second tier is rendered.
      return {
        ...renderer,
        render(block) {
          speech = true;
          return renderer.render(block);
        },
      };
    };
    const options = { maxLevel: 4, paused: () => speech };
    const partial = await run(device, options);
    expect(partial.partial).toBe(true);
    expect(partial.loads.length).toBe(2);
    const before = device.calls.length;
    speech = false;
    const result = await run(device, {
      ...options,
      resume: partial,
      paused: () => false,
    });
    expect(result.partial).toBe(false);
    const resumed = device.calls.slice(before);
    expect(resumed.map((call) => call.index)).toEqual([2, 3, 4]);
    expect(resumed.every((call) => !call.warmup)).toBe(true);
    expect(result.loads.length).toBe(5);
    expect(result.cpuSeconds).toBeGreaterThanOrEqual(partial.cpuSeconds);
  });

  it('real run', async () => {
    const began = globalThis.performance.now();
    const result = await benchmarkDevice({ engine: 'js' });
    const wall = (globalThis.performance.now() - began) / 1000;
    expect(wall).toBeLessThan(3);
    expect(result.cpuSeconds).toBeLessThanOrEqual(1.3);
    expect(result.loads[0]).toBeGreaterThan(0);
    expect(result.loads.length).toBe(AUDIO_TIERS.length);
    expect(result.engine.name).toBe('js');
    expect(result.partial).toBe(false);
  });
});

describe('startLevel', () => {
  it('start level follows the hints', () => {
    const narrowband = audioTierIndex('narrowband');
    expect(startLevel({ hardwareConcurrency: 2 })).toBe(narrowband);
    expect(startLevel({ deviceMemory: 1 })).toBe(narrowband);
    expect(startLevel({})).toBe(audioTierIndex('minimal'));
    expect(startLevel({})).toBe(BASE_AUDIO_LEVEL);
    expect(startLevel({ hardwareConcurrency: 8, deviceMemory: 8 })).toBe(
      BASE_AUDIO_LEVEL
    );
  });

  it('a low battery caps automatic quality at medium', () => {
    const medium = audioTierIndex('medium');
    expect(batteryLevelCap({ charging: false, level: 0.1 })).toBe(medium);
    expect(batteryLevelCap({ charging: true, level: 0.1 })).toBe(
      AUDIO_TIERS.length - 1
    );
    expect(batteryLevelCap({ charging: false, level: 0.5 })).toBe(
      AUDIO_TIERS.length - 1
    );
    expect(batteryLevelCap(null)).toBe(AUDIO_TIERS.length - 1);
  });
});
