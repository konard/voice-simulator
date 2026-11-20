/** Whisper acoustics for the same tract rows as the voiced codebook. Unlicense. */
import {
  CODEBOOK_CHANNELS,
  GRID,
  L0,
  RESPONSE_GRID,
  envelopeKey,
  interpolateResponse,
  normalizeEnvelope,
  renderedResponse,
  responseFormants,
} from './codebook-features.js';
import { attachQuery, buildTree } from './codebook-search.js';

const cache = new WeakMap();

function fillRow(book, row, head, { response, grid, envelope, key, formants }) {
  const state = { whisper: 1 };
  CODEBOOK_CHANNELS.forEach(({ name, min, max }, i) => {
    state[name] = min + (book.articulation[row * 12 + i] * (max - min)) / 255;
  });
  renderedResponse(state, head, response, grid);
  responseFormants(response, formants);
  for (let i = 0; i < 8; i++) {
    book.formants[row * 8 + i] = Math.round(
      (formants[i] * L0) / head.vocalTractLength
    );
  }
  for (let i = 0; i < 24; i++) {
    envelope[i] = interpolateResponse(response, GRID[i]);
  }
  normalizeEnvelope(envelope);
  for (let i = 0; i < 24; i++) {
    const quantized = Math.max(
      0,
      Math.min(255, Math.round((envelope[i] + 64) * 2))
    );
    book.envelope[row * 24 + i] = quantized;
    envelope[i] = quantized * 0.5 - 64;
  }
  envelopeKey(envelope, key);
  book.key.set(key, row * 6);
}

/** Called on the first whispered speech frame. Tract indices stay comparable. */
export function whisperCodebook(voiced, voice) {
  const length = voiced.referenceLength;
  const head = { ...voice, vocalTractLength: length };
  const identity = JSON.stringify(head);
  const saved = cache.get(voiced);
  if (saved?.identity === identity) {
    return saved.book;
  }
  const size = voiced.articulation.length / CODEBOOK_CHANNELS.length;
  const book = {
    ...voiced,
    formants: new Int16Array(size * 8),
    envelope: new Uint8Array(size * 24),
    key: new Float32Array(size * 6),
  };
  const scratch = {
    response: new Float64Array(RESPONSE_GRID.length),
    grid: Float64Array.from(RESPONSE_GRID, (f) => (f * L0) / length),
    envelope: new Float64Array(24),
    key: new Float64Array(6),
    formants: new Float64Array(8),
  };
  for (let row = 0; row < size; row++) {
    fillRow(book, row, head, scratch);
  }
  book.tree = buildTree(book.key, size);
  attachQuery(book);
  cache.set(voiced, { identity, book });
  return book;
}
