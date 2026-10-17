/**
 * WAV (RIFF WAVE) encoding and decoding.
 *
 * Writes integer PCM (8/16/24/32-bit), IEEE float (32/64-bit) and
 * WAVE_FORMAT_EXTENSIBLE headers (used for more than two channels or more
 * than 16 bits, as Microsoft recommends). Reads any chunk order with odd
 * chunk padding, PCM, float, G.711 mu-law / A-law and extensible files,
 * mixing every channel down to mono.
 */

import {
  decodeSamples,
  encodeSamples,
  readTag,
  sampleFormat,
  toChannels,
  writeSample,
  writeTag,
} from './pcm.js';

const FORMAT_PCM = 1;
const FORMAT_FLOAT = 3;
const FORMAT_ALAW = 6;
const FORMAT_MULAW = 7;
const FORMAT_EXTENSIBLE = 0xfffe;
/** Tail of the KSDATAFORMAT_SUBTYPE GUIDs; the first two bytes are the tag. */
const GUID_TAIL = [
  0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b,
  0x71,
];

function channelMask(channels) {
  if (channels === 1) {
    return 0x4;
  }
  return channels >= 32 ? 0xffffffff : 2 ** channels - 1;
}

/**
 * WAV header. With `dataLength` unknown (streaming), the maximum size is
 * written, which players treat as "until end of stream".
 * @param {number} sampleRate
 * @param {number} [dataLength] Bytes of sample data.
 * @param {number} [channels]
 * @param {{bitDepth?: number, float?: boolean}} [options]
 */
export function wavHeader(
  sampleRate,
  dataLength = 0xffffffff - 36,
  channels = 1,
  options = {}
) {
  const { bitDepth, float } = sampleFormat(options);
  const extensible = !float && (channels > 2 || bitDepth > 16);
  const fmtSize = extensible ? 40 : float ? 18 : 16;
  const factSize = float ? 12 : 0;
  const size = 12 + 8 + fmtSize + factSize + 8;
  const header = new Uint8Array(size);
  const view = new DataView(header.buffer);
  const blockAlign = (channels * bitDepth) / 8;
  writeTag(header, 0, 'RIFF');
  view.setUint32(4, Math.min(0xffffffff, size - 8 + dataLength), true);
  writeTag(header, 8, 'WAVE');
  writeTag(header, 12, 'fmt ');
  view.setUint32(16, fmtSize, true);
  const tag = extensible
    ? FORMAT_EXTENSIBLE
    : float
      ? FORMAT_FLOAT
      : FORMAT_PCM;
  view.setUint16(20, tag, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  let offset = 36;
  if (fmtSize > 16) {
    view.setUint16(36, fmtSize - 18, true);
    offset = 38;
  }
  if (extensible) {
    view.setUint16(38, bitDepth, true);
    view.setUint32(40, channelMask(channels), true);
    view.setUint16(44, FORMAT_PCM, true);
    header.set(GUID_TAIL, 46);
    offset = 60;
  }
  if (factSize) {
    writeTag(header, offset, 'fact');
    view.setUint32(offset + 4, 4, true);
    const frames = Math.floor(dataLength / blockAlign);
    view.setUint32(offset + 8, Math.min(0xffffffff, frames), true);
    offset += 12;
  }
  writeTag(header, offset, 'data');
  view.setUint32(offset + 4, Math.min(0xffffffff, dataLength), true);
  return header;
}

/**
 * Convert float samples in [-1, 1] to little-endian 16-bit PCM bytes.
 * @param {ArrayLike<number>} samples
 */
export function floatToPcm16(samples) {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  const format = { bitDepth: 16, kind: 'int', little: true };
  for (let index = 0; index < samples.length; index++) {
    writeSample(view, index * 2, samples[index], format);
  }
  return bytes;
}

/** Byte-level sample format of a WAV file with the given options. */
export function wavSampleFormat(options = {}) {
  const { bitDepth, float } = sampleFormat(options);
  const kind = float ? 'float' : bitDepth === 8 ? 'uint8' : 'int';
  return { bitDepth, kind, little: true };
}

/**
 * Encode a complete WAV file.
 * @param {ArrayLike<number> | ArrayLike<number>[]} samples One channel or a list of channels.
 * @param {number} sampleRate
 * @param {{bitDepth?: number, float?: boolean}} [options] Default 16-bit PCM.
 * @returns {Uint8Array}
 */
export function encodeWav(samples, sampleRate, options = {}) {
  const channels = toChannels(samples);
  const data = encodeSamples(channels, wavSampleFormat(options));
  const header = wavHeader(sampleRate, data.length, channels.length, options);
  const padded = data.length % 2;
  const file = new Uint8Array(header.length + data.length + padded);
  file.set(header, 0);
  file.set(data, header.length);
  return file;
}

function decodeFormat(view, offset, size) {
  let tag = view.getUint16(offset, true);
  const bitDepth = view.getUint16(offset + 14, true);
  if (tag === FORMAT_EXTENSIBLE && size >= 40) {
    tag = view.getUint16(offset + 24, true);
  }
  const kinds = {
    [FORMAT_PCM]: bitDepth === 8 ? 'uint8' : 'int',
    [FORMAT_FLOAT]: 'float',
    [FORMAT_ALAW]: 'alaw',
    [FORMAT_MULAW]: 'mulaw',
  };
  const kind = kinds[tag];
  const supported =
    kind === 'float'
      ? bitDepth === 32 || bitDepth === 64
      : kind === 'alaw' || kind === 'mulaw'
        ? bitDepth === 8
        : [8, 16, 24, 32].includes(bitDepth);
  if (!kind || !supported) {
    throw new Error(`Unsupported WAV encoding ${tag} with ${bitDepth} bits`);
  }
  return {
    channels: view.getUint16(offset + 2, true),
    sampleRate: view.getUint32(offset + 4, true),
    blockAlign: view.getUint16(offset + 12, true),
    format: { bitDepth, kind, little: true },
  };
}

/**
 * Decode a WAV file to mono floats (all channels are averaged).
 * @param {Uint8Array} bytes
 * @returns {{sampleRate: number, samples: Float32Array, channels: number, bitDepth: number, float: boolean}}
 */
export function decodeWav(bytes) {
  if (readTag(bytes, 0) !== 'RIFF' || readTag(bytes, 8) !== 'WAVE') {
    throw new Error('Not a WAV file');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let fmt = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = readTag(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      fmt = decodeFormat(view, body, size);
    } else if (id === 'data') {
      if (!fmt) {
        throw new Error('WAV data chunk before the fmt chunk');
      }
      const length = Math.min(size, bytes.length - body);
      const { channels, sampleRate, format } = fmt;
      return {
        sampleRate,
        samples: decodeSamples(bytes, body, length, channels, format),
        channels,
        bitDepth: format.bitDepth,
        float: format.kind === 'float',
      };
    }
    // Chunks are padded to an even size.
    offset = body + size + (size % 2);
  }
  throw new Error('WAV file has no data chunk');
}
