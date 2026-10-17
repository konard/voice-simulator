/**
 * decodeWav reads the WAV files that recorders write: 8 to 32-bit PCM,
 * float samples, the extensible format and extra chunks before the data.
 */

import { describe, it, expect } from 'test-anywhere';
import { decodeWav } from '../src/audio/wav.js';

const VALUES = [0, 0.5, -0.5, 0.25];

function writers(view) {
  return {
    8: (offset, value) => view.setUint8(offset, Math.round(value * 128) + 128),
    16: (offset, value) => view.setInt16(offset, value * 32768, true),
    24: (offset, value) => {
      const integer = Math.round(value * 8388608);
      view.setUint16(offset, integer & 0xffff, true);
      view.setInt8(offset + 2, integer >> 16);
    },
    32: (offset, value) => view.setInt32(offset, value * 2147483648, true),
    float32: (offset, value) => view.setFloat32(offset, value, true),
    float64: (offset, value) => view.setFloat64(offset, value, true),
  };
}

/**
 * A stereo WAV whose second channel is silent, with a LIST chunk of odd
 * size (padded) before `fmt `.
 */
function makeWav({ format, bits, kind, extensible = false }) {
  const channels = 2;
  const frame = (channels * bits) / 8;
  const fmtSize = extensible ? 40 : 16;
  const listSize = 5;
  const dataSize = VALUES.length * frame;
  const total = 12 + 8 + listSize + 1 + 8 + fmtSize + 8 + dataSize;
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  const text = (offset, value) =>
    [...value].forEach((char, index) => {
      bytes[offset + index] = char.charCodeAt(0);
    });
  text(0, 'RIFF');
  view.setUint32(4, total - 8, true);
  text(8, 'WAVE');
  text(12, 'LIST');
  view.setUint32(16, listSize, true);
  let offset = 20 + listSize + 1;
  text(offset, 'fmt ');
  view.setUint32(offset + 4, fmtSize, true);
  view.setUint16(offset + 8, extensible ? 0xfffe : format, true);
  view.setUint16(offset + 10, channels, true);
  view.setUint32(offset + 12, 8000, true);
  view.setUint32(offset + 16, 8000 * frame, true);
  view.setUint16(offset + 20, frame, true);
  view.setUint16(offset + 22, bits, true);
  if (extensible) {
    view.setUint16(offset + 24, 22, true);
    view.setUint16(offset + 32, format, true);
  }
  offset += 8 + fmtSize;
  text(offset, 'data');
  view.setUint32(offset + 4, dataSize, true);
  const write = writers(view)[kind];
  VALUES.forEach((value, index) => write(offset + 8 + index * frame, value));
  return bytes;
}

describe('decodeWav formats', () => {
  const cases = [
    { name: '8-bit PCM', format: 1, bits: 8, kind: 8 },
    { name: '16-bit PCM', format: 1, bits: 16, kind: 16 },
    { name: '24-bit PCM', format: 1, bits: 24, kind: 24 },
    { name: '32-bit PCM', format: 1, bits: 32, kind: 32 },
    { name: '32-bit float', format: 3, bits: 32, kind: 'float32' },
    { name: '64-bit float', format: 3, bits: 64, kind: 'float64' },
    {
      name: 'extensible 24-bit PCM',
      format: 1,
      bits: 24,
      kind: 24,
      extensible: true,
    },
  ];
  for (const wav of cases) {
    it(`reads the first channel of ${wav.name}`, () => {
      const { sampleRate, samples } = decodeWav(makeWav(wav));
      expect(sampleRate).toBe(8000);
      expect(samples.length).toBe(VALUES.length);
      VALUES.forEach((value, index) => {
        expect(Math.abs(samples[index] - value)).toBeLessThan(0.01);
      });
    });
  }

  it('rejects compressed WAV files', () => {
    expect(() =>
      decodeWav(makeWav({ format: 2, bits: 16, kind: 16 }))
    ).toThrow();
  });
});
