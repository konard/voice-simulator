/* global structuredClone */
// Predicted (template) vs rendered per-frame MCD along the template path.
import { items, voiceFor, codebookFor } from './issue-150-cache.mjs';
import { readFileSync } from 'node:fs';
import {
  analyzeFrames,
  articulationPlan,
  invertArticulation,
  renderPlan,
  CODEBOOK_CHANNELS,
} from '../src/index.js';
import { cepstra, powerFrames } from '../src/metrics/spectrum.js';
import { normalizeRms, silentFrames } from '../src/metrics/distortion.js';
import { templatePath } from './issue-150-variants.mjs';
const C = 13,
  S = 10 / Math.LN10,
  W = CODEBOOK_CHANNELS.length;
const item = items.find((x) => x.id === (process.argv[2] ?? 'hi-05'));
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
const choice = templatePath(item, head, book);
const track = invertArticulation(analyzeFrames(item.samples, item.sampleRate), {
  voice: head,
  codebook: book,
});
const variants = {
  inverted: track,
  templateTract: structuredClone(track),
};
for (let t = 0; t < track.frameCount; t++) {
  const i = Math.round((t * 0.005 - 0.0125) / 0.01);
  if (i < 0 || i >= choice.length || choice[i] < 0) {
    continue;
  }
  CODEBOOK_CHANNELS.forEach(({ name, min, max }, c) => {
    variants.templateTract.channels[name][t] =
      min + (book.articulation[choice[i] * W + c] / 255) * (max - min);
  });
}
// voiced-only source: voicing 1, no noise, loudness 1 where speech
const v = structuredClone(variants.templateTract);
for (let t = 0; t < v.frameCount; t++) {
  v.channels.voicing[t] = 1;
  v.channels.aspiration[t] = 0;
  v.channels.frication[t] = 0;
  v.channels.sibilance[t] = 0;
  v.channels.loudness[t] = 1;
  v.channels.f0[t] = head.pitch;
}
variants.templateVoicedFlat = v;
const ref = powerFrames(normalizeRms(item.samples), item.sampleRate);
const cr = cepstra(ref, item.sampleRate);
const sil = silentFrames(ref);
let pred = 0,
  n = 0;
for (let i = 0; i < cr.length; i++) {
  if (sil[i] || choice[i] < 0) {
    continue;
  }
  let s = 0;
  for (let k = 0; k < C; k++) {
    s += (cr[i][k + 1] - tp[choice[i] * C + k]) ** 2;
  }
  pred += S * Math.sqrt(2 * s);
  n++;
}
console.log('predicted path MCD', (pred / n).toFixed(2));
for (const [name, tr] of Object.entries(variants)) {
  const out = renderPlan(articulationPlan(tr), {
    sampleRate: item.sampleRate,
    solver: 'waveguide',
    engine: 'js',
    seed: 1,
  });
  const ct = cepstra(
    powerFrames(normalizeRms(out), item.sampleRate),
    item.sampleRate
  );
  let a = 0,
    m = 0,
    b = 0;
  for (let i = 0; i < Math.min(cr.length, ct.length); i++) {
    if (sil[i]) {
      continue;
    }
    let s = 0,
      s2 = 0;
    for (let k = 1; k <= C; k++) {
      s += (cr[i][k] - ct[i][k]) ** 2;
      if (choice[i] >= 0) {
        s2 += (ct[i][k] - tp[choice[i] * C + k - 1]) ** 2;
      }
    }
    a += S * Math.sqrt(2 * s);
    b += S * Math.sqrt(2 * s2);
    m++;
  }
  console.log(
    name,
    'MCD vs ref',
    (a / m).toFixed(2),
    'render vs its templates',
    (b / m).toFixed(2)
  );
}
