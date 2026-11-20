/** Rust and JavaScript whisper classification on shared acoustic frames. Unlicense. */
import { describe, expect } from 'test-anywhere';
import {
  analyzeFrames,
  findWhisper,
  resample,
  trackPitch,
} from '../src/index.js';
import { float64View } from '../src/engine/wasm-loader.js';
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
});
