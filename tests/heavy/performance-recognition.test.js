/** Time 60 seconds of synthetic speech through the public recognizer (issue 77). */
import assert from 'node:assert/strict';
import { availableParallelism } from 'node:os';
import { performance } from 'node:perf_hooks';
import { it as alwaysIt } from 'test-anywhere';
import { recognizeAsync, synthesize } from '../../src/index.js';
import { resample } from '../../src/audio/resample.js';
import { measureSingleCoreRecognition } from '../../experiments/issue-77-single-core.mjs';
import { noRust } from '../helpers/rust-engine.js';
import { itUnless } from '../helpers/skip.js';
import { writeReport } from './helpers/report.js';

const it = itUnless(noRust);
const cores = availableParallelism();
const duration = 60;
const rate = 16000;
const limits = { js: { 1: {} }, rust: { 1: {} } };
const rows = [];

function fixture() {
  const { samples, sampleRate } = synthesize(
    'The quick brown fox jumps over the lazy dog.',
    { tier: 'minimal', seed: 1, engine: 'js' }
  );
  const phrase = resample(samples, sampleRate, rate);
  const input = new Float32Array(duration * rate);
  const step = phrase.length + Math.round(0.35 * rate);
  for (let at = 0; at + phrase.length < input.length; at += step) {
    input.set(phrase, at);
  }
  return input;
}

function report() {
  const header = [
    '# Recognition performance',
    '',
    `Voice simulator recognition of ${duration} s of synthetic speech at ${rate} Hz on ${cores} logical cores.`,
    '',
    'Run `npm run test:heavy -- --suite performance` after building WebAssembly.',
    '',
    '| Engine | Level | Threads | Seconds | Real-time factor |',
    '| --- | --- | ---: | ---: | ---: |',
  ];
  for (const { engine, level, threads, elapsed } of rows) {
    header.push(
      `| ${engine} | ${level} | ${threads} | ${elapsed.toFixed(3)} | ${(elapsed / duration).toFixed(3)} |`
    );
  }
  writeReport('performance-recognition', header.join('\n'), {
    cores,
    duration,
    rate,
    rows,
  });
}

it('times engine, quality level and worker count on 60 seconds of speech', async () => {
  const samples = fixture();
  const threadCounts = cores >= 4 ? [1, 2, 4] : [1];
  for (const engine of ['js', 'rust']) {
    for (const threads of threadCounts) {
      for (const level of ['low', 'medium', 'high']) {
        const started = performance.now();
        const result = await recognizeAsync(samples, rate, {
          engine,
          threads,
          level,
          languages: ['en'],
        });
        const elapsed = (performance.now() - started) / 1000;
        rows.push({ engine, level, threads, elapsed });
        report();
        const byThread = (limits[engine][threads] ??= {});
        byThread[level] = elapsed;
        assert.ok(result.ipa.length > 0);
      }
    }
  }
});

const verifyScaling = itUnless(
  noRust,
  cores < 4 && `needs four logical cores, found ${cores}`
);
verifyScaling(
  'Rust high recognition with four workers is at least 1.8 times faster',
  () => {
    const serial = limits.rust[1].high;
    const parallel = limits.rust[4]?.high;
    assert.ok(
      serial && parallel,
      'run the recognition performance matrix before checking scaling'
    );
    assert.ok(
      serial / parallel >= 1.8,
      `four-worker speedup was ${(serial / parallel).toFixed(2)}x`
    );
  }
);

itUnless(noRust, process.platform !== 'linux' && 'taskset requires Linux')(
  'the Rust CLI engine returns the same text and runs at at most 0.25 RTF on one core',
  () => {
    const rows = measureSingleCoreRecognition();
    const [rust, js] = rows;
    writeReport(
      'performance-recognition-single-core',
      [
        '# One-core recognition at 8000 Hz',
        '',
        'Cold runs of `taskset -c <core> node bin/voice-simulator.js recognize fox.wav --level low --engine <rust|js> --threads 1`.',
        '',
        '| Engine | Audio seconds | Elapsed seconds | Real-time factor |',
        '| --- | ---: | ---: | ---: |',
        ...rows.map(
          ({ engine, duration, elapsed, rtf }) =>
            `| ${engine} | ${duration.toFixed(3)} | ${elapsed.toFixed(3)} | ${rtf.toFixed(3)} |`
        ),
      ].join('\n'),
      rows
    );
    assert.ok(rust.text);
    assert.equal(rust.text, js.text);
    assert.ok(rust.rtf <= 0.25, `Rust ran at ${rust.rtf.toFixed(3)} RTF`);
  }
);

if (noRust) {
  alwaysIt('writes the reason for skipping the recognition matrix', () => {
    writeReport(
      'performance-recognition',
      `# Recognition performance\n\nSkipped: ${noRust}`,
      { skipped: noRust }
    );
  });
}
