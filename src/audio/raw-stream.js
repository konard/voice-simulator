/** Decode little-endian mono PCM when a sample can straddle two input chunks. */
import { decodeRaw } from './formats.js';
import { sampleFormat } from './pcm.js';

export function createRawDecoder(options) {
  const { bitDepth, float } = sampleFormat(options);
  const format = { bitDepth, float };
  const width = bitDepth / 8;
  let tail = new Uint8Array();
  return {
    push(chunk) {
      if (tail.length) {
        const bytes = new Uint8Array(tail.length + chunk.length);
        bytes.set(tail);
        bytes.set(chunk, tail.length);
        chunk = bytes;
      }
      const aligned = chunk.length - (chunk.length % width);
      tail = Uint8Array.from(chunk.subarray(aligned));
      return decodeRaw(chunk.subarray(0, aligned), format).samples;
    },
    flush() {
      if (tail.length) {
        throw new RangeError('Raw audio ends with an incomplete PCM sample');
      }
    },
  };
}
