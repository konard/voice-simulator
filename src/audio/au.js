/**
 * Sun/NeXT AU (.au, .snd) encoding and decoding (big-endian).
 *
 * AU allows an unknown data size (0xffffffff), so it can be streamed like
 * the open-ended WAV header.
 */

import {
  decodeSamples,
  encodeSamples,
  readTag,
  sampleFormat,
  toChannels,
  writeTag,
} from './pcm.js';

const HEADER_SIZE = 24;
const UNKNOWN_SIZE = 0xffffffff;
const ENCODINGS = Object.freeze({
  1: { bitDepth: 8, kind: 'mulaw' },
  2: { bitDepth: 8, kind: 'int' },
  3: { bitDepth: 16, kind: 'int' },
  4: { bitDepth: 24, kind: 'int' },
  5: { bitDepth: 32, kind: 'int' },
  6: { bitDepth: 32, kind: 'float' },
  7: { bitDepth: 64, kind: 'float' },
  27: { bitDepth: 8, kind: 'alaw' },
});

function encodingCode(bitDepth, float) {
  if (float) {
    return bitDepth === 64 ? 7 : 6;
  }
  return { 8: 2, 16: 3, 24: 4, 32: 5 }[bitDepth];
}

/**
 * AU header. Without `dataLength` the size is "unknown" (streaming).
 * @param {number} sampleRate
 * @param {number} [dataLength]
 * @param {number} [channels]
 * @param {{bitDepth?: number, float?: boolean}} [options]
 */
export function auHeader(
  sampleRate,
  dataLength = UNKNOWN_SIZE,
  channels = 1,
  options = {}
) {
  const { bitDepth, float } = sampleFormat(options);
  const header = new Uint8Array(HEADER_SIZE);
  const view = new DataView(header.buffer);
  writeTag(header, 0, '.snd');
  view.setUint32(4, HEADER_SIZE);
  view.setUint32(8, Math.min(UNKNOWN_SIZE, dataLength));
  view.setUint32(12, encodingCode(bitDepth, float));
  view.setUint32(16, sampleRate);
  view.setUint32(20, channels);
  return header;
}

/** Byte-level sample format of an AU file with the given options. */
export function auSampleFormat(options = {}) {
  const { bitDepth, float } = sampleFormat(options);
  return { bitDepth, kind: float ? 'float' : 'int', little: false };
}

/**
 * Encode an AU file.
 * @param {ArrayLike<number> | ArrayLike<number>[]} samples One channel or a list of channels.
 * @param {number} sampleRate
 * @param {{bitDepth?: number, float?: boolean}} [options]
 * @returns {Uint8Array}
 */
export function encodeAu(samples, sampleRate, options = {}) {
  const channels = toChannels(samples);
  const data = encodeSamples(channels, auSampleFormat(options));
  const header = auHeader(sampleRate, data.length, channels.length, options);
  const file = new Uint8Array(header.length + data.length);
  file.set(header, 0);
  file.set(data, header.length);
  return file;
}

/**
 * Decode an AU file to mono floats.
 * @param {Uint8Array} bytes
 * @returns {{sampleRate: number, samples: Float32Array, channels: number, bitDepth: number, float: boolean}}
 */
export function decodeAu(bytes) {
  if (readTag(bytes, 0) !== '.snd') {
    throw new Error('Not an AU file');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = view.getUint32(4);
  const size = view.getUint32(8);
  const code = view.getUint32(12);
  const encoding = ENCODINGS[code];
  if (!encoding) {
    throw new Error(`Unsupported AU encoding ${code}`);
  }
  const channels = view.getUint32(20);
  const available = bytes.length - start;
  const length = size === UNKNOWN_SIZE ? available : Math.min(size, available);
  const format = { ...encoding, little: false };
  return {
    sampleRate: view.getUint32(16),
    samples: decodeSamples(bytes, start, length, channels, format),
    channels,
    bitDepth: encoding.bitDepth,
    float: encoding.kind === 'float',
  };
}
