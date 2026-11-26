// Which recognition data holds the JS heap at 8 kHz (issue 81). Unlicense.
// Usage: node --expose-gc experiments/issue-81-heap.mjs [languages,comma]
const heap = () => {
  globalThis.gc?.();
  return (process.memoryUsage().heapUsed / 2 ** 20).toFixed(0);
};
const { synthesize, recognize } = await import('../src/index.js');
const langs = process.argv[2] ? process.argv[2].split(',') : undefined;
const out = synthesize('Hello world.', { tier: 'telephone', engine: 'js' });
console.log('before', heap(), 'MB');
const r = recognize(out.samples, out.sampleRate, {
  level: 'low',
  engine: 'js',
  ...(langs ? { languages: langs } : {}),
});
console.log(
  'after',
  heap(),
  'MB',
  JSON.stringify(r.text),
  'rss',
  (process.resourceUsage().maxRSS / 1024).toFixed(0)
);
