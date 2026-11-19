// Frame level of the render-back against the recording (issue 150).
import { items, voiceFor, codebookFor } from './issue-150-cache.mjs';
import * as variants from './issue-150-variants.mjs';
import { powerFrames } from '../src/metrics/spectrum.js';
import { normalizeRms, silentFrames } from '../src/metrics/distortion.js';
const name = process.argv[2] ?? 'baseline';
for (const id of process.argv.slice(3)) {
  const item = items.find((x) => x.id === id);
  const head = voiceFor(item),
    book = codebookFor(item, head);
  const out = variants[name](item, head, book);
  const fr = powerFrames(normalizeRms(item.samples), 16000),
    ft = powerFrames(normalizeRms(out), 16000);
  const sil = silentFrames(fr),
    silT = silentFrames(ft);
  const db = (f) => 10 * Math.log10(f.reduce((a, b) => a + b, 0) + 1e-20);
  const pts = [];
  for (let i = 0; i < Math.min(fr.length, ft.length); i++) {
    if (!sil[i]) {
      pts.push([db(fr[i]), db(ft[i])]);
    }
  }
  const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length,
    my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (const [x, y] of pts) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  console.log(
    id,
    'frames',
    pts.length,
    'ref sd',
    Math.sqrt(sxx / pts.length).toFixed(1),
    'ren sd',
    Math.sqrt(syy / pts.length).toFixed(1),
    'corr',
    (sxy / Math.sqrt(sxx * syy)).toFixed(2),
    'slope',
    (sxy / sxx).toFixed(2),
    'render silent among scored',
    silT.filter((s, i) => s && !sil[i]).length
  );
}
