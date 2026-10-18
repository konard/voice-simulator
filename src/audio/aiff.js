/**
 * AIFF and AIFF-C encoding and decoding (big-endian, Apple).
 *
 * Integer PCM is written as plain AIFF; float samples as AIFF-C with the
 * 'fl32' / 'fl64' compression types. The reader also accepts 'NONE',
 * 'sowt' (little-endian PCM), 'FL32' / 'FL64', 'ulaw' and 'alaw'.
 */

import {
  decodeSamples,
  encodeSamples,
  readTag,
  sampleFormat,
  toChannels,
  writeTag,
} from './pcm.js';

/** AIFF-C version 1 timestamp required in the FVER chunk. */
const AIFC_VERSION = 0xa2805140;

/**
 * Write an 80-bit IEEE 754 extended float (used for the sample rate).
 * @param {DataView} view
 * @param {number} offset
 * @param {number} value Positive number below 2^32.
 */
export function writeExtended(view, offset, value) {
  if (!(value > 0)) {
    for (let index = 0; index < 10; index++) {
      view.setUint8(offset + index, 0);
    }
    return;
  }
  const exponent = Math.floor(Math.log2(value));
  const mantissa = value / 2 ** exponent;
  // mantissa is in [1, 2): split its 64 bits into two 32-bit halves.
  const high = Math.floor(mantissa * 2 ** 31);
  const low = Math.round((mantissa * 2 ** 31 - high) * 2 ** 32);
  view.setUint16(offset, 16383 + exponent);
  view.setUint32(offset + 2, high);
  view.setUint32(offset + 6, Math.min(0xffffffff, low));
}

/** Read an 80-bit IEEE 754 extended float. */
export function readExtended(view, offset) {
  const exponent = view.getUint16(offset) & 0x7fff;
  const high = view.getUint32(offset + 2);
  const low = view.getUint32(offset + 6);
  if (exponent === 0 && high === 0 && low === 0) {
    return 0;
  }
  const sign = view.getUint16(offset) & 0x8000 ? -1 : 1;
  return sign * (high * 2 ** 32 + low) * 2 ** (exponent - 16383 - 63);
}

/**
 * Encode an AIFF (integer) or AIFF-C (float) file.
 * @param {ArrayLike<number> | ArrayLike<number>[]} samples One channel or a list of channels.
 * @param {number} sampleRate
 * @param {{bitDepth?: number, float?: boolean}} [options]
 * @returns {Uint8Array}
 */
export function encodeAiff(samples, sampleRate, options = {}) {
  const { bitDepth, float } = sampleFormat(options);
  const channels = toChannels(samples);
  const data = encodeSamples(channels, {
    bitDepth,
    kind: float ? 'float' : 'int',
    little: false,
  });
  const compression = float ? `fl${bitDepth}` : null;
  const commSize = compression ? 18 + 4 + 2 : 18;
  const fverSize = compression ? 12 : 0;
  const ssndSize = 8 + data.length;
  const total = 12 + fverSize + 8 + commSize + 8 + ssndSize + (ssndSize % 2);
  const file = new Uint8Array(total);
  const view = new DataView(file.buffer);
  writeTag(file, 0, 'FORM');
  view.setUint32(4, total - 8);
  writeTag(file, 8, compression ? 'AIFC' : 'AIFF');
  let offset = 12;
  if (compression) {
    writeTag(file, offset, 'FVER');
    view.setUint32(offset + 4, 4);
    view.setUint32(offset + 8, AIFC_VERSION);
    offset += 12;
  }
  writeTag(file, offset, 'COMM');
  view.setUint32(offset + 4, commSize);
  view.setUint16(offset + 8, channels.length);
  view.setUint32(offset + 10, channels[0].length);
  view.setUint16(offset + 14, bitDepth);
  writeExtended(view, offset + 16, sampleRate);
  if (compression) {
    writeTag(file, offset + 26, compression);
    // Empty Pascal string padded to an even length.
    view.setUint16(offset + 30, 0);
  }
  offset += 8 + commSize;
  writeTag(file, offset, 'SSND');
  view.setUint32(offset + 4, ssndSize);
  file.set(data, offset + 16);
  return file;
}

function compressionFormat(type, bitDepth) {
  const formats = {
    NONE: { bitDepth, kind: 'int', little: false },
    twos: { bitDepth, kind: 'int', little: false },
    sowt: { bitDepth, kind: 'int', little: true },
    fl32: { bitDepth: 32, kind: 'float', little: false },
    FL32: { bitDepth: 32, kind: 'float', little: false },
    fl64: { bitDepth: 64, kind: 'float', little: false },
    FL64: { bitDepth: 64, kind: 'float', little: false },
    ulaw: { bitDepth: 8, kind: 'mulaw', little: false },
    ULAW: { bitDepth: 8, kind: 'mulaw', little: false },
    alaw: { bitDepth: 8, kind: 'alaw', little: false },
    ALAW: { bitDepth: 8, kind: 'alaw', little: false },
  };
  const format = formats[type];
  if (!format) {
    throw new Error(`Unsupported AIFF-C compression ${type}`);
  }
  if (format.kind === 'int' && ![8, 16, 24, 32].includes(bitDepth)) {
    throw new Error(`Unsupported AIFF bit depth ${bitDepth}`);
  }
  return format;
}

/**
 * Decode an AIFF or AIFF-C file to mono floats.
 * @param {Uint8Array} bytes
 * @returns {{sampleRate: number, samples: Float32Array, channels: number, bitDepth: number, float: boolean}}
 */
export function decodeAiff(bytes) {
  const kind = readTag(bytes, 8);
  if (readTag(bytes, 0) !== 'FORM' || (kind !== 'AIFF' && kind !== 'AIFC')) {
    throw new Error('Not an AIFF file');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let comm = null;
  let sound = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = readTag(bytes, offset);
    const size = view.getUint32(offset + 4);
    const body = offset + 8;
    if (id === 'COMM') {
      const bitDepth = view.getUint16(body + 6);
      const type = kind === 'AIFC' ? readTag(bytes, body + 18) : 'NONE';
      comm = {
        channels: view.getUint16(body),
        frames: view.getUint32(body + 2),
        sampleRate: readExtended(view, body + 8),
        format: compressionFormat(type, bitDepth),
      };
    } else if (id === 'SSND') {
      const start = body + 8 + view.getUint32(body);
      sound = { start, length: Math.min(size - 8, bytes.length - start) };
    }
    offset = body + size + (size % 2);
  }
  if (!comm || !sound) {
    throw new Error('AIFF file needs COMM and SSND chunks');
  }
  const { channels, format, frames } = comm;
  const length = Math.min(
    sound.length,
    (frames * channels * format.bitDepth) / 8
  );
  return {
    sampleRate: comm.sampleRate,
    samples: decodeSamples(bytes, sound.start, length, channels, format),
    channels,
    bitDepth: format.bitDepth,
    float: format.kind === 'float',
  };
}
