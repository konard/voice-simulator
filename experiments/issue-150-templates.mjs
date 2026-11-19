// Rendered MFCC templates of every codebook row of a golden speaker
// (issue 150). Usage: node experiments/issue-150-templates.mjs speakerId
// Writes $ISSUE150_CACHE/<speaker>.templates.bin: Float32 rows x 13
// (c1..c13 of the metric's MFCC, steady part of an 85 ms render at the
// head's pitch).
import { existsSync, writeFileSync } from 'node:fs';
import { CODEBOOK_CHANNELS, renderPlan } from '../src/index.js';
import { steadyPlan } from '../src/recognition/codebook-features.js';
import { powerFrames, cepstra } from '../src/metrics/spectrum.js';
import { items, voiceFor, codebookFor } from './issue-150-cache.mjs';

export const COEFFICIENTS = 13;
const W = CODEBOOK_CHANNELS.length;

export function rowState(book, row) {
  return Object.fromEntries(
    CODEBOOK_CHANNELS.map(({ name, min, max }, c) => [
      name,
      min + (book.articulation[row * W + c] / 255) * (max - min),
    ])
  );
}

export function templateOf(state, head, sampleRate, f0 = head.pitch) {
  const plan = steadyPlan(state, 0.085);
  plan.head = head;
  delete plan.channels.jaw;
  delete plan.channels.lipProtrusion;
  plan.channels.f0.fill(f0);
  const samples = renderPlan(plan, {
    sampleRate,
    solver: 'waveguide',
    engine: 'js',
    seed: 1,
  });
  const frames = powerFrames(samples, sampleRate);
  const steady = frames.slice(Math.max(0, frames.length - 4));
  const mean = steady[0].map(
    (_, k) => steady.reduce((s, f) => s + f[k], 0) / steady.length
  );
  return cepstra([mean], sampleRate)[0].subarray(1, COEFFICIENTS + 1);
}

const speaker = process.argv[2];
if (speaker) {
  const item = items.find((x) => x.speaker.id === speaker);
  const file = `${process.env.ISSUE150_CACHE || '/tmp/issue150-cache'}/${speaker}.templates.bin`;
  if (!existsSync(file)) {
    const head = voiceFor(item);
    const book = codebookFor(item, head);
    const rows = book.articulation.length / W;
    const out = new Float32Array(rows * COEFFICIENTS);
    for (let row = 0; row < rows; row++) {
      out.set(
        templateOf(rowState(book, row), head, item.sampleRate),
        row * COEFFICIENTS
      );
    }
    writeFileSync(file, new Uint8Array(out.buffer));
  }
  console.log(speaker, 'done');
}
