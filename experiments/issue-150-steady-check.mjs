/* global structuredClone */
// Does a held row rendered through articulationPlan match its template?
import { items, voiceFor, codebookFor } from './issue-150-cache.mjs';
import { readFileSync } from 'node:fs';
import {
  analyzeFrames,
  articulationPlan,
  invertArticulation,
  renderPlan,
} from '../src/index.js';
import { cepstra, powerFrames } from '../src/metrics/spectrum.js';
import { templateOf, rowState } from './issue-150-templates.mjs';
const C = 13,
  S = 10 / Math.LN10;
const item = items.find((x) => x.id === 'hi-05');
const head = voiceFor(item),
  book = codebookFor(item, head);
const bytes = readFileSync(
  `/tmp/issue150-cache/${item.speaker.id}.templates.bin`
);
const tp = new Float32Array(
  bytes.buffer,
  bytes.byteOffset,
  bytes.byteLength / 4
);
const track = invertArticulation(analyzeFrames(item.samples, item.sampleRate), {
  voice: head,
  codebook: book,
});
for (const row of [100, 2000, 4000]) {
  const st = rowState(book, row);
  const tr = structuredClone(track);
  for (let t = 0; t < tr.frameCount; t++) {
    for (const [k, v] of Object.entries(st)) {
      tr.channels[k][t] = v;
    }
    Object.assign(tr.channels, {});
    tr.channels.voicing[t] = 1;
    tr.channels.aspiration[t] = 0;
    tr.channels.frication[t] = 0;
    tr.channels.sibilance[t] = 0;
    tr.channels.loudness[t] = 1;
    tr.channels.f0[t] = head.pitch;
    tr.channels.trill[t] = 0;
    tr.channels.glottalClosure[t] = 0;
    tr.channels.lateral[t] = 0;
  }
  const out = renderPlan(articulationPlan(tr), {
    sampleRate: 16000,
    solver: 'waveguide',
    engine: 'js',
    seed: 1,
  });
  const ct = cepstra(powerFrames(out, 16000), 16000);
  const again = templateOf(st, head, 16000);
  const d = (a, b) => {
    let s = 0;
    for (let k = 0; k < C; k++) {
      s += (a[k] - b[k]) ** 2;
    }
    return S * Math.sqrt(2 * s);
  };
  const mid = ct[Math.floor(ct.length / 2)].subarray(1, C + 1);
  console.log(
    row,
    'held vs stored template',
    d(mid, tp.subarray(row * C, row * C + C)).toFixed(2),
    'fresh vs stored',
    d(again, tp.subarray(row * C, row * C + C)).toFixed(2)
  );
}
console.log('track channel names', Object.keys(track.channels).length);
