/**
 * The layouts of src/engine/layout.js and the Rust constants agree (issue
 * 22): the names and indices of RENDERER_CONFIG are those of
 * crates/voice-simulator-core/src/config.rs, the ones of FRAME those of
 * frame.rs. Compared as text, so no Rust build is needed.
 */

import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'test-anywhere';

import {
  FRAME,
  RENDERER_CONFIG,
  frameStride,
  writeFrame,
} from '../src/engine/layout.js';

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
  it('RENDERER_CONFIG matches config.rs', () => {
    const rust = rustConstants('crates/voice-simulator-core/src/config.rs');
    expect(rust).toEqual({ ...RENDERER_CONFIG });
  });

  it('FRAME matches frame.rs', () => {
    const rust = rustConstants('crates/voice-simulator-core/src/frame.rs');
    expect(rust).toEqual({ ...FRAME });
  });

  it('indices are distinct and the headers come last', () => {
    for (const [layout, header] of [
      [RENDERER_CONFIG, 'HEADER'],
      [FRAME, 'STRIDE'],
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
    writeFrame(frame, 1, shape, 800);
    expect(frame[1 + FRAME.LENGTH]).toBe(16);
    expect(frame[1 + FRAME.FRICATION_OBSTACLE]).toBe(0.7);
    expect(frame[1 + FRAME.LUNG_PRESSURE]).toBe(800);
    expect(frame[1 + FRAME.RESERVED]).toBe(0);
    expect([...frame.subarray(1 + FRAME.AREAS)]).toEqual([1, 2, 3]);
  });
});
