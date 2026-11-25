// Summarise the JS heap retained after one 8 kHz recognition (issue 81). Unlicense.
// Usage: node --expose-gc experiments/issue-81-heap-snapshot.mjs [language]
import v8 from 'node:v8';
import fs from 'node:fs';
const { synthesize, recognize } = await import('../src/index.js');
const out = synthesize('Hello world.', { tier: 'telephone', engine: 'js' });
recognize(out.samples, out.sampleRate, { level: 'low', engine: 'js', languages: [process.argv[2] || 'en'] });
globalThis.gc?.();
const file = v8.writeHeapSnapshot('/tmp/issue-81.heapsnapshot');
const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
const m = snap.snapshot.meta; const F = m.node_fields.length;
const iType = m.node_fields.indexOf('type'), iName = m.node_fields.indexOf('name'), iSize = m.node_fields.indexOf('self_size');
const types = m.node_types[0]; const by = new Map();
for (let i = 0; i < snap.nodes.length; i += F) {
  const t = types[snap.nodes[i + iType]]; const n = snap.strings[snap.nodes[i + iName]];
  const key = t === 'object' || t === 'native' ? `${t}:${n}` : t;
  const e = by.get(key) ?? [0, 0]; e[0] += snap.nodes[i + iSize]; e[1]++; by.set(key, e);
}
for (const [k, [s, c]] of [...by].sort((a, b) => b[1][0] - a[1][0]).slice(0, 25)) console.log((s / 2 ** 20).toFixed(1).padStart(7), 'MB', String(c).padStart(9), k.slice(0, 60));
fs.rmSync(file);
