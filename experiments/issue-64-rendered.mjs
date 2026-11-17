/** Diagnose LPC envelopes against analytic codebook rows; no recordings. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import {
  buildCodebook,
  serializeCodebook,
  parseCodebook,
  renderPlan,
  analyzeFrames,
  frameEnvelope,
  normalizeHeadConfig,
  tractShape,
} from '../src/index.js';
import { codebookSeeds } from '../src/recognition/codebook-seeds.js';
import {
  steadyPlan,
  GRID,
  tractResponse,
  normalizeEnvelope,
} from '../src/recognition/codebook-features.js';
const size = Number(process.argv[2] ?? 2000);
const path = `reports/issue-64-${size}.bin`;
mkdirSync('reports', { recursive: true });
const book = existsSync(path)
  ? parseCodebook(readFileSync(path))
  : buildCodebook({}, { size, cache: new Map() });
if (!existsSync(path)) {
  writeFileSync(path, serializeCodebook(book));
}
const seeds = codebookSeeds().filter((row) => row.kind === 'vowel');
const out = { index: new Int32Array(16), cost: new Float64Array(16) };
const frame = { envelope: new Float64Array(24), key: new Float64Array(6) };
const neutral = codebookSeeds()[0].state,
  head = normalizeHeadConfig({});
const correction = new Float64Array(24),
  analytic = new Float64Array(24);
const shape = tractShape(neutral, head);
tractResponse(shape.areas, shape.length, GRID, analytic);
normalizeEnvelope(analytic);
for (const sampleRate of [16000, 8000]) {
  const nf = analyzeFrames(
    renderPlan(steadyPlan(neutral, 0.3), {
      head,
      engine: 'js',
      solver: 'waveguide',
      sampleRate,
      seed: 1,
    }),
    sampleRate
  );
  frameEnvelope(nf, 30, book, frame);
  for (let j = 0; j < 24; j++) {
    correction[j] = frame.envelope[j] - analytic[j];
  }
  for (const { state, phone } of seeds) {
    const frames = analyzeFrames(
      renderPlan(steadyPlan(state, 0.3), {
        head,
        engine: 'js',
        solver: 'waveguide',
        sampleRate,
        seed: 1,
      }),
      sampleRate
    );
    frameEnvelope(frames, 30, book, frame);
    function match() {
      book.query(frame.envelope, 16, out);
      return out.index.some(
        (row) =>
          row >= 0 &&
          Math.abs(book.articulation[row * 12] / 255 - state.height) <= 0.15 &&
          Math.abs(book.articulation[row * 12 + 1] / 255 - state.backness) <=
            0.15
      );
    }
    const raw = match();
    for (let j = 0; j < 24; j++) {
      frame.envelope[j] -= correction[j];
    }
    const calibrated = match();
    console.log(
      JSON.stringify({
        sampleRate,
        phone,
        height: state.height,
        backness: state.backness,
        raw,
        calibrated,
      })
    );
  }
}
