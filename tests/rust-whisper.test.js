/** Rust and JavaScript whisper classification on shared acoustic frames. Unlicense. */
import { describe, expect } from 'test-anywhere';
import {
  analyzeFrames,
  findWhisper,
  resample,
  trackPitch,
} from '../src/index.js';
import { float64View } from '../src/engine/wasm-loader.js';
import { toneCurve } from '../src/articulation/tone-model.js';
import { WHISPER_CUES } from '../src/recognition/data/whisper-cues.js';
import { whisperDistance } from '../src/recognition/whisper-decode.js';
import { whisperVoicingProbability } from '../src/recognition/whisper-result.js';
import {
  poolLogPower,
  whisperSpectrum,
} from '../src/recognition/whisper-spectrum.js';
import { whisperToneCost } from '../src/recognition/whisper.js';
import { loadRustEngine, noRust } from './helpers/rust-engine.js';
import { itUnless } from './helpers/skip.js';
import {
  noiseBelow,
  renderWhisper,
} from '../experiments/issue-72-whisper-robustness.mjs';

function packetOf(samples, frames, pitch, sourceRate) {
  const packet = new Float64Array(4 + samples.length + frames.count * 4);
  packet.set([
    sourceRate,
    frames.startTime,
    samples.length / sourceRate,
    frames.hop,
  ]);
  packet.set(samples, 4);
  for (let i = 0; i < frames.count; i++) {
    packet.set(
      [frames.speech[i], frames.energy[i], frames.gravity[i], pitch.f0[i]],
      4 + samples.length + i * 4
    );
  }
  return packet;
}

function checkSpans(engine, packet, samples, expected) {
  const {
    vs_alloc: alloc,
    vs_free: free,
    vs_find_whisper: find,
  } = engine.exports;
  const input = alloc(packet.byteLength);
  const output = alloc(96);
  try {
    float64View(engine, input, packet.length).set(packet);
    const count = find(
      input,
      samples,
      (packet.length - samples - 4) / 4,
      output,
      4
    );
    expect(count).toBe(expected.length);
    const found = float64View(engine, output, count * 3);
    expected
      .flatMap(({ start, end, confidence }) => [start, end, confidence])
      .forEach((value, i) => {
        expect(Math.abs(value - found[i])).toBeLessThan(1e-9);
      });
  } finally {
    free(output, 96);
    free(input, packet.byteLength);
  }
}

function withPacket(engine, values, run) {
  const size = values.length * 8;
  const ptr = engine.exports.vs_alloc(size);
  try {
    float64View(engine, ptr, values.length).set(values);
    return run(ptr);
  } finally {
    engine.exports.vs_free(ptr, size);
  }
}

function expectClose(actual, expected, tolerance = 1e-9) {
  expect(Math.abs(actual - expected)).toBeLessThan(tolerance);
}

describe('Rust whisper numerical parity', () => {
  itUnless(noRust)(
    'matches whisper spans on voiced, whispered, mixed and noisy narrowband speech',
    async () => {
      const engine = await loadRustEngine();
      for (const text of [
        'a fresh fish',
        '[whisper] a fresh fish',
        'one two three [whisper] four five six',
      ]) {
        const { samples, sampleRate } = renderWhisper(text);
        for (const [wave, rate] of [
          [samples, sampleRate],
          [noiseBelow(resample(samples, sampleRate, 8000), -20), 8000],
        ]) {
          const frames = analyzeFrames(wave, rate);
          const pitch = trackPitch(frames);
          checkSpans(
            engine,
            packetOf(wave, frames, pitch, rate),
            wave.length,
            findWhisper(wave, rate, frames, pitch)
          );
        }
      }
    }
  );

  itUnless(noRust)('matches voicing and tone costs', async () => {
    const engine = await loadRustEngine();
    const { vs_whisper_voicing: voice, vs_whisper_tone_cost: tone } =
      engine.exports;
    for (const pair of WHISPER_CUES) {
      for (const [, [ratio], [level]] of pair) {
        const packet = [
          ratio,
          level,
          ...pair.flatMap(([, duration, db]) => [...duration, ...db]),
        ];
        const expected = whisperVoicingProbability(ratio, level, pair);
        expectClose(withPacket(engine, packet, voice), expected);
      }
    }
    const observed = [-31, -30, -29, -27, -30, -32, -31, -34, -30, -28];
    for (const levels of [[5], [3, 5], [2, 1, 4], [5, 1], []]) {
      const curve = toneCurve(levels, { count: 10, duration: 0.33 });
      const expected = whisperToneCost(observed, curve, 1.1, 1.2);
      expectClose(
        withPacket(engine, [...observed, ...curve, 1.1, 1.2], tone),
        expected
      );
    }
  });

  itUnless(noRust)(
    'matches pooled spectra and trajectory distances',
    async () => {
      const engine = await loadRustEngine();
      const { vs_whisper_pool: pool, vs_whisper_distance: distance } =
        engine.exports;
      const { samples, sampleRate } = renderWhisper('[whisper] a fresh fish');
      const frames = analyzeFrames(samples, sampleRate);
      const { count, melBands, mel } = frames;
      const pooled = poolLogPower(frames, 'mel', 0, count, melBands, 1);
      const out = engine.exports.vs_alloc(melBands * 8);
      try {
        withPacket(engine, mel.subarray(0, count * melBands), (ptr) => {
          for (const i of [0, 19, count - 1]) {
            expect(pool(ptr, count, melBands, i, 1, out)).toBe(0);
            float64View(engine, out, melBands).forEach((value, j) =>
              expectClose(Math.fround(value), pooled[i * melBands + j])
            );
          }
        });
      } finally {
        engine.exports.vs_free(out, melBands * 8);
      }
      const spectrum = whisperSpectrum(
        frames,
        0.05,
        samples.length / sampleRate
      );
      const width = melBands + 1;
      const input = new Float32Array(5 * width);
      const reference = new Float32Array(input.length);
      for (let i = 0; i < 5; i++) {
        spectrum.sample(0.06 + 0.03 * i, input, i * width);
        spectrum.sample(0.21 + 0.03 * i, reference, i * width);
      }
      withPacket(engine, [...input, ...reference], (ptr) => {
        for (const vowel of [false, true]) {
          expectClose(
            distance(ptr, width, Number(vowel)),
            whisperDistance(input, reference, width, vowel)
          );
        }
      });
    }
  );
});
