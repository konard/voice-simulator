// Prints the strongest Oculus, ARKit and VRM weights over a sentence:
// node experiments/issue-9-visemes-probe.mjs "$PWD" ['text'] [preset]
const R = process.argv[2];
const { prepareUtterance } = await import(`${R}/src/synthesize.js`);
const V = await import(`${R}/src/animation/visemes.js`);
const p = prepareUtterance(
  process.argv[3] ?? 'Hello, mama. Fifty thin shoes.',
  { preset: process.argv[4] ?? 'male', seed: 1 }
);
const top = (w, n = 3) =>
  Object.entries(w)
    .filter(([, v]) => v > 0.01)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k}:${v.toFixed(2)}`)
    .join(' ');
for (const fmt of ['oculus', 'arkit', 'vrm']) {
  const tr = V.visemeTrack(p.plan, p.head, { fps: 20, format: fmt });
  console.log('==', fmt, tr.frames.length);
  for (const f of tr.frames) {
    const seg = p.plan.segments.find(
      (g) => g.start <= f.time && f.time < g.end
    );
    console.log(
      f.time.toFixed(2),
      (seg?.token?.phoneme?.symbol ?? seg?.kind ?? '-').padEnd(6),
      top(f.weights, 4)
    );
  }
}
