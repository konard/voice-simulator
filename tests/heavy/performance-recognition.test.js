/** Time 60 seconds of synthetic speech through the public recognizer (issue 77). */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { it as alwaysIt } from 'test-anywhere';
import { measureSingleCoreRecognition } from '../../experiments/issue-77-single-core.mjs';
import {
  duration,
  sampleRate as rate,
  recognitionFixture,
  timeRecognition,
} from '../../experiments/issue-77-worker-scaling.mjs';
import { noRust } from '../helpers/rust-engine.js';
import { itUnless } from '../helpers/skip.js';
import { writeReport } from './helpers/report.js';

const it = itUnless(noRust);
const cores = availableParallelism();
const physicalCores = linuxCoreCount();
const limits = { js: { 1: {} }, rust: { 1: {} } };
const rows = [];

function linuxCoreCount() {
  if (process.platform !== 'linux') {
    return undefined;
  }
  try {
    const status = readFileSync('/proc/self/status', 'utf8');
    const cpuList = /^Cpus_allowed_list:\s*(.+)$/m.exec(status)?.[1];
    if (!cpuList) {
      return undefined;
    }
    const ranges = cpuList
      .split(',')
      .map((range) => range.split('-').map(Number));
    const topology = execFileSync('lscpu', ['-p=CPU,CORE,SOCKET'], {
      encoding: 'utf8',
    });
    const socketsAndCores = new Set();
    for (const row of topology.split('\n')) {
      if (!/^\d+,\d+,\d+$/.test(row)) {
        continue;
      }
      const [cpu, core, socket] = row.split(',').map(Number);
      if (ranges.some(([first, last = first]) => first <= cpu && cpu <= last)) {
        socketsAndCores.add(`${socket}:${core}`);
      }
    }
    return socketsAndCores.size || undefined;
  } catch {
    return undefined;
  }
}

function report() {
  const header = [
    '# Recognition performance',
    '',
    `Voice simulator recognition of ${duration} s of synthetic speech at ${rate} Hz on ${cores} logical cores.`,
    ...(physicalCores
      ? [`The CPU affinity mask covers ${physicalCores} physical cores.`]
      : []),
    '',
    'Run `npm run test:heavy -- --suite performance` after building WebAssembly.',
    '',
    '| Engine | Level | Threads | Seconds | Real-time factor | CPU seconds |',
    '| --- | --- | ---: | ---: | ---: | ---: |',
  ];
  for (const { engine, level, threads, elapsed, cpu } of rows) {
    header.push(
      `| ${engine} | ${level} | ${threads} | ${elapsed.toFixed(3)} | ${(elapsed / duration).toFixed(3)} | ${cpu.toFixed(3)} |`
    );
  }
  writeReport('performance-recognition', header.join('\n'), {
    cores,
    physicalCores,
    duration,
    rate,
    rows,
  });
}

it('times engine, quality level and worker count on 60 seconds of speech', async () => {
  const samples = recognitionFixture();
  const threadCounts = cores >= 4 ? [1, 2, 4] : [1];
  for (const engine of ['js', 'rust']) {
    for (const threads of threadCounts) {
      for (const level of ['low', 'medium', 'high']) {
        const { elapsed, cpu, result } = await timeRecognition(samples, {
          engine,
          threads,
          level,
        });
        rows.push({ engine, level, threads, elapsed, cpu });
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
  (physicalCores ?? cores) < 4 &&
    `needs four cores, found ${physicalCores ?? cores} (${physicalCores ? 'physical' : 'logical'})`
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

const coldSkip = process.platform !== 'linux' && 'taskset requires Linux';
let coldMeasurements;
itUnless(noRust, coldSkip)(
  'the CLI engines return the same text on one core',
  () => {
    const rows = measureSingleCoreRecognition();
    const [rust, js] = rows;
    coldMeasurements = rows;
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
  }
);

itUnless(
  noRust,
  coldSkip,
  process.env.RECOGNITION_COLD_REPORT_ONLY === '1' &&
    'cold timing is reported here and gated on the default ubuntu-24.04 runner'
)(
  'the Rust CLI takes at most 0.25 seconds per second of audio on one core',
  () => {
    const [rust] = coldMeasurements ?? measureSingleCoreRecognition();
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
