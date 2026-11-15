/**
 * Issue 27: the AudioWorklet processor of the streaming player, run in a
 * faked worklet scope (tests/helpers/fake-worklet.js) on blocks of 128
 * samples at 48 kHz.
 */

import { describe, it, expect } from 'test-anywhere';
import {
  RING,
  createRing,
  ringEnd,
  ringRead,
  ringReset,
  ringWrite,
} from '../src/playback/ring-buffer.js';
import { loadPlayerProcessor, renderBlocks } from './helpers/fake-worklet.js';

const RATE = 48000;

function ramp(length, from = 0) {
  return Float32Array.from({ length }, (_, index) => (from + index) / RATE);
}

/** A processor in port mode, or in shared mode on a ring of `capacity`. */
async function processor(mode, capacity = 65536) {
  const Processor = await loadPlayerProcessor();
  const node = new Processor();
  if (mode === 'port') {
    return {
      node,
      push: (samples) => node.port.receive({ type: 'chunk', samples }),
      end: () => node.port.receive({ type: 'end' }),
      reset: () => node.port.receive({ type: 'reset' }),
      played: () => node.played,
      underruns: () => node.underruns,
    };
  }
  const ring = createRing(capacity, { shared: true });
  node.port.receive({ type: 'ring', buffer: ring.buffer });
  return {
    node,
    ring,
    push: (samples) => expect(ringWrite(ring, samples)).toBe(samples.length),
    end: () => ringEnd(ring),
    reset: () => ringReset(ring),
    played: () => Atomics.load(ring.header, RING.PLAYED),
    underruns: () => Atomics.load(ring.header, RING.UNDERRUNS),
  };
}

/** Whether two sample arrays are equal (faster than toEqual on long ones). */
function same(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function maxJump(samples) {
  let jump = 0;
  for (let index = 1; index < samples.length; index++) {
    jump = Math.max(jump, Math.abs(samples[index] - samples[index - 1]));
  }
  return jump;
}

for (const mode of ['port', 'shared']) {
  describe(`player processor (${mode} mode)`, () => {
    it('waits for the start threshold', async () => {
      const player = await processor(mode);
      player.push(new Float32Array(1000).fill(0.5));
      expect(renderBlocks(player.node, 4).every((v) => v === 0)).toBe(true);
      expect(player.played()).toBe(0);
      // 0.05 s at 48 kHz: 2400 samples start playback, unchanged.
      player.push(new Float32Array(1400).fill(0.5));
      const out = renderBlocks(player.node, 1);
      expect(out.every((v) => v === 0.5)).toBe(true);
      expect(player.played()).toBe(128);
    });

    it('plays every sample once and in order', async () => {
      const player = await processor(mode);
      const input = ramp(48000);
      player.push(input);
      player.end();
      const out = renderBlocks(player.node, 380);
      expect(same(out.subarray(0, 48000), input)).toBe(true);
      expect(out.subarray(48000).every((v) => v === 0)).toBe(true);
      expect(player.played()).toBe(48000);
      expect(player.underruns()).toBe(0);
    });

    it('fades out on an underrun and fades in again', async () => {
      const player = await processor(mode);
      player.push(new Float32Array(4800).fill(1));
      const out = renderBlocks(player.node, 60);
      const step = 1 / 128;
      expect(maxJump(out) <= step + 1e-7).toBe(true);
      expect(player.underruns()).toBe(1);
      expect(out.at(-1)).toBe(0);
      // 0.1 s (4800 samples) are needed before it plays again.
      player.push(new Float32Array(4700).fill(1));
      expect(renderBlocks(player.node, 4).every((v) => v === 0)).toBe(true);
      player.push(new Float32Array(100).fill(1));
      const again = renderBlocks(player.node, 3);
      expect(again[0]).toBe(0);
      expect(maxJump(again) <= step + 1e-7).toBe(true);
      expect(again[127]).toBe(127 / 128);
      expect(again[128]).toBe(1);
      expect(player.underruns()).toBe(1);
    });

    it('drains the end of the stream', async () => {
      const player = await processor(mode);
      player.push(ramp(100, 1));
      player.end();
      const out = renderBlocks(player.node, 3);
      expect(out.subarray(0, 100)).toEqual(ramp(100, 1));
      expect(out.subarray(100).every((v) => v === 0)).toBe(true);
      expect(player.played()).toBe(100);
      expect(player.underruns()).toBe(0);
    });

    it('drops the stream on a reset and waits again', async () => {
      const player = await processor(mode);
      player.push(new Float32Array(3000).fill(0.25));
      renderBlocks(player.node, 2);
      player.reset();
      player.push(new Float32Array(1000).fill(0.75));
      expect(renderBlocks(player.node, 2).every((v) => v === 0)).toBe(true);
      expect(player.played()).toBe(0);
      player.push(new Float32Array(1400).fill(0.75));
      expect(renderBlocks(player.node, 1).every((v) => v === 0.75)).toBe(true);
    });

    it('fills blocks of any length', async () => {
      const player = await processor(mode);
      const input = ramp(3000);
      player.push(input);
      player.end();
      const out = renderBlocks(player.node, 12, 256);
      expect(same(out.subarray(0, 3000), input)).toBe(true);
      expect(player.played()).toBe(3000);
    });
  });
}

describe('player processor messages', () => {
  it('reports the position every 8 blocks in port mode only', async () => {
    const port = await processor('port');
    port.push(ramp(4000));
    renderBlocks(port.node, 16);
    const positions = port.node.port.sent;
    expect(positions.length).toBe(2);
    expect(positions[1].type).toBe('position');
    expect(positions[1].played).toBe(16 * 128);
    expect(positions[1].underruns).toBe(0);
    expect(typeof positions[1].time).toBe('number');
    const shared = await processor('shared');
    shared.push(ramp(4000));
    renderBlocks(shared.node, 16);
    expect(shared.node.port.sent.length).toBe(0);
  });

  it('always returns true, also without an output', async () => {
    const { node } = await processor('port');
    expect(node.process([], [])).toBe(true);
    expect(node.process([], [[]])).toBe(true);
  });

  it('has the same ringRead as the module', async () => {
    const Processor = await loadPlayerProcessor();
    const copies = [ringRead, Processor.ringRead];
    const rings = copies.map(() => createRing(10));
    const outputs = copies.map(() => []);
    // Writes and reads of several sizes, across the wrap-around.
    for (const [write, read] of [
      [7, 4],
      [6, 9],
      [9, 3],
      [0, 5],
      [8, 8],
    ]) {
      copies.forEach((copy, index) => {
        ringWrite(rings[index], ramp(write));
        const out = new Float32Array(read);
        const count = copy(rings[index], out, read);
        outputs[index].push(count, ...out);
      });
    }
    expect(outputs[1]).toEqual(outputs[0]);
    expect(Atomics.load(rings[1].header, RING.READ)).toBe(
      Atomics.load(rings[0].header, RING.READ)
    );
  });
});
