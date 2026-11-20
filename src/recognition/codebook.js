/**
 * Inverse lookup of the forward simulator, made on first use (issue 64).
 * The recognition path can reuse the existing scalar waveguide renderer.
 */
import { normalizeHeadConfig } from '../head-config.js';
import { hashSeed } from '../random.js';
import { tractShape } from '../articulation/tract-shape.js';
import { CHANNEL_DEFAULTS } from '../articulation/plan.js';
import { lpcLevel } from './lpc.js';
import {
  CODEBOOK_CHANNELS,
  GRID,
  L0,
  RESPONSE_GRID,
  createTractResponse,
  envelopeKey,
  interpolateResponse,
  normalizeEnvelope,
  renderedResponse,
  responseFormants,
  tractResponse,
} from './codebook-features.js';
import { codebookSeeds, proposeRow } from './codebook-seeds.js';
import { attachQuery, buildTree } from './codebook-search.js';
import {
  CODEBOOK_VERSION,
  ROW_KINDS,
  parseCodebook,
  serializeCodebook,
} from './codebook-codec.js';
export {
  CODEBOOK_CHANNELS,
  GRID,
  tractResponse,
  parseCodebook,
  serializeCodebook,
};

const memoryCache = new Map();

function nonUniqueShare(book) {
  const sorted = Array.from({ length: book.size }, (_, i) => i).sort(
    (a, b) => book.formants[a * 8] - book.formants[b * 8] || a - b
  );
  const marked = new Uint8Array(book.size);
  for (let p = 0; p < sorted.length; p++) {
    const a = sorted[p];
    for (let q = p + 1; q < sorted.length; q++) {
      const b = sorted[q];
      if (
        book.formants[b * 8] - book.formants[a * 8] >
        0.03 * book.formants[a * 8]
      ) {
        break;
      }
      if (marked[a] && marked[b]) {
        continue;
      }
      let close = true;
      for (let j = 1; j < 4; j++) {
        const x = book.formants[a * 8 + j],
          y = book.formants[b * 8 + j];
        if (Math.abs(x - y) > 0.03 * Math.min(x, y)) {
          close = false;
          break;
        }
      }
      if (!close) {
        continue;
      }
      for (let j = 0; j < 12; j++) {
        if (
          Math.abs(
            book.articulation[a * 12 + j] - book.articulation[b * 12 + j]
          ) >
          255 * 0.25
        ) {
          marked[a] = 1;
          marked[b] = 1;
          break;
        }
      }
    }
  }
  return marked.reduce((a, b) => a + b, 0) / book.size;
}

function duplicate(state, bucket, buckets, rawChannels, rawEnvelope, env) {
  for (
    let bin = Math.max(0, bucket - 1);
    bin <= Math.min(50, bucket + 1);
    bin++
  ) {
    for (const row of buckets[bin]) {
      let close = true;
      for (let j = 0; j < 12; j++) {
        const { name, min, max } = CODEBOOK_CHANNELS[j];
        if (
          Math.abs(state[name] - rawChannels[row * 12 + j]) >=
          0.02 * (max - min)
        ) {
          close = false;
          break;
        }
      }
      if (!close) {
        continue;
      }
      let squared = 0;
      for (let j = 0; j < 24; j++) {
        squared += (env[j] - rawEnvelope[row * 24 + j]) ** 2;
      }
      if (squared / 24 < 0.25) {
        return true;
      }
    }
  }
  return false;
}

/** Build or parse a deterministic table; length scaling is per returned view. */
// Row generation combines feature extraction, quantization and accounting.
/* eslint-disable max-statements, complexity */
export function buildCodebookWithRenderer(head, options, renderer) {
  const size = options.size ?? 20000,
    seed = options.seed ?? 1;
  if (
    !Number.isInteger(size) ||
    size < 1 ||
    size > 100000 ||
    !Number.isInteger(seed) ||
    !Number.isFinite(seed)
  ) {
    throw new RangeError(
      'Codebook size must be 1..100000 and seed a finite integer'
    );
  }
  const normalized = normalizeHeadConfig(head);
  const lengthScale = normalized.vocalTractLength / L0;
  // Cache geometry at half-centimetre intervals; losses are length dependent.
  const referenceLength = Math.round(normalized.vocalTractLength * 2) / 2;
  const canonical = { ...normalized, vocalTractLength: referenceLength };
  const frequencyScale = L0 / referenceLength;
  const responseGrid = Float64Array.from(
    RESPONSE_GRID,
    (f) => f * frequencyScale
  );
  // Every head field participates in identity to prevent stale acoustics.
  const id = hashSeed(
    JSON.stringify([
      CODEBOOK_VERSION,
      size,
      seed,
      ...Object.keys(canonical)
        .sort()
        .map((name) => [name, canonical[name]]),
    ])
  );
  const cache = renderer ? new Map() : (options.cache ?? memoryCache);
  const cached = cache.get(id);
  if (cached !== undefined) {
    const book = parseCodebook(cached);
    if (book.id !== id || book.size !== size) {
      throw new RangeError('Codebook cache identity mismatch');
    }
    book.lengthScale = lengthScale;
    return book;
  }
  const started = globalThis.performance.now();
  const rows = Object.fromEntries(ROW_KINDS.map((name) => [name, 0]));
  const book = {
    version: CODEBOOK_VERSION,
    id,
    size,
    lengthScale: 1,
    referenceLength,
    channels: CODEBOOK_CHANNELS,
    articulation: new Uint8Array(size * 12),
    formants: new Int16Array(size * 8),
    envelope: new Uint8Array(size * 24),
    key: new Float32Array(size * 6),
    phone: new Uint16Array(size),
    stats: { rows, nasalRows: 0, nonUniqueShare: 0, buildMilliseconds: 0 },
  };
  const seeds = codebookSeeds();
  const oralResponse = createTractResponse(responseGrid);
  const response = new Float64Array(RESPONSE_GRID.length),
    correction = new Float64Array(RESPONSE_GRID.length);
  const render = (state) =>
    renderedResponse(state, canonical, response, responseGrid, renderer);
  const env = new Float64Array(24),
    key = new Float64Array(6),
    formants = new Float64Array(8);
  const rawChannels = new Float64Array(size * 12),
    rawEnvelope = new Float64Array(size * 24);
  const buckets = Array.from({ length: 51 }, () => []);
  let correctionReady = false,
    count = 0,
    proposal = 0;
  while (count < size) {
    if (proposal > size * 100 + seeds.length) {
      throw new Error('Could not fill codebook after bounded proposals');
    }
    const row =
      proposal < seeds.length
        ? seeds[proposal]
        : proposeRow(seeds, seed, proposal);
    proposal++;
    const nasal = row.state.velum >= 0.1;
    if (nasal && book.stats.nasalRows >= Math.floor(size / 10)) {
      continue;
    }
    if (nasal) {
      if (!correctionReady) {
        const neutral = tractShape(CHANNEL_DEFAULTS, canonical);
        oralResponse(neutral.areas, neutral.length, correction);
        render(CHANNEL_DEFAULTS);
        for (let j = 0; j < response.length; j++) {
          correction[j] = response[j] - correction[j];
        }
        correctionReady = true;
      }
      render(row.state);
      for (let j = 0; j < response.length; j++) {
        response[j] -= correction[j];
      }
    } else {
      const shape = tractShape(row.state, canonical);
      oralResponse(shape.areas, shape.length, response);
    }
    for (let j = 0; j < 24; j++) {
      env[j] = interpolateResponse(response, GRID[j]);
    }
    normalizeEnvelope(env);
    const bucket = Math.floor(row.state.height * 50);
    if (duplicate(row.state, bucket, buckets, rawChannels, rawEnvelope, env)) {
      continue;
    }
    responseFormants(response, formants);
    for (let j = 0; j < 12; j++) {
      const { name, min, max } = CODEBOOK_CHANNELS[j];
      rawChannels[count * 12 + j] = row.state[name];
      book.articulation[count * 12 + j] = Math.round(
        (255 * (row.state[name] - min)) / (max - min)
      );
    }
    for (let j = 0; j < 8; j++) {
      book.formants[count * 8 + j] = Math.round(formants[j] * frequencyScale);
    }
    for (let j = 0; j < 24; j++) {
      rawEnvelope[count * 24 + j] = env[j];
      book.envelope[count * 24 + j] = Math.max(
        0,
        Math.min(255, Math.round((env[j] + 64) * 2))
      );
      // Keys are made from the stored envelope: quantisation must not move
      // a row away from its own query key after serialization.
      env[j] = book.envelope[count * 24 + j] * 0.5 - 64;
    }
    envelopeKey(env, key);
    book.key.set(key, count * 6);
    book.phone[count] = row.phone;
    rows[row.kind]++;
    if (nasal) {
      book.stats.nasalRows++;
    }
    buckets[bucket].push(count++);
  }
  book.tree = buildTree(book.key, size);
  book.stats.nonUniqueShare = nonUniqueShare(book);
  book.stats.buildMilliseconds = globalThis.performance.now() - started;
  cache.set(id, serializeCodebook(book));
  book.lengthScale = lengthScale;
  return attachQuery(book);
}

/* eslint-enable max-statements, complexity */

export function buildCodebook(head = {}, options = {}) {
  return buildCodebookWithRenderer(head, options);
}

const predictor = new Float64Array(128);
/** Caller-owned {envelope: 24 values, key: 6 values}; no frame allocations. */
export function frameEnvelope(frames, t, codebook, out) {
  if (
    !Number.isInteger(t) ||
    t < 0 ||
    t >= frames.count ||
    frames.order > predictor.length ||
    !out ||
    out.envelope.length < 24 ||
    out.key.length < 6
  ) {
    throw new RangeError('Invalid frameEnvelope dimensions');
  }
  for (let j = 0; j < frames.order; j++) {
    predictor[j] = frames.lpc[t * frames.order + j];
  }
  const power = 10 ** (frames.gain[t] / 10);
  for (let j = 0; j < 24; j++) {
    const f = GRID[j] / codebook.lengthScale;
    out.envelope[j] =
      f > (0.95 * frames.rate) / 2
        ? NaN
        : lpcLevel(predictor, frames.order, power, f, frames.rate);
  }
  normalizeEnvelope(out.envelope);
  envelopeKey(out.envelope, out.key);
  return out;
}
