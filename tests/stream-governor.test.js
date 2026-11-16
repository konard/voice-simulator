/**
 * StreamGovernor (src/perf/lod.js, issue 29): the audio tier of a running
 * utterance. Chunks of 1024 samples at 48000 Hz (21.3 ms) as the worker
 * renders them.
 */

import { describe, expect, it } from 'test-anywhere';

import {
  AUDIO_TIERS,
  StreamGovernor,
  audioTierIndex,
  fallbackLevel,
} from '../src/perf/lod.js';

const CHUNK = 1024 / 48000;
const medium = audioTierIndex('medium');
const minimal = audioTierIndex('minimal');

/**
 * Feed chunks of `load` until the governor proposes a level, then switch
 * to it as the worker does.
 * @returns {{level: number|null, records: number, seconds: number}}
 */
function runUntilProposal(governor, load, maxSeconds) {
  let records = 0;
  while (records * CHUNK < maxSeconds) {
    records++;
    const level = governor.record(load * CHUNK, CHUNK);
    if (level !== null) {
      return { level, records, seconds: records * CHUNK };
    }
  }
  return { level: null, records, seconds: records * CHUNK };
}

describe('StreamGovernor', () => {
  it('goes down within 0.1 s', () => {
    const governor = new StreamGovernor({ level: medium });
    const { level, records } = runUntilProposal(governor, 1.3, 1);
    expect(records).toBe(5);
    expect(level).toBe(fallbackLevel(AUDIO_TIERS, medium, 1.3, 0.8));
    expect(level).toBeLessThan(medium);
    expect(governor.ceiling).toBe(medium - 1);
  });

  it('stays while the load fits', () => {
    const governor = new StreamGovernor({ level: medium });
    // 0.7 fits the target 0.8; the next tier would be 0.7 * 10 / 2.6.
    expect(runUntilProposal(governor, 0.7, 10).level).toBe(null);
  });

  it('goes up after 3 s, one level', () => {
    const governor = new StreamGovernor({ level: minimal });
    let at = 0;
    for (let step = 0; step < 3; step++) {
      const { level, seconds } = runUntilProposal(governor, 0.05, 10);
      at += seconds;
      expect(level).toBe(minimal + step + 1);
      expect(seconds).toBeGreaterThanOrEqual(3);
      expect(seconds).toBeLessThan(3 + CHUNK);
      governor.switched(level);
    }
    expect(governor.level).toBe(minimal + 3);
    expect(at).toBeGreaterThanOrEqual(9);
  });

  it('predicts the load of the new level', () => {
    const governor = new StreamGovernor({ level: minimal });
    governor.record(0.5 * CHUNK, CHUNK);
    governor.switched(audioTierIndex('low'));
    expect(Math.abs(governor.load - 0.5 * 1.6)).toBeLessThan(1e-9);
    expect(governor.since).toBe(0);
  });

  it('never returns to a level it left', () => {
    const governor = new StreamGovernor({ level: medium });
    const down = runUntilProposal(governor, 1.3, 1).level;
    governor.switched(down);
    // A very fast chunk afterwards: up to the ceiling, never to medium.
    const levels = [];
    for (let records = 0; records * CHUNK < 30; records++) {
      const level = governor.record(0.01 * CHUNK, CHUNK);
      if (level !== null) {
        levels.push(level);
        governor.switched(level);
      }
    }
    expect(Math.max(down, ...levels)).toBe(medium - 1);
    expect(governor.level).toBeLessThan(medium);
  });

  it('underrun steps down at once', () => {
    const governor = new StreamGovernor({ level: medium });
    governor.record(0.1 * CHUNK, CHUNK);
    expect(governor.underrun()).toBe(medium - 1);
    expect(governor.ceiling).toBe(medium - 1);
    governor.switched(medium - 1);
    expect(runUntilProposal(governor, 0.01, 10).level).toBe(null);
    const bottom = new StreamGovernor({ level: 0 });
    expect(bottom.underrun()).toBe(null);
    expect(runUntilProposal(bottom, 2, 1).level).toBe(null);
  });

  it('respects maxLevel', () => {
    const governor = new StreamGovernor({ level: minimal, maxLevel: minimal });
    expect(runUntilProposal(governor, 0.01, 10).level).toBe(null);
  });
});
