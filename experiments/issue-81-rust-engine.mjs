// Does the scalar single-thread Rust engine load, and which engine renders (issue 81)? Unlicense.
const { createEngine, synthesize, recognize, getRecognitionEngine } =
  await import('../src/index.js');
const engine = await createEngine({ engine: 'rust', threads: 1, simd: false });
console.log(
  'engine',
  engine.name,
  engine.reason ?? null,
  engine.threads,
  engine.simd
);
const t = process.cpuUsage();
const out = synthesize('Hello world, this is a test of the telephone tier.', {
  tier: 'telephone',
  engine,
  lang: 'en',
});
const c = process.cpuUsage(t);
console.log(
  'synth',
  out.sampleRate,
  out.samples.length / out.sampleRate,
  'cpu',
  (c.user + c.system) / 1e6,
  Object.keys(out),
  out.engine ?? out.renderer
);
const r = recognize(out.samples, out.sampleRate, {
  level: 'low',
  engine: 'rust',
});
console.log(
  r.text,
  typeof getRecognitionEngine === 'function'
    ? getRecognitionEngine({ engine: 'rust' })
    : 'n/a'
);
