/** Bounded front-end parameter probe for the 31 simulated vowel seeds. */
import { readFileSync } from 'node:fs';
import {
  parseCodebook,
  renderPlan,
  analyzeFrames,
  frameEnvelope,
} from '../src/index.js';
import { codebookSeeds } from '../src/recognition/codebook-seeds.js';
import { steadyPlan } from '../src/recognition/codebook-features.js';
const book = parseCodebook(readFileSync('reports/issue-64-20000.bin'));
const seeds = codebookSeeds().filter((row) => row.kind === 'vowel');
const out = { index: new Int32Array(16), cost: new Float64Array(16) };
const frame = { envelope: new Float64Array(24), key: new Float64Array(6) };
for (const sampleRate of [16000, 8000]) {
  const sounds = seeds.map(({ state }) =>
    renderPlan(steadyPlan(state, 0.3), {
      solver: 'waveguide',
      engine: 'js',
      sampleRate,
      seed: 1,
    })
  );
  for (const window of [0.025, 0.04, 0.05]) {
    for (const preEmphasis of [0.9, 0.97, 0.999]) {
      for (const order of [Math.round(sampleRate / 1000) + 2, 24]) {
        let matched = 0;
        for (let i = 0; i < sounds.length; i++) {
          const frames = analyzeFrames(sounds[i], sampleRate, {
            window,
            preEmphasis,
            order,
            maxSeconds: 1,
          });
          frameEnvelope(frames, Math.floor(frames.count / 2), book, frame);
          book.query(frame.envelope, 16, out);
          const state = seeds[i].state;
          matched += Number(
            out.index.some(
              (row) =>
                row >= 0 &&
                Math.abs(book.articulation[row * 12] / 255 - state.height) <=
                  0.15 &&
                Math.abs(
                  book.articulation[row * 12 + 1] / 255 - state.backness
                ) <= 0.15
            )
          );
        }
        console.log(
          JSON.stringify({ sampleRate, window, preEmphasis, order, matched })
        );
      }
    }
  }
}
