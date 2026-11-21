/** Optional precomputed oral features for the default recognition geometry. Unlicense. */
import { DEFAULT_HEAD } from '../head-config.js';

export const oralTableVersion = 1;
export const oralTableMinLength = 11;
export const oralTableMaxLength = 20;
export const oralTableCount = 1 + 2 * (oralTableMaxLength - oralTableMinLength);
export const oralEnvelopeWidth = 24;
export const oralFormantWidth = 8;
export const oralRowBytes = (oralEnvelopeWidth + oralFormantWidth) * 8;
export const oralTableFile = () =>
  new globalThis.URL(
    '../engine/voice-simulator-oral-codebook.bin',
    import.meta.url
  );

// These voice-fit parameters do not affect the oral tube geometry. Require
// every other head parameter to match the geometry used to build the table.
const independent = new Set([
  'breathiness',
  'jitter',
  'pitch',
  'pitchRange',
  'shimmer',
  'speechRate',
  'tenseness',
  'vocalTractLength',
]);
let openTable;

export function installOralCodebookReader(read) {
  openTable = read;
}

/** Each row stores the normalized envelope followed by frequency and bandwidth. */
export function openOralFeatureRows(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return (index, envelope, formants) => {
    let offset = index * oralRowBytes;
    if (
      offset + oralRowBytes > view.byteLength ||
      Number.isNaN(view.getFloat64(offset, true))
    ) {
      return false;
    }
    for (let i = 0; i < oralEnvelopeWidth; i++, offset += 8) {
      envelope[i] = view.getFloat64(offset, true);
    }
    for (let i = 0; i < oralFormantWidth; i++, offset += 8) {
      formants[i] = view.getFloat64(offset, true);
    }
    return true;
  };
}

export function preparedOralRows(head, seed, size) {
  if (
    openTable &&
    seed === 1 &&
    size === 256 &&
    Object.keys(head).every(
      (key) => independent.has(key) || head[key] === DEFAULT_HEAD[key]
    )
  ) {
    return openTable(head.vocalTractLength);
  }
}
