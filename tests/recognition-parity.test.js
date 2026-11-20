import assert from 'node:assert/strict';
import { DEFAULT_HEAD, recognize, synthesize } from '../src/index.js';
import { decoderCodebook } from '../src/recognition/decode-pipeline.js';
import { codebookQueries } from '../src/recognition/codebook-jobs.js';
import { createRecognitionEngine } from '../src/recognition/engine.js';
import { analyzeFrames } from '../src/recognition/frontend.js';
import { trackFormants } from '../src/recognition/formants.js';
import { trackPitch } from '../src/recognition/pitch.js';
import { noRust } from './helpers/rust-engine.js';
import { itUnless } from './helpers/skip.js';

const it = itUnless(noRust);
const FOX = 'The quick brown fox jumps over the lazy dog.';

function frameColumns(frames) {
  const columns = [];
  for (const name of [
    'energy',
    'noise',
    'speech',
    'periodicity',
    'zcr',
    'gravity',
    'tilt',
    'gain',
    'band',
    'mel',
    'cepstrum',
    'lpc',
    'reflection',
  ]) {
    const data = frames[name];
    const width = data.length / frames.capacity;
    for (let c = 0; c < width; c++) {
      columns.push([
        name,
        Array.from({ length: frames.count }, (_, t) => data[t * width + c]),
      ]);
    }
  }
  return columns;
}

function framesMatch(js, rust) {
  assert.equal(rust.count, js.count);
  assert.equal(rust.rate, js.rate);
  const actual = frameColumns(rust);
  frameColumns(js).forEach(([name, expected], i) => {
    assert.equal(actual[i][0], name);
    const scale = expected.reduce(
      (max, value) => Math.max(max, Math.abs(value)),
      0
    );
    expected.forEach((value, t) => {
      assert.ok(
        Math.abs(value - actual[i][1][t]) <= scale * 1e-4,
        `${name}, frame ${t}`
      );
    });
  });
}

function pitchMatches(js, rust, count) {
  let same = 0;
  for (let t = 0; t < count; t++) {
    const expected = js.f0[t];
    const actual = rust.f0[t];
    same += Number(Boolean(expected) === Boolean(actual));
    if (expected && actual) {
      assert.ok(
        Math.abs(expected - actual) <= 0.1,
        `f0 frame ${t}: ${expected} vs ${actual}`
      );
    }
  }
  assert.ok(same / count >= 0.995, `voicing agreement ${same}/${count}`);
}

function formantsMatch(js, rust, count) {
  for (let c = 0; c < 3; c++) {
    let same = 0;
    for (let t = 0; t < count; t++) {
      const a = js.frequency[t * 4 + c];
      const b = rust.frequency[t * 4 + c];
      same += Number(Object.is(a, b) || Math.abs(a - b) <= 2);
    }
    assert.ok(same / count >= 0.99, `F${c + 1} agreement ${same}/${count}`);
  }
}

function codebookMatches(frames, kernels) {
  const book = decoderCodebook(DEFAULT_HEAD);
  const js = codebookQueries(frames, book, DEFAULT_HEAD, null);
  const rustBook = decoderCodebook(DEFAULT_HEAD, kernels);
  const rust = codebookQueries(frames, rustBook, DEFAULT_HEAD, kernels);
  const result = () => ({
    index: new Int32Array(16),
    cost: new Float64Array(16),
  });
  const expected = result();
  const actual = result();
  let same = 0;
  let count = 0;
  for (let t = 0; t < frames.count; t++) {
    if (frames.speech[t]) {
      js(t, expected);
      rust(t, actual);
      count++;
      same += Number(actual.index[0] === expected.index[0]);
    }
  }
  assert.ok(
    count > 0 && same / count >= 0.999,
    `codebook agreement ${same}/${count}`
  );
}

function timesMatch(js, rust) {
  for (const edge of ['start', 'end']) {
    assert.ok(
      Math.abs(js[edge] - rust[edge]) <= 0.001,
      `${edge}: ${js[edge]} vs ${rust[edge]}`
    );
  }
}

function textMatches(samples, sampleRate, level) {
  const options = { level, threads: 1, languages: ['en'] };
  const js = recognize(samples, sampleRate, { ...options, engine: 'js' });
  const rust = recognize(samples, sampleRate, { ...options, engine: 'rust' });
  assert.equal(rust.text, js.text);
  assert.equal(rust.ipa, js.ipa);
  assert.equal(rust.words.length, js.words.length);
  for (const [i, word] of js.words.entries()) {
    const other = rust.words[i];
    timesMatch(word, other);
    assert.equal(other.syllables.length, word.syllables.length);
    word.syllables.forEach((syllable, j) =>
      timesMatch(syllable, other.syllables[j])
    );
  }
}

for (const [tier, level, rate] of [
  ['minimal', 'medium', 16000],
  ['telephone', 'low', 8000],
]) {
  it(`frames, pitch, formants, codebook and text match for ${tier}`, async () => {
    const { samples, sampleRate } = synthesize(FOX, {
      tier,
      seed: 1,
      engine: 'js',
    });
    const kernels = await createRecognitionEngine({
      engine: 'rust',
      threads: 1,
    });
    const js = analyzeFrames(samples, sampleRate, { rate });
    const rust = analyzeFrames(samples, sampleRate, { rate, kernels });
    framesMatch(js, rust);
    const jsPitch = trackPitch(js);
    const rustPitch = trackPitch(rust, { kernels });
    pitchMatches(jsPitch, rustPitch, js.count);
    formantsMatch(
      trackFormants(js, { pitch: jsPitch }),
      trackFormants(rust, { pitch: rustPitch }),
      js.count
    );
    codebookMatches(rust, kernels);
    textMatches(samples, sampleRate, level);
  });
}
