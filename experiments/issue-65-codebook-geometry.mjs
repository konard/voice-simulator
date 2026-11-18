/** Compare physical codebook geometries against the same acoustic input. Unlicense. */
import {
  analyzeFrames,
  buildCodebook,
  CODEBOOK_CHANNELS,
  GRID,
  invertArticulation,
  planUtterance,
  presetHeadConfig,
  renderPlan,
  synthesize,
  trackFormants,
  trackPitch,
  tractResponse,
  tractShape,
} from '../src/index.js';
import { sampleState } from '../src/articulation/tract-shape.js';
import { VOWELS } from '../src/ipa/inventory.js';
import {
  envelopeKey,
  interpolateResponse,
  L0,
  normalizeEnvelope,
  RESPONSE_GRID,
  responseFormants,
} from '../src/recognition/codebook-features.js';
import { attachQuery, buildTree } from '../src/recognition/codebook-search.js';
import { LANDMARK_SENTENCES } from '../scripts/landmark-material.mjs';

const audioOptions = {
  engine: 'js',
  solver: 'waveguide',
  seed: 1,
  sampleRate: 16000,
};
const vowels = Object.keys(VOWELS);

function evaluateRow(book, referenceHead, row, response, frequencies) {
  const state = Object.fromEntries(
    CODEBOOK_CHANNELS.map(({ name, min, max }, c) => [
      name,
      min +
        (book.articulation[row * CODEBOOK_CHANNELS.length + c] * (max - min)) /
          255,
    ])
  );
  if (state.velum >= 0.1) {
    return false;
  }
  const shape = tractShape(state, referenceHead);
  tractResponse(shape.areas, shape.length, frequencies, response);
  return true;
}

function rebuildWithDerivedJawAndLips(book, head) {
  const envelope = book.envelope.slice();
  const key = book.key.slice();
  const formants = book.formants.slice();
  const levels = new Float64Array(GRID.length);
  const rowKey = new Float64Array(6);
  const peaks = new Float64Array(8);
  const response = new Float64Array(RESPONSE_GRID.length);
  const referenceHead = { ...head, vocalTractLength: book.referenceLength };
  const scale = L0 / book.referenceLength;
  const frequencies = RESPONSE_GRID.map((f) => f * scale);
  for (let row = 0; row < book.size; row++) {
    if (!evaluateRow(book, referenceHead, row, response, frequencies)) {
      continue;
    }
    levels.set(GRID.map((f) => interpolateResponse(response, f)));
    normalizeEnvelope(levels);
    for (let j = 0; j < levels.length; j++) {
      const value = Math.max(
        0,
        Math.min(255, Math.round((levels[j] + 64) * 2))
      );
      envelope[row * levels.length + j] = value;
      levels[j] = value / 2 - 64;
    }
    envelopeKey(levels, rowKey);
    key.set(rowKey, row * rowKey.length);
    responseFormants(response, peaks);
    formants.set(
      peaks.map((f) => Math.round(f * scale)),
      row * peaks.length
    );
  }
  return attachQuery({
    ...book,
    formants,
    envelope,
    key,
    tree: buildTree(key, book.size),
  });
}

function observations(samples, head) {
  const frames = analyzeFrames(samples, audioOptions.sampleRate);
  const pitch = trackPitch(frames);
  const formants = trackFormants(frames, {
    pitch,
    vocalTractLength: head.vocalTractLength,
  });
  return { frames, options: { pitch, formants, voice: head } };
}

function score({ plan, frames, options }, codebook, steady) {
  const { channels } = invertArticulation(frames, { ...options, codebook });
  const times = steady
    ? plan.segments
        .filter(({ kind }) => kind === 'vowel')
        .map(({ start, end }) => Math.round((start + end) / (2 * frames.hop)))
    : Array.from({ length: frames.count }, (_, t) => t).filter(
        (t) => frames.speech[t] && frames.periodicity[t] >= 0.45
      );
  let correct = 0;
  let heightError = 0;
  let backnessError = 0;
  for (const t of times) {
    const truth = sampleState(plan, t * frames.hop);
    const height = channels.height[t] - truth.height;
    const backness = channels.backness[t] - truth.backness;
    correct += Number(Math.abs(height) <= 0.15 && Math.abs(backness) <= 0.2);
    heightError += height * height;
    backnessError += backness * backness;
  }
  return {
    correct,
    frames: times.length,
    heightRms: Math.sqrt(heightError / times.length),
    backnessRms: Math.sqrt(backnessError / times.length),
  };
}

for (const preset of ['male', 'female']) {
  const head = presetHeadConfig(preset);
  const book = buildCodebook(head, { size: 5000 });
  const derived = rebuildWithDerivedJawAndLips(book, head);
  const plan = planUtterance(vowels.map((vowel) => `${vowel}ː`).join(''), {
    head,
    durations: vowels.map(() => 0.3),
  });
  const sustained = {
    plan,
    ...observations(renderPlan(plan, audioOptions), head),
  };
  const sentence = synthesize(LANDMARK_SENTENCES[0][1], {
    ...audioOptions,
    head,
  });
  const continuous = {
    plan: sentence.plan,
    ...observations(sentence.samples, head),
  };
  for (const [geometry, table] of [
    ['fixed jaw and lips', book],
    ['derived jaw and lips in oral rows', derived],
  ]) {
    console.log({
      preset,
      geometry,
      sustained: score(sustained, table, true),
      continuous: score(continuous, table, false),
    });
  }
}
