/** Generate oral features of the default head for recognition. Unlicense. */
import { Buffer } from 'node:buffer';
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tractShape } from '../src/articulation/tract-shape.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import {
  oralEnvelopeWidth,
  oralFormantWidth,
  oralRowBytes,
  oralTableCount,
  oralTableFile,
  oralTableMinLength,
  oralTableVersion,
} from '../src/recognition/codebook-data.js';
import {
  createTractResponse,
  GRID,
  interpolateResponse,
  L0,
  normalizeEnvelope,
  RESPONSE_GRID,
  responseFormants,
} from '../src/recognition/codebook-features.js';
import {
  codebookSeeds,
  proposeRow,
} from '../src/recognition/codebook-seeds.js';

export function generateOralFeatureRows(vocalTractLength, states) {
  const head = { ...DEFAULT_HEAD, vocalTractLength };
  const frequencies = Float64Array.from(
    RESPONSE_GRID,
    (frequency) => frequency * (L0 / vocalTractLength)
  );
  const oral = createTractResponse(frequencies);
  const response = new Float64Array(frequencies.length);
  const envelope = new Float64Array(oralEnvelopeWidth);
  const formants = new Float64Array(oralFormantWidth);
  const buffer = Buffer.alloc(states.length * oralRowBytes);
  for (let row = 0; row < states.length; row++) {
    const state = states[row];
    let offset = row * oralRowBytes;
    if (state.velum >= 0.1) {
      buffer.writeDoubleLE(NaN, offset);
      continue;
    }
    const { areas, length } = tractShape(state, head);
    oral(areas, length, response);
    for (let bin = 0; bin < envelope.length; bin++) {
      envelope[bin] = interpolateResponse(response, GRID[bin]);
    }
    normalizeEnvelope(envelope);
    responseFormants(response, formants);
    for (const values of [envelope, formants]) {
      for (const value of values) {
        offset = buffer.writeDoubleLE(value, offset);
      }
    }
  }
  return buffer;
}

export function buildRecognitionCodebook() {
  const seeds = codebookSeeds();
  const states = Array.from(
    { length: 512 },
    (_, index) => (seeds[index] ?? proposeRow(seeds, 1, index)).state
  );
  const header = Buffer.alloc(4 * (oralTableCount + 2));
  header.writeUInt32LE(oralTableVersion, 0);
  const records = [header];
  let offset = header.length;
  for (let index = 0; index < oralTableCount; index++) {
    header.writeUInt32LE(offset, 4 * (index + 1));
    const rows = gzipSync(
      generateOralFeatureRows(oralTableMinLength + index * 0.5, states)
    );
    records.push(rows);
    offset += rows.length;
  }
  header.writeUInt32LE(offset, 4 * (oralTableCount + 1));
  const file = oralTableFile();
  writeFileSync(file, Buffer.concat(records, offset));
  console.log(`${file.pathname.split('/').at(-1)}: ${offset} bytes`);
}
