// Peak resident memory after each step at 8 kHz (issue 81). Unlicense.
const rss = () => (process.resourceUsage().maxRSS / 1024).toFixed(0);
console.log('start', rss());
const { synthesize, recognize } = await import('../src/index.js');
console.log('import', rss());
const out = synthesize('Hello world.', { tier: 'telephone', engine: process.argv[2] || 'js' });
console.log('synthesize', rss(), 'heap', (process.memoryUsage().heapUsed / 2 ** 20).toFixed(0));
recognize(out.samples, out.sampleRate, { level: 'low', engine: process.argv[2] || 'js' });
console.log('recognize', rss(), 'heap', (process.memoryUsage().heapUsed / 2 ** 20).toFixed(0));
recognize(out.samples, out.sampleRate, { level: 'low', engine: process.argv[2] || 'js' });
console.log('recognize again', rss());
