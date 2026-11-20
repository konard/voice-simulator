/** Analysis-by-synthesis numerical parity. Unlicense. */
import assert from 'node:assert/strict';
import { planUtterance, renderPlan, scoreJob, warpPlan } from '../src/index.js';
import { float64View } from '../src/engine/wasm-loader.js';
import { timedCepstra } from '../src/recognition/rescoring-score.js';
import { loadRustEngine, noRust } from './helpers/rust-engine.js';
import { itUnless } from './helpers/skip.js';

const parity = itUnless(noRust);
const close = (a, b, tolerance) => {
  assert.ok(Math.abs(a - b) <= tolerance, `${a} versus ${b}`);
};

function withPacket(engine, input, capacity, call) {
  const { vs_alloc, vs_free } = engine.exports;
  const source = vs_alloc(input.length * 8);
  const output = vs_alloc(capacity * 8);
  try {
    float64View(engine, source, input.length).set(input);
    call(source, output, () => float64View(engine, output, capacity));
  } finally {
    vs_free(output, capacity * 8);
    vs_free(source, input.length * 8);
  }
}

parity(
  'matches Rust plan offsets, durations, and interpolated channel values',
  async () => {
    const engine = await loadRustEngine();
    const plan = planUtterance('adʒa');
    const anchors = [
      [0.06, 0.24],
      [0.18, 0.39],
      [0.3, 0.47],
    ];
    const { duration, offset, frameCount, channels } = warpPlan(plan, anchors);
    const input = [...anchors.flat(), ...plan.channels.height];
    withPacket(engine, input, frameCount + 2, (source, output, values) => {
      const result = engine.exports.vs_rescoring_warp(
        source,
        anchors.length,
        plan.frameCount,
        plan.duration,
        plan.frameRate,
        output,
        frameCount + 2
      );
      assert.equal(result, frameCount);
      const out = values();
      close(out[0], duration, 1e-12);
      close(out[1], offset, 1e-12);
      channels.height.forEach((value, index) =>
        close(out[index + 2], value, 1e-7)
      );
    });
  }
);

parity(
  'matches Rust cepstra and the regional DTW score at all working rates',
  async () => {
    const engine = await loadRustEngine();
    for (const rate of [8000, 11025, 16000]) {
      const { recording, reference } = cepstralPair(rate, engine);
      const rows = recording.length;
      const width = recording[0].length;
      const first = 6;
      const last = rows - 8;
      const bias = Float64Array.from(
        { length: width },
        (_, index) => index * 0.03 - 0.1
      );
      const expected = scoreJob({
        recording: { rows: recording, first, last },
        reference,
        bias,
      });
      const input = [bias, ...recording, ...reference].flatMap((row) =>
        Array.from(row)
      );
      withPacket(engine, input, 1, (source, output, values) => {
        assert.equal(
          engine.exports.vs_rescoring_score(
            source,
            rows,
            width,
            first,
            last,
            output
          ),
          0
        );
        close(values()[0], expected, 1e-8);
      });
    }
  }
);

parity('pools whisper rescoring spectra on the same grid', async () => {
  const engine = await loadRustEngine();
  const rate = 16000;
  const plan = planUtterance('ba {W la W}');
  const samples = renderPlan(plan, {
    solver: 'waveguide',
    seed: 1,
    sampleRate: rate,
    engine: 'js',
  });
  const base = timedCepstra(samples, rate, 0);
  const from = 8;
  const to = 23;
  const { rows } = timedCepstra(samples, rate, 0, [
    { start: base.start + from * base.step, end: base.start + to * base.step },
  ]);
  const width = rows[0].length;
  const capacity = rows.length * width;
  assert.notDeepEqual(rows[from + 2], base.rows[from + 2]);
  const packet = new Float64Array(samples.length + 2);
  packet.set(samples);
  packet.set([from, to], samples.length);
  withPacket(engine, packet, capacity, (source, output, values) => {
    assert.equal(
      engine.exports.vs_rescoring_whisper_mfcc(
        source,
        samples.length,
        rate,
        1,
        output,
        capacity
      ),
      rows.length
    );
    const out = values();
    rows.forEach((row, i) =>
      row.forEach((value, j) => close(out[i * width + j], value, 1e-8))
    );
  });
});

function cepstralPair(rate, engine) {
  const [recording, reference] = ['bala', 'pala'].map((ipa) => {
    const plan = planUtterance(ipa, { durations: [0.1, 0.15, 0.1, 0.15] });
    const samples = renderPlan(plan, {
      solver: 'waveguide',
      seed: 1,
      sampleRate: rate,
      engine: 'js',
    });
    const { rows } = timedCepstra(samples, rate, 0);
    const width = rows[0].length;
    const capacity = rows.length * width;
    withPacket(engine, samples, capacity, (source, output, values) => {
      assert.equal(
        engine.exports.vs_rescoring_mfcc(
          source,
          samples.length,
          rate,
          output,
          capacity
        ),
        rows.length
      );
      const out = values();
      rows.forEach((row, i) =>
        row.forEach((value, j) => close(out[i * width + j], value, 1e-8))
      );
    });
    return rows;
  });
  assert.equal(recording.length, reference.length);
  return { recording, reference };
}
