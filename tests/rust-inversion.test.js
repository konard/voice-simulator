/** Class B parity for acoustic inversion given the same candidate lattice. */
import assert from 'node:assert/strict';
import {
  analyzeFrames,
  buildCodebook,
  CODEBOOK_CHANNELS,
  DEFAULT_HEAD,
  synthesize,
  invertArticulation,
  trackPitch,
  trackFormants,
  createArticulationInverter,
} from '../src/index.js';
import { CHANNELS, CHANNEL_DEFAULTS } from '../src/articulation/plan.js';
import { tractSteps } from '../src/recognition/inversion-search.js';
import {
  SOURCE_CHANNELS,
  NOISE_CHANNELS,
} from '../src/recognition/inversion-source.js';
import { SOURCE_CHANNEL_MAPS } from '../src/recognition/source-channel-maps.js';
import { whisperFormantFrames } from '../src/recognition/whisper-spectrum.js';
import { float64View } from '../src/engine/wasm-loader.js';
import { loadRustEngine, noRust } from './helpers/rust-engine.js';
import { itUnless } from './helpers/skip.js';

function packet(book, result) {
  const { index, cost } = result.candidates;
  const data = new Float64Array(
    48 + book.articulation.length + index.length + cost.length
  );
  data.set(CODEBOOK_CHANNELS.map(({ min }) => min));
  data.set(
    CODEBOOK_CHANNELS.map(({ min, max }) => max - min),
    12
  );
  data.set(tractSteps(result.head, result.frameRate), 24);
  data.set(
    CODEBOOK_CHANNELS.map(({ name }) => CHANNEL_DEFAULTS[name]),
    36
  );
  data.set(book.articulation, 48);
  data.set(index, 48 + book.articulation.length);
  data.set(cost, 48 + book.articulation.length + index.length);
  return data;
}

function compare(expected, out, t) {
  CODEBOOK_CHANNELS.forEach(({ name }, c) => {
    assert.ok(
      Math.abs(expected.channels[name][t] - out[c]) < 1e-6,
      `${t} ${name} mean ${expected.channels[name][t]} vs ${out[c]}`
    );
    const variance = expected.variance[name][t];
    assert.ok(
      variance === out[c + 12] || Math.abs(variance - out[c + 12]) < 1e-6,
      `${t} ${name} variance`
    );
  });
  assert.ok(
    Math.abs(expected.confidence[t] - out[24]) < 1e-6,
    `${t} confidence`
  );
}

function compareSource(engine, frames, pitch, expected) {
  const { frameCount, head } = expected;
  const maps = SOURCE_CHANNEL_MAPS[frames.rate];
  const data = new Float64Array(18 + frameCount * (frames.whisper ? 8 : 7));
  NOISE_CHANNELS.forEach((name, i) => data.set(maps[name], i * 6));
  for (let t = 0; t < frameCount; t++) {
    data.set(
      [
        frames.energy[t],
        frames.gravity[t],
        frames.zcr[t],
        frames.periodicity[t],
        frames.tilt[t],
        frames.speech[t],
        pitch.f0[t],
      ],
      18 + t * 7
    );
  }
  if (frames.whisper) {
    data.set(frames.whisper.subarray(0, frameCount), 18 + frameCount * 7);
  }
  const width = SOURCE_CHANNELS.length;
  const outLength = frameCount * width;
  const src = engine.exports.vs_alloc(data.byteLength);
  const dst = engine.exports.vs_alloc(outLength * 8);
  try {
    float64View(engine, src, data.length).set(data);
    const estimate = frames.whisper
      ? engine.exports.vs_inversion_source_whisper
      : engine.exports.vs_inversion_source;
    assert.equal(
      estimate(src, frameCount, frames.hop, CHANNELS.voicing, head.pitch, dst),
      0
    );
    const out = float64View(engine, dst, outLength);
    for (let t = 0; t < frameCount; t++) {
      SOURCE_CHANNELS.forEach((name, c) => {
        assert.ok(
          Math.abs(
            expected.channels[name][t] - Math.fround(out[t * width + c])
          ) < 1e-6,
          `${t} ${name}`
        );
      });
    }
  } finally {
    engine.exports.vs_free(src, data.byteLength);
    engine.exports.vs_free(dst, outLength * 8);
  }
}

function compareLattice(engine, codebook, expected, lag) {
  const data = packet(codebook, expected);
  const outLength = expected.frameCount * 25;
  const src = engine.exports.vs_alloc(data.byteLength);
  const dst = engine.exports.vs_alloc(outLength * 8);
  try {
    float64View(engine, src, data.length).set(data);
    assert.equal(
      engine.exports.vs_inversion(
        src,
        expected.frameCount,
        codebook.size,
        expected.candidates.width,
        lag,
        1,
        dst
      ),
      0
    );
    const out = float64View(engine, dst, outLength);
    for (let t = 0; t < expected.frameCount; t++) {
      compare(expected, out.subarray(t * 25, t * 25 + 25), t);
    }
  } finally {
    engine.exports.vs_free(src, data.byteLength);
    engine.exports.vs_free(dst, outLength * 8);
  }
}

itUnless(noRust)(
  'matches Rust acoustic lattice search, smoothing and source controls',
  async () => {
    const engine = await loadRustEngine();
    const { samples, sampleRate } = synthesize('apa ata aka.', {
      ipa: true,
      head: DEFAULT_HEAD,
      solver: 'waveguide',
      engine: 'js',
      sampleRate: 8000,
      seed: 1,
    });
    const frames = analyzeFrames(samples, sampleRate);
    const pitch = trackPitch(frames);
    const codebook = buildCodebook(DEFAULT_HEAD, { size: 512 });
    const formants = trackFormants(frames, {
      pitch,
      vocalTractLength: DEFAULT_HEAD.vocalTractLength,
    });
    const expected = invertArticulation(frames, { codebook, pitch, formants });
    compareLattice(engine, codebook, expected, frames.count);
    const stage = createArticulationInverter(frames, {
      codebook,
      pitch,
      formants,
    });
    stage.advance(true);
    compareLattice(engine, codebook, stage.track, 30);
    compareSource(engine, frames, pitch, expected);
  }
);

itUnless(noRust)(
  'matches source controls and the tract lattice with whispered references',
  async () => {
    const engine = await loadRustEngine();
    const { samples, sampleRate } = synthesize('apa {W aka W}', {
      ipa: true,
      solver: 'waveguide',
      engine: 'js',
      sampleRate: 8000,
    });
    const raw = analyzeFrames(samples, sampleRate);
    const pitch = trackPitch(raw);
    const end = samples.length / sampleRate;
    const frames = whisperFormantFrames(raw, [{ start: end / 2, end }]);
    const codebook = buildCodebook(DEFAULT_HEAD, { size: 32 });
    const expected = invertArticulation(frames, { codebook, pitch });
    assert.ok(expected.channels.whisper.includes(1));
    compareLattice(engine, codebook, expected, frames.count);
    compareSource(engine, frames, pitch, expected);
  }
);
