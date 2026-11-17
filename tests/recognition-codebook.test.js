/** Codebook unit checks use 2000 rows; full coverage lives in heavy/. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'test-anywhere';
import {
  buildCodebook,
  serializeCodebook,
  parseCodebook,
  frameEnvelope,
  CODEBOOK_CHANNELS,
  GRID,
  tractResponse,
  tractShape,
  normalizeHeadConfig,
  analyzeFrames,
} from '../src/index.js';
import { tubeTransfer } from '../src/acoustics/transfer.js';
import { createRandom } from '../src/random.js';
import { CHANNEL_DEFAULTS } from '../src/articulation/plan.js';
import { envelopeKey } from '../src/recognition/codebook-features.js';
import { envelopeCost } from '../src/recognition/codebook-search.js';

const cache = new Map();
let built;
const book = () => (built ??= buildCodebook({}, { size: 2000, cache }));
const output = (k = 16) => ({
  index: new Int32Array(k),
  cost: new Float64Array(k),
});
const decode = (b, row) =>
  Float64Array.from(
    { length: 24 },
    (_, j) => b.envelope[row * 24 + j] * 0.5 - 64
  );

// Test cases share one expensive table fixture.
// eslint-disable-next-line max-lines-per-function
describe('simulator-generated articulatory codebook', () => {
  it('fast response equals tubeTransfer', () => {
    const random = createRandom(64),
      head = normalizeHeadConfig({});
    const frequencies = Float64Array.from(
      { length: 50 },
      () => 100 + random() * 5100
    );
    const levels = new Float64Array(50);
    for (let shape = 0; shape < 20; shape++) {
      const state = {
        ...CHANNEL_DEFAULTS,
        height: random(),
        backness: random(),
        rounding: random(),
        tongueAmount: random(),
        tongueArea: random() * 2,
        lipAmount: random(),
        lipArea: random() * 2,
      };
      const tract = tractShape(state, head);
      tractResponse(tract.areas, tract.length, frequencies, levels);
      for (let i = 0; i < 50; i++) {
        assert.ok(
          Math.abs(
            levels[i] -
              20 *
                Math.log10(
                  tubeTransfer(tract.areas, tract.length, frequencies[i])
                )
          ) <= 0.01
        );
      }
    }
  });
  it('is deterministic and round trips every typed array', () => {
    const a = serializeCodebook(book());
    const b = serializeCodebook(
      buildCodebook({}, { size: 2000, cache: new Map() })
    );
    assert.deepEqual(a, b);
    const parsed = parseCodebook(a);
    for (const name of [
      'articulation',
      'formants',
      'envelope',
      'key',
      'phone',
      'tree',
    ]) {
      assert.deepEqual(parsed[name], book()[name]);
    }
    assert.deepEqual(serializeCodebook(parsed), a);
    assert.equal(parsed.stats.buildMilliseconds, 0);
    console.log(
      `codebook SHA-256 ${createHash('sha256').update(a).digest('hex')}`
    );
  });
  it('finds its own rows', () => {
    const b = book(),
      out = output();
    let unique = 0;
    for (let row = 0; row < b.size && unique < 200; row++) {
      const env = decode(b, row);
      // Indistinguishable quantized envelopes intentionally represent
      // multiple articulations. Their first row is the stable tie winner.
      let first = row;
      for (let previous = 0; previous < row; previous++) {
        if (envelopeCost(env, b.envelope, previous) === 0) {
          first = previous;
          break;
        }
      }
      if (first !== row) {
        continue;
      }
      b.query(env, 16, out);
      assert.equal(out.index[0], row, `row ${row}`);
      assert.equal(out.cost[0], 0);
      unique++;
    }
    assert.equal(unique, 200);
  });
  it('tree agrees with a full search', () => {
    const b = book(),
      random = createRandom(400),
      env = new Float64Array(24),
      out = output();
    let correct = 0;
    for (let trial = 0; trial < 200; trial++) {
      // Observations from the model with independent half-dB measurement noise.
      const source = Math.floor(random() * b.size);
      for (let j = 0; j < 24; j++) {
        env[j] =
          b.envelope[source * 24 + j] * 0.5 - 64 + (random() - 0.5) * 0.5;
      }
      let best = -1,
        cost = Infinity;
      for (let row = 0; row < b.size; row++) {
        const c = envelopeCost(env, b.envelope, row);
        if (c < cost) {
          best = row;
          cost = c;
        }
      }
      b.query(env, 16, out);
      correct += out.index[0] === best ? 1 : 0;
    }
    console.log(`codebook full-search agreement ${correct}/200`);
    assert.ok(correct >= 198);
  });
  it('handles cache identity, length views, bounds and malformed binary input', () => {
    const b = book();
    const scaled = buildCodebook(
      { vocalTractLength: 16.6 },
      { size: 2000, cache }
    );
    assert.equal(scaled.id, b.id);
    assert.equal(scaled.lengthScale, 16.6 / 16.5);
    assert.deepEqual(scaled.envelope, b.envelope);
    assert.equal(b.lengthScale, 1);
    assert.notEqual(
      buildCodebook({ vocalTractLength: 14 }, { size: 1, cache: new Map() }).id,
      buildCodebook({}, { size: 1, cache: new Map() }).id
    );
    assert.notEqual(
      buildCodebook({ oralWidth: 1.1 }, { size: 1, cache: new Map() }).id,
      buildCodebook({}, { size: 1, cache: new Map() }).id
    );
    for (const size of [0, 100001, 1.5, NaN]) {
      assert.throws(() => buildCodebook({}, { size }), RangeError);
    }
    const bytes = serializeCodebook(b);
    assert.throws(() => parseCodebook(bytes.subarray(0, 79)), RangeError);
    assert.throws(
      () => parseCodebook(bytes.subarray(0, bytes.length - 1)),
      RangeError
    );
    const invalid = bytes.slice();
    invalid[4] = 99;
    assert.throws(() => parseCodebook(invalid), RangeError);
    const child = bytes.slice();
    new DataView(child.buffer).setInt32(
      child.length - b.size * 16 + 8,
      0,
      true
    );
    assert.throws(() => parseCodebook(child), RangeError);
    const shifted = new Uint8Array(bytes.length + 1);
    shifted.set(bytes, 1);
    assert.deepEqual(parseCodebook(shifted.subarray(1)).key, b.key);
    assert.throws(
      () => b.query(new Float64Array(24), 65, output(65)),
      RangeError
    );
    const out = output();
    b.query(new Float64Array(24).fill(NaN), 16, out);
    assert.ok(out.index.every((n) => n === -1));
    assert.ok(out.cost.every((n) => n === Infinity));
    assert.ok(b.stats.nasalRows <= b.size / 10);
    assert.equal(
      Object.values(b.stats.rows).reduce((a, c) => a + c),
      b.size
    );
    assert.equal(CODEBOOK_CHANNELS.length, 12);
  });
  it('frameEnvelope scales frequencies, masks Nyquist and removes level and tilt', () => {
    const frames = analyzeFrames(new Float32Array(800).fill(0.01), 8000);
    const out = { envelope: new Float64Array(24), key: new Float64Array(6) };
    assert.equal(frameEnvelope(frames, 1, book(), out), out);
    for (let j = 0; j < 24; j++) {
      assert.equal(Number.isNaN(out.envelope[j]), GRID[j] > 3800);
    }
    const a = new Float64Array(24),
      b = new Float64Array(24),
      ka = new Float64Array(6),
      kb = new Float64Array(6);
    for (let j = 0; j < 24; j++) {
      a[j] = Math.sin(j);
      b[j] = a[j] + 3 + 2 * j;
    }
    envelopeKey(a, ka);
    envelopeKey(b, kb);
    for (let j = 0; j < 6; j++) {
      assert.ok(Math.abs(ka[j] - kb[j]) < 1e-10);
    }
    assert.throws(
      () => frameEnvelope(frames, frames.count, book(), out),
      RangeError
    );
  });
});
