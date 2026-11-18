// Unlicense. Issue 63: self time per function of the newest .cpuprofile in a
// directory. Usage: node profile-summary.cjs DIR [N]
const fs = require('fs');
const dir = process.argv[2];
const file = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.cpuprofile'))
  .sort()
  .pop();
const p = JSON.parse(fs.readFileSync(`${dir}/${file}`, 'utf8'));
const time = {};
p.samples.forEach(
  (s, i) => (time[s] = (time[s] || 0) + (p.timeDeltas[i] || 0))
);
const self = {};
let total = 0;
for (const n of p.nodes) {
  const f = n.callFrame;
  const k = `${f.functionName || '(anonymous)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
  self[k] = (self[k] || 0) + (time[n.id] || 0);
  total += time[n.id] || 0;
}
console.log(`total ${(total / 1e6).toFixed(2)} s`);
for (const [k, v] of Object.entries(self)
  .sort((a, b) => b[1] - a[1])
  .slice(0, Number(process.argv[3] ?? 30))) {
  console.log(
    `${(v / 1e3).toFixed(0).padStart(7)} ms ${((100 * v) / total).toFixed(1).padStart(5)}% ${k}`
  );
}
