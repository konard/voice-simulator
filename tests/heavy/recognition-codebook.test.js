/** Full 20k table, independent shapes, rendered vowels and CPU budgets (#64). */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'test-anywhere';
import {
  buildCodebook,
  serializeCodebook,
  tractShape,
  normalizeHeadConfig,
  analyzeFrames,
  frameEnvelope,
  renderPlan,
  VOWELS,
  CODEBOOK_CHANNELS,
} from '../../src/index.js';
import {
  GRID,
  RESPONSE_GRID,
  L0,
  normalizeEnvelope,
  interpolateResponse,
  tractResponse,
  responseFormants,
  renderedResponse,
  steadyPlan,
} from '../../src/recognition/codebook-features.js';
import {
  codebookSeeds,
  proposeRow,
} from '../../src/recognition/codebook-seeds.js';
import { CHANNEL_DEFAULTS } from '../../src/articulation/plan.js';
import { writeReport } from './helpers/report.js';

const metrics = {};
let table;
const book = () => (table ??= buildCodebook({}, { cache: new Map() }));
const out = { index: new Int32Array(16), cost: new Float64Array(16) };
const frame = { envelope: new Float64Array(24), key: new Float64Array(6) };

// Test cases share one expensive table fixture.
// eslint-disable-next-line max-lines-per-function
describe('full simulator codebook', () => {
  it('stays within the CPU budget and reports non-uniqueness', () => {
    const b = book();
    const env = Float64Array.from(
      { length: 24 },
      (_, i) => b.envelope[500 * 24 + i] * 0.5 - 64
    );
    for (let i = 0; i < 1000; i++) {
      b.query(env, 16, out);
    }
    const start = globalThis.performance.now();
    // Cycle rows so timing does not just repeat one favourable tree leaf.
    for (let i = 0; i < 10000; i++) {
      for (let j = 0; j < 24; j++) {
        env[j] = b.envelope[(i % b.size) * 24 + j] * 0.5 - 64;
      }
      b.query(env, 16, out);
    }
    metrics.queryMicroseconds =
      ((globalThis.performance.now() - start) * 1000) / 10000;
    metrics.buildSeconds = b.stats.buildMilliseconds / 1000;
    metrics.stats = b.stats;
    metrics.sha256 = createHash('sha256')
      .update(serializeCodebook(b))
      .digest('hex');
    console.log(`codebook build ${metrics.buildSeconds} s`);
    console.log(`codebook query ${metrics.queryMicroseconds} microseconds`);
    console.log(`codebook SHA-256 ${metrics.sha256}`);
    console.log(`codebook stats ${JSON.stringify(b.stats)}`);
    assert.ok(
      metrics.buildSeconds <= 60,
      `build ${metrics.buildSeconds}s > 60s`
    );
    assert.ok(
      metrics.queryMicroseconds <= 50,
      `query ${metrics.queryMicroseconds}us > 50us`
    );
  });
  it('covers unseen shapes', () => {
    const b = book(),
      seeds = codebookSeeds(),
      head = normalizeHeadConfig({});
    const response = new Float64Array(205),
      correction = new Float64Array(205),
      truth = new Float64Array(8);
    const neutral = tractShape(CHANNEL_DEFAULTS, head);
    tractResponse(neutral.areas, neutral.length, RESPONSE_GRID, correction);
    renderedResponse(CHANNEL_DEFAULTS, head, response);
    for (let j = 0; j < 205; j++) {
      correction[j] = response[j] - correction[j];
    }
    let covered = 0,
      nasal = 0,
      count = 0;
    for (let proposal = 1000; count < 500; proposal++) {
      const { state } = proposeRow(seeds, 721, proposal);
      const isNasal = state.velum >= 0.1;
      if (isNasal && nasal >= 50) {
        continue;
      }
      if (isNasal) {
        nasal++;
        renderedResponse(state, head, response);
        for (let j = 0; j < 205; j++) {
          response[j] -= correction[j];
        }
      } else {
        const shape = tractShape(state, head);
        tractResponse(shape.areas, shape.length, RESPONSE_GRID, response);
      }
      responseFormants(response, truth);
      for (let j = 0; j < 24; j++) {
        frame.envelope[j] = interpolateResponse(response, GRID[j]);
      }
      normalizeEnvelope(frame.envelope);
      b.query(frame.envelope, 16, out);
      let found = false;
      for (const row of out.index) {
        if (row < 0) {
          continue;
        }
        let close = true;
        for (let j = 0; j < 3; j++) {
          if (
            !(truth[j] > 0) ||
            Math.abs(b.formants[row * 8 + j] / truth[j] - 1) > 0.05
          ) {
            close = false;
          }
        }
        if (close) {
          found = true;
        }
      }
      if (found) {
        covered++;
      }
      count++;
    }
    metrics.unseen = { covered, count, share: covered / count, nasal };
    console.log(`codebook unseen ${JSON.stringify(metrics.unseen)}`);
    assert.ok(covered >= 475, `${covered}/500 shapes within 5% (required 475)`);
  });
  it('scales with tract length', () => {
    const seeds = codebookSeeds().filter((row) => row.kind === 'vowel');
    const levels = new Float64Array(205),
      regular = new Float64Array(8),
      short = new Float64Array(8);
    let maximum = 0;
    const shortBook = buildCodebook(
      { vocalTractLength: 14 },
      { size: 2000, cache: new Map() }
    );
    let fallbackMaximum = 0;
    for (const { state } of seeds) {
      for (const length of [L0, 14]) {
        const shape = tractShape(
          state,
          normalizeHeadConfig({ vocalTractLength: length })
        );
        tractResponse(shape.areas, shape.length, RESPONSE_GRID, levels);
        responseFormants(levels, length === L0 ? regular : short);
      }
      // A vowel can duplicate neutral; its phone tag is then absent.
      let row = -1;
      for (let i = 0; i < shortBook.size && row < 0; i++) {
        if (
          CODEBOOK_CHANNELS.every(
            ({ name, min, max }, j) =>
              shortBook.articulation[i * 12 + j] ===
              Math.round((255 * (state[name] - min)) / (max - min))
          )
        ) {
          row = i;
        }
      }
      assert.ok(row >= 0, 'every oral vowel seed is represented');
      if (row >= 0) {
        for (let j = 0; j < 3; j++) {
          if (short[j]) {
            fallbackMaximum = Math.max(
              fallbackMaximum,
              Math.abs(shortBook.formants[row * 8 + j] / short[j] - 1)
            );
          }
        }
      }
      for (let j = 0; j < 3; j++) {
        if (regular[j] && short[j]) {
          maximum = Math.max(
            maximum,
            Math.abs(short[j] / ((regular[j] * L0) / 14) - 1)
          );
        }
      }
    }
    metrics.lengthScalingMaximumError = maximum;
    console.log(`codebook length scaling maximum ${maximum}`);
    metrics.perLengthMaximumError = fallbackMaximum;
    console.log(`codebook per-length maximum ${fallbackMaximum}`);
    assert.notEqual(shortBook.id, book().id);
    assert.ok(
      fallbackMaximum <= 0.02,
      `per-length error ${fallbackMaximum} > 2%`
    );
  });
  it('matches rendered sound at 16000 and 8000 Hz', () => {
    const b = book(),
      seeds = codebookSeeds().filter((row) => row.kind === 'vowel');
    metrics.rendered = [];
    for (const sampleRate of [16000, 8000]) {
      let matched = 0;
      for (const { state } of seeds) {
        const samples = renderPlan(steadyPlan(state, 0.3), {
          head: normalizeHeadConfig({}),
          solver: 'waveguide',
          engine: 'js',
          sampleRate,
          seed: 1,
        });
        const frames = analyzeFrames(samples, sampleRate);
        frameEnvelope(frames, Math.floor(frames.count / 2), b, frame);
        b.query(frame.envelope, 16, out);
        if (
          out.index.some(
            (row) =>
              row >= 0 &&
              Math.abs(b.articulation[row * 12] / 255 - state.height) <= 0.15 &&
              Math.abs(b.articulation[row * 12 + 1] / 255 - state.backness) <=
                0.15
          )
        ) {
          matched++;
        }
      }
      const result = {
        sampleRate,
        matched,
        count: Object.keys(VOWELS).length,
        share: matched / seeds.length,
      };
      metrics.rendered.push(result);
      console.log(`codebook rendered ${JSON.stringify(result)}`);
      // Issue 64 calls 90% a target, and requires the measured share to
      // be printed. Keep it explicit in the report, including misses.
      result.target = 0.9;
      result.targetMet = result.share >= 0.9;
      assert.equal(result.count, 31);
      assert.ok(matched > 0);
    }
  });
  it('writes measured results', () => {
    writeReport(
      'recognition-codebook',
      [
        '## Simulator-generated codebook (issue 64)',
        '',
        'Command: `npm run test:heavy -- --suite recognition`.',
        '',
        '```json',
        JSON.stringify(metrics, null, 2),
        '```',
        '',
      ].join('\n'),
      metrics
    );
  });
});
