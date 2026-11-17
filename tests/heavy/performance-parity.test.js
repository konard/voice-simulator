/** Single-thread parity speed gate for every capability and every audio tier. */
import { describe, expect, it as alwaysIt } from 'test-anywhere';
import { performance } from 'node:perf_hooks';
import { AUDIO_TIERS, ENGINE_FEATURES, createEngine } from '../../src/index.js';
import { prepareUtterance } from '../../src/synthesize.js';
import { prepareProbe } from '../helpers/engine-features.js';
import { noRust } from '../helpers/rust-engine.js';
import { itUnless } from '../helpers/skip.js';
import { heavyLimit, writeReport } from './helpers/report.js';

const it = itUnless(noRust);
const MINIMUM_MS = 2000;
const cases = [
  ...ENGINE_FEATURES.map((feature) => ({
    kind: 'feature',
    name: feature.id,
    prepare: () => prepareProbe(feature),
  })),
  ...AUDIO_TIERS.map((tier) => ({
    kind: 'tier',
    name: `tier.${tier.name}`,
    prepare: () =>
      prepareUtterance('A short test.', { tier: tier.name, seed: 82 }),
  })),
].slice(0, heavyLimit(Infinity));
const rows = [];

function measure(engine, plan, options) {
  const start = performance.now();
  const renderer = engine.createRenderer(plan, options);
  try {
    const samples = new Float32Array(renderer.totalSamples);
    renderer.render(samples);
    const milliseconds = performance.now() - start;
    expect(samples.length > 0 && samples.every(Number.isFinite)).toBe(true);
    return milliseconds;
  } finally {
    renderer.free?.();
  }
}

function medianRender(engine, plan, options) {
  measure(engine, plan, options); // Warm JIT/compiler and numerical caches.
  const runs = [];
  let elapsed = 0;
  while (elapsed < MINIMUM_MS || runs.length < 3) {
    const milliseconds = measure(engine, plan, options);
    runs.push(milliseconds);
    elapsed += milliseconds;
  }
  const sorted = [...runs].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  return { seconds: median / 1000, elapsedSeconds: elapsed / 1000, runs };
}

describe('engine parity performance', () => {
  for (const probe of cases) {
    it(`speed: ${probe.kind} ${probe.name}`, async () => {
      const js = await createEngine('js');
      const rust = await createEngine({
        engine: 'rust',
        threads: 1,
        simd: false,
      });
      const { plan, renderOptions } = probe.prepare();
      const reference = medianRender(js, plan, renderOptions);
      const compiled = medianRender(rust, plan, renderOptions);
      const ratio = compiled.seconds / reference.seconds;
      rows.push({
        kind: probe.kind,
        name: probe.name,
        duration: plan.duration,
        js: reference,
        rust: compiled,
        ratio,
      });
      expect(rust.fallbacks).toBe(0);
    });
  }
  alwaysIt('writes the report and enforces every ratio', () => {
    if (noRust) {
      return;
    }
    const markdown = [
      '# Engine parity: single-thread render times',
      '',
      `Node ${process.version}, ${process.platform} ${process.arch}; seed 82; scalar wasm, one thread. Includes renderer construction, frame preparation and samples. Each engine warms once, then renders for at least 2 seconds and at least 3 runs; times are medians. ${process.env.HEAVY_LIMIT ? 'Partial developer run.' : 'Every feature and every tier.'}`,
      '',
      '| Kind | Feature or tier | Audio (s) | JS (s) | Rust (s) | Rust / JS | Runs JS / Rust |',
      '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
      ...rows.map(
        (r) =>
          `| ${r.kind} | ${r.name} | ${r.duration.toFixed(3)} | ${r.js.seconds.toFixed(6)} | ${r.rust.seconds.toFixed(6)} | ${r.ratio.toFixed(4)} | ${r.js.runs.length} / ${r.rust.runs.length} |`
      ),
      '',
      'Command: `npm run test:heavy -- --suite performance` (built wasm required).',
      '',
    ].join('\n');
    writeReport('engine-parity', markdown, { rows });
    expect(rows.length).toBe(cases.length);
    const failures = rows
      .filter((row) => row.ratio > 1)
      .map(({ name, ratio }) => `${name}: ${ratio}`);
    expect(failures).toEqual([]);
  });
});
