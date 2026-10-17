/**
 * Minimal 16-bit PCM WAV encoding/decoding (mono or interleaved).
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

/**
 * Decode a 16-bit PCM WAV file (first channel only).
 * @param {Uint8Array} bytes
 * @returns {{sampleRate: number, samples: Float32Array}}
 */
export function decodeWav(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    if (id === 'data') {
      const length = Math.min(size, bytes.length - offset - 8);
      const count = Math.floor(length / (2 * channels));
      const samples = new Float32Array(count);
      for (let index = 0; index < count; index++) {
        samples[index] =
          view.getInt16(offset + 8 + index * 2 * channels, true) / 32768;
      }
      return { sampleRate, samples };
    }
    offset += 8 + size;
  }
  throw new Error('WAV file has no data chunk');
}
