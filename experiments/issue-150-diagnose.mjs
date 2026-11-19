// Decompose golden-set render-back distortion of one utterance (issue 150).
// Usage: node experiments/issue-150-diagnose.mjs [id]
import {
  analyzeFrames,
  articulationPlan,
  buildCodebook,
  fitVoice,
  invertArticulation,
  melCepstralDistortion,
  renderPlan,
} from '../src/index.js';
import { powerFrames, cepstra } from '../src/metrics/spectrum.js';
import { normalizeRms, silentFrames } from '../src/metrics/distortion.js';
import { loadGolden } from '../tests/helpers/golden.js';

const id = process.argv[2] ?? 'hi-05';
const items = loadGolden();
const item = items.find((x) => x.id === id);
const same = items.filter((x) => x.speaker.id === item.speaker.id);
const sr = item.sampleRate;
const sil = Math.round(0.25 * sr);
const joined = new Float32Array(
  same.reduce((s, x) => s + x.samples.length + sil, 0)
);
let at = 0;
for (const x of same) {
  joined.set(x.samples, at);
  at += x.samples.length + sil;
}
const t0 = Date.now();
const head = fitVoice(joined, sr, { language: item.lang, refine: false }).head;
const codebook = buildCodebook(head, { size: 5000, cache: new Map() });
const frames = analyzeFrames(item.samples, sr);
const track = invertArticulation(frames, { voice: head, codebook });
const plan = articulationPlan(track);
const rendered = renderPlan(plan, {
  sampleRate: sr,
  solver: 'waveguide',
  engine: 'js',
  seed: 1,
});
console.log(
  'time',
  (Date.now() - t0) / 1000,
  's; samples',
  item.samples.length,
  'rendered',
  rendered.length
);
console.log('MCD', melCepstralDistortion(item.samples, rendered, sr));
const fr = powerFrames(normalizeRms(item.samples), sr);
const ft = powerFrames(normalizeRms(rendered), sr);
const cr = cepstra(fr, sr),
  ct = cepstra(ft, sr);
const silR = silentFrames(fr),
  silT = silentFrames(ft);
const n = Math.min(fr.length, ft.length);
const per = [];
for (let i = 0; i < n; i++) {
  if (silR[i]) {
    continue;
  }
  let s = 0;
  for (let k = 1; k < cr[i].length; k++) {
    s += (cr[i][k] - ct[i][k]) ** 2;
  }
  per.push({
    i,
    d: 4.3429 * Math.sqrt(2 * s),
    silT: silT[i],
    eR: 10 * Math.log10(fr[i].reduce((a, b) => a + b, 0)),
    eT: 10 * Math.log10(ft[i].reduce((a, b) => a + b, 1e-30)),
    conf: track.confidence?.[Math.round(i * 2)],
  });
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
console.log(
  'scored frames',
  per.length,
  'rendered-silent among them',
  per.filter((p) => p.silT).length
);
console.log(
  'mean MCD where rendered silent',
  mean(per.filter((p) => p.silT).map((p) => p.d)),
  'else',
  mean(per.filter((p) => !p.silT).map((p) => p.d))
);
// mean cepstra difference (long-term spectral shape / channel)
const mc = (c, idx) =>
  Array.from({ length: 14 }, (_, k) => mean(idx.map((i) => c[i][k])));
const idx = per.filter((p) => !p.silT).map((p) => p.i);
const mr = mc(cr, idx),
  mt = mc(ct, idx);
console.log('mean cep ref', mr.map((v) => v.toFixed(2)).join(' '));
console.log('mean cep ren', mt.map((v) => v.toFixed(2)).join(' '));
let s = 0;
for (let k = 1; k < 14; k++) {
  s += (mr[k] - mt[k]) ** 2;
}
console.log(
  'MCD of mean cepstra (channel/tilt part)',
  4.3429 * Math.sqrt(2 * s)
);
// after removing mean (CMN)
const cmn = per
  .filter((p) => !p.silT)
  .map(({ i }) => {
    let s = 0;
    for (let k = 1; k < 14; k++) {
      s += (cr[i][k] - mr[k] - (ct[i][k] - mt[k])) ** 2;
    }
    return 4.3429 * Math.sqrt(2 * s);
  });
console.log('MCD after mean-cepstrum removal', mean(cmn));
// reference self-variation: MCD of ref against its own mean cepstrum
console.log(
  'MCD of ref vs own mean',
  mean(
    idx.map((i) => {
      let s = 0;
      for (let k = 1; k < 14; k++) {
        s += (cr[i][k] - mr[k]) ** 2;
      }
      return 4.3429 * Math.sqrt(2 * s);
    })
  )
);
console.log('track channels', Object.keys(plan.channels).join(','));
for (const name of [
  'height',
  'backness',
  'velum',
  'voicing',
  'f0',
  'lipArea',
  'tongueArea',
  'noise',
  'aspiration',
]) {
  const c = plan.channels[name];
  if (c) {
    console.log(
      name,
      'mean',
      mean(Array.from(c)).toFixed(3),
      'min',
      Math.min(...c).toFixed(3),
      'max',
      Math.max(...c).toFixed(3)
    );
  }
}
