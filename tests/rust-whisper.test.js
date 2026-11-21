/** Rust and JavaScript whisper classification on shared acoustic frames. Unlicense. */
import { describe, expect } from 'test-anywhere';
import {
  analyzeFrames,
  findWhisper,
  resample,
  synthesize,
  trackPitch,
} from '../src/index.js';
import { float64View } from '../src/engine/wasm-loader.js';
import { toneCurve } from '../src/articulation/tone-model.js';
import { WHISPER_CUES } from '../src/recognition/data/whisper-cues.js';
import { whisperDistance } from '../src/recognition/whisper-decode.js';
import { whisperVoicingProbability } from '../src/recognition/whisper-result.js';
import {
  poolLogPower,
  poolPowerFrames,
  whisperFormantFrames,
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
  const rowsEnd = 4 + samples.length + frames.count * 4;
  const packet = new Float64Array(rowsEnd + frames.count);
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
  packet.set(frames.periodicity.subarray(0, frames.count), rowsEnd);
  return packet;
}

function checkSpans(engine, packet, samples, expected) {
  const {
    vs_alloc: alloc,
    vs_free: free,
    vs_find_whisper_periodic: find,
  } = engine.exports;
  const input = alloc(packet.byteLength);
  const output = alloc(96);
  try {
    float64View(engine, input, packet.length).set(packet);
    const count = find(
      input,
      samples,
      (packet.length - samples - 4) / 5,
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

function whisperFrameParity(engine, wave, rate, options) {
  const frames = analyzeFrames(wave, rate, options);
  const pitch = trackPitch(frames);
  const expected = findWhisper(wave, rate, frames, pitch);
  checkSpans(
    engine,
    packetOf(wave, frames, pitch, rate),
    wave.length,
    expected
  );
  return expected;
}

itUnless(noRust)(
  'matches spans detected on a partial continuous whisper',
  async () => {
    const engine = await loadRustEngine();
    const { samples, sampleRate, timeline } = renderWhisper(
      'one two three [whisper] four five six'
    );
    const wave = samples.subarray(
      0,
      Math.floor((timeline.words[3].start + 0.5) * sampleRate)
    );
    expect(whisperFrameParity(engine, wave, sampleRate).length).toBe(1);
  }
);

itUnless(noRust)(
  'rejects a weak periodic gap on telephone speech',
  async () => {
    const engine = await loadRustEngine();
    const { samples, sampleRate } = synthesize('Привет, как дела?', {
      lang: 'ru',
      tier: 'telephone',
      head: 'random',
      preset: 'male',
      seed: 1,
    });
    expect(
      whisperFrameParity(engine, samples, sampleRate, { hop: 0.01 })
    ).toEqual([]);
  }
);

itUnless(noRust)('matches interrupted telephone whispers', async () => {
  const engine = await loadRustEngine();
  const { samples, sampleRate } = synthesize(
    '[whisper]Съешь же ещё этих мягких французских булок, да выпей чаю.[/whisper]',
    {
      lang: 'ru',
      tier: 'telephone',
      head: 'random',
      preset: 'male',
      seed: 1,
      markup: true,
    }
  );
  expect(
    whisperFrameParity(engine, samples, sampleRate, { hop: 0.01 }).length
  ).toBe(1);
});

describe('Rust whisper numerical parity', () => {
  itUnless(noRust)(
    'matches whisper spans on voiced, whispered, mixed and noisy narrowband speech',
    async () => {
      const engine = await loadRustEngine();
      for (const text of [
        'a fresh fish',
        '[whisper] a fresh fish',
        'one two three [whisper] four five six',
        'one two three [whisper] we are here[/whisper] we are ready',
      ]) {
        const { samples, sampleRate } = renderWhisper(text);
        for (const [wave, rate] of [
          [samples, sampleRate],
          [noiseBelow(resample(samples, sampleRate, 8000), -20), 8000],
        ]) {
          whisperFrameParity(engine, wave, rate);
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

  itUnless(noRust)(
    'matches pooled autocorrelation for whisper formants',
    async () => {
      const engine = await loadRustEngine();
      const wave = renderWhisper('[whisper] sea foam');
      const frames = analyzeFrames(wave.samples, wave.sampleRate);
      const { order, window, rate, hop, count, sampleCount, samples } = frames;
      const smoothed = whisperFormantFrames(frames, [
        { start: 0, end: (count - 1) * hop },
      ]);
      const width = 1 + order * 2;
      const size = width * 8;
      const output = engine.exports.vs_alloc(size);
      try {
        const input = new Float64Array(sampleCount + 1);
        input[0] = hop * rate;
        input.set(samples.subarray(0, sampleCount), 1);
        withPacket(engine, input, (ptr) => {
          for (const center of [0, 19, count - 2]) {
            const first = Math.max(0, center - 2);
            const last = Math.min(count - 1, center + 3);
            expect(
              engine.exports.vs_whisper_lpc(
                ptr,
                sampleCount,
                first,
                last - first,
                Math.round(window * rate),
                order,
                output
              )
            ).toBe(0);
            const begin = center * order;
            const end = begin + order;
            const expected = [
              smoothed.gain[center],
              ...smoothed.lpc.subarray(begin, end),
              ...smoothed.reflection.subarray(begin, end),
            ];
            float64View(engine, output, width).forEach((value, i) =>
              expectClose(value, expected[i], 2e-6)
            );
          }
        });
      } finally {
        engine.exports.vs_free(output, size);
      }
    }
  );
});

itUnless(noRust)(
  'pools linear power for whispered verifier references',
  async () => {
    const engine = await loadRustEngine();
    const { vs_whisper_pool: pool } = engine.exports;
    const power = [
      [2, 1],
      [1, 4],
      [0, 2],
      [3, 0],
      [6, 4],
      [1, 5],
    ];
    const averaged = poolPowerFrames(power);
    const output = engine.exports.vs_alloc(2 * 8);
    try {
      withPacket(engine, power.flat(), (ptr) => {
        for (const [i, row] of averaged.entries()) {
          expect(pool(ptr, power.length, row.length, i, 0, output)).toBe(0);
          expect(float64View(engine, output, row.length)).toEqual(row);
        }
      });
    } finally {
      engine.exports.vs_free(output, 2 * 8);
    }
  }
);
