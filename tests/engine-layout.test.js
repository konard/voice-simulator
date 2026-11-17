/**
 * The layouts of src/engine/layout.js and the Rust constants agree (issue
 * 22): the names and indices of RENDERER_CONFIG are those of
 * crates/voice-simulator-core/src/config.rs, the ones of FRAME those of
 * frame.rs, the ones of LISTENER those of listener.rs. Compared as text,
 * so no Rust build is needed.
 */

import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'test-anywhere';

import { createListener } from '../src/acoustics/microphone.js';
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { packVoxelModel, writeVoxelModel } from '../src/engine/pack-model.js';
import {
  FRAME,
  FRAME_EXTRA_VALUES,
  LISTENER,
  RENDERER_CONFIG,
  SOURCE_STATE,
  frameStride,
  writeFrame,
} from '../src/engine/layout.js';
import { listenerValues } from '../src/engine/listener-layout.js';

/** `pub const NAME: usize = N;` lines of a Rust file, as an object. */
function rustConstants(path) {
  const text = readFileSync(
    new globalThis.URL(`../${path}`, import.meta.url),
    'utf8'
  );
  const constants = {};
  for (const match of text.matchAll(
    /^pub const ([A-Z0-9_]+): usize = (\d+);$/gm
  )) {
    constants[match[1]] = Number(match[2]);
  }
  return constants;
}

describe('engine layouts (issue 22)', () => {
  it('packs identical model bytes into reused aligned and unaligned views', () => {
    const model = buildVoxelModel(DEFAULT_HEAD, { dx: 3 });
    const expected = new Uint8Array(packVoxelModel(model));
    for (const offset of [1, 16]) {
      const storage = new Uint8Array(expected.length + offset + 8).fill(0xa5);
      const packed = writeVoxelModel(model, (bytes) =>
        storage.subarray(offset, offset + bytes)
      );
      expect(packed.length).toBe(expected.length);
      expect(packed.every((value, index) => value === expected[index])).toBe(
        true
      );
      expect(storage.subarray(0, offset).every((value) => value === 0xa5)).toBe(
        true
      );
      expect(
        storage
          .subarray(offset + expected.length)
          .every((value) => value === 0xa5)
      ).toBe(true);
    }
  });
  it('RENDERER_CONFIG matches config.rs', () => {
    const rust = rustConstants('crates/voice-simulator-core/src/config.rs');
    expect(rust).toEqual({ ...RENDERER_CONFIG });
  });

  it('FRAME matches frame.rs', () => {
    const rust = rustConstants('crates/voice-simulator-core/src/frame.rs');
    expect(rust).toEqual({ ...FRAME, EXTRA_VALUES: FRAME_EXTRA_VALUES });
  });

  it('LISTENER matches listener.rs', () => {
    const rust = rustConstants('crates/voice-simulator-core/src/listener.rs');
    expect(rust).toEqual({ ...LISTENER });
  });

  it('SOURCE_STATE matches source_state.rs (issue 29)', () => {
    const rust = rustConstants(
      'crates/voice-simulator-core/src/source_state.rs'
    );
    expect(rust).toEqual({ ...SOURCE_STATE });
  });

  it('indices are distinct and the headers come last', () => {
    for (const [layout, header] of [
      [RENDERER_CONFIG, 'HEADER'],
      [FRAME, 'STRIDE'],
      [SOURCE_STATE, 'LENGTH'],
    ]) {
      const fields = Object.entries(layout).filter(
        ([name]) => name !== header && name !== 'AREAS'
      );
      const indices = fields.map(([, index]) => index).sort((a, b) => a - b);
      expect(indices).toEqual(indices.map((_, index) => index));
      expect(layout[header]).toBe(indices.length);
    }
  });

  it('writeFrame fills one frame', () => {
    const shape = {
      length: 16,
      velumArea: 0.2,
      velumIndex: 9,
      areas: [1, 2, 3],
      frication: {
        index: 1,
        position: 2,
        area: 2,
        gain: 0.5,
        sibilance: 0.1,
        obstacle: 0.7,
      },
      glottis: { f0: 110, voicing: 1, aspiration: 0, closure: 0, loudness: 1 },
    };
    const frame = new Float64Array(frameStride(3) + 1).fill(-1);
    expect(frameStride(3)).toBe(FRAME.STRIDE + 3 + FRAME_EXTRA_VALUES);
    writeFrame(frame, 1, shape, 800);
    expect(frame[1 + FRAME.LENGTH]).toBe(16);
    expect(frame[1 + FRAME.FRICATION_OBSTACLE]).toBe(0.7);
    expect(frame[1 + FRAME.LUNG_PRESSURE]).toBe(800);
    expect(frame[1 + FRAME.TEETH]).toBe(0);
    expect(frame[1 + FRAME.EXTRA]).toBe(FRAME_EXTRA_VALUES);
    expect([...frame.subarray(1 + FRAME.AREAS)]).toEqual([1, 2, 3, 0]);
    writeFrame(frame, 1, { ...shape, teeth: { gap: 0.4 } }, 800);
    expect(frame[1 + FRAME.TEETH]).toBe(1);
    expect(frame.at(-1)).toBe(0.4);
  });

  it('listenerValues serializes the microphone and the room', () => {
    expect([...listenerValues(null)]).toEqual([]);
    const listener = createListener({
      microphone: { distance: 30, azimuth: 120 },
      room: 'studio',
      solver: {},
      sampleRate: 48000,
    });
    const [microphone, room] = listener.stages;
    const values = listenerValues(listener);
    const taps = room.tapDelays.length;
    expect(values.length).toBe(
      1 + LISTENER.MICROPHONE_VALUES + LISTENER.ROOM_VALUES + 2 * taps
    );
    expect(values[0]).toBe(2);
    expect([...values.subarray(1, 1 + LISTENER.MICROPHONE_VALUES)]).toEqual([
      LISTENER.MICROPHONE,
      microphone.gain,
      microphone.delay,
      microphone.fraction,
      microphone.size,
      1,
      microphone.lowGain,
      microphone.highGain,
      microphone.smoothing,
    ]);
    const start = 1 + LISTENER.MICROPHONE_VALUES;
    expect(values[start]).toBe(LISTENER.ROOM);
    expect(values[start + 4]).toBe(taps);
    expect(values.at(-1)).toBe(room.tapGains.at(-1));
    expect(listenerValues({ stages: [{ process: (value) => value }] })).toBe(
      null
    );
  });
});
