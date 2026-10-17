/**
 * Minimal WAV encoding (16-bit PCM, mono or interleaved) and decoding (PCM
 * or float recordings).
 */

/**
 * WAV header for a PCM stream. With `dataLength` unknown (streaming), the
 * maximum size is written, which players treat as "until end of stream".
 * @param {number} sampleRate
 * @param {number} [dataLength] Bytes of PCM data.
 * @param {number} [channels]
 */
export function wavHeader(
  sampleRate,
  dataLength = 0xffffffff - 36,
  channels = 1
) {
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const writeText = (offset, text) => {
    for (let index = 0; index < text.length; index++) {
      header[offset + index] = text.charCodeAt(index);
    }
  };
  writeText(0, 'RIFF');
  view.setUint32(4, Math.min(0xffffffff, 36 + dataLength), true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, dataLength, true);
  return header;
}

/**
 * Convert float samples in [-1, 1] to little-endian 16-bit PCM bytes.
 * @param {ArrayLike<number>} samples
 */
export function floatToPcm16(samples) {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index++) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(index * 2, Math.round(value * 32767), true);
  }
  return bytes;
}

/**
 * Encode a complete WAV file.
 * @param {ArrayLike<number>} samples
 * @param {number} sampleRate
 * @returns {Uint8Array}
 */
export function encodeWav(samples, sampleRate) {
  const pcm = floatToPcm16(samples);
  const file = new Uint8Array(44 + pcm.length);
  file.set(wavHeader(sampleRate, pcm.length), 0);
  file.set(pcm, 44);
  return file;
}

const PCM = 1;
const FLOAT = 3;
const EXTENSIBLE = 0xfffe;

function sampleReader(view, format, bits) {
  if (format === FLOAT && bits === 32) {
    return (offset) => view.getFloat32(offset, true);
  }
  if (format === FLOAT && bits === 64) {
    return (offset) => view.getFloat64(offset, true);
  }
  if (format !== PCM) {
    throw new Error(`Unsupported WAV format ${format}`);
  }
  switch (bits) {
    case 8:
      return (offset) => (view.getUint8(offset) - 128) / 128;
    case 16:
      return (offset) => view.getInt16(offset, true) / 32768;
    case 24:
      return (offset) =>
        ((view.getInt8(offset + 2) << 16) | view.getUint16(offset, true)) /
        8388608;
    case 32:
      return (offset) => view.getInt32(offset, true) / 2147483648;
    default:
      throw new Error(`Unsupported WAV sample size ${bits}`);
  }
}

/**
 * Decode a WAV file (first channel only): 8, 16, 24 or 32-bit PCM and
 * 32 or 64-bit float, with any chunks around `fmt ` and `data`.
 * @param {Uint8Array} bytes
 * @returns {{sampleRate: number, samples: Float32Array}}
 */
export function decodeWav(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let fmt = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ') {
      let format = view.getUint16(offset + 8, true);
      if (format === EXTENSIBLE && size >= 26) {
        format = view.getUint16(offset + 32, true);
      }
      fmt = {
        format,
        channels: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        bits: view.getUint16(offset + 22, true),
      };
    } else if (id === 'data') {
      if (!fmt) {
        throw new Error('WAV file has no fmt chunk before the data');
      }
      const read = sampleReader(view, fmt.format, fmt.bits);
      const frame = (fmt.channels * fmt.bits) / 8;
      const length = Math.min(size, bytes.length - offset - 8);
      const samples = new Float32Array(Math.floor(length / frame));
      for (let index = 0; index < samples.length; index++) {
        samples[index] = read(offset + 8 + index * frame);
      }
      return { sampleRate: fmt.sampleRate, samples };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('WAV file has no data chunk');
}
