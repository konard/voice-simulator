/**
 * Rank each reference phone against every substitution by full re-synthesis
 * error with an approximate (preset mean) head. Unlicense.
 * node experiments/issue-75-substitution-ranks.mjs [lang] [index] [tier] [preset]
 */
import { synthesize } from '../src/index.js';
import { performance } from 'node:perf_hooks';
import { presetHeadConfig } from '../src/head-config.js';
import { mfcc } from '../src/metrics/spectrum.js';
import { PHONOTACTICS } from '../src/recognition/phonotactics.js';
import { sentences } from '../tests/helpers/roundtrip.js';

const [
  lang = 'en',
  index = '17',
  tier = 'telephone',
  preset = 'male',
  headMode = 'mean',
] = process.argv.slice(2);
const opts = { window: 0.025, hop: 0.01, coefficients: 12 };
export function feats(s) {
  const rows = mfcc(s.samples, s.sampleRate, opts);
  const mean = new Float64Array(13);
  for (const r of rows) {
    for (let j = 0; j < 13; j++) {
      mean[j] += r[j] / rows.length;
    }
  }
  return rows.map((r) => r.map((v, j) => v - mean[j]));
}
function dist(a, b) {
  let d = 0;
  for (let j = 1; j <= 12; j++) {
    d += (a[j] - b[j]) ** 2;
  }
  return d / 12;
}
export function dtw(x, y) {
  const n = x.length,
    m = y.length;
  const INF = 1e18;
  let prev = new Float64Array(m + 1).fill(INF);
  prev[0] = 0;
  let prevL = new Float64Array(m + 1);
  for (let i = 1; i <= n; i++) {
    const cur = new Float64Array(m + 1).fill(INF);
    const curL = new Float64Array(m + 1);
    for (let j = 1; j <= m; j++) {
      const c = dist(x[i - 1], y[j - 1]);
      let best = prev[j - 1],
        L = prevL[j - 1];
      if (prev[j] < best) {
        best = prev[j];
        L = prevL[j];
      }
      if (cur[j - 1] < best) {
        best = cur[j - 1];
        L = curL[j - 1];
      }
      cur[j] = best + c;
      curL[j] = L + 1;
    }
    prev = cur;
    prevL = curL;
  }
  return prev[m] / prevL[m];
}
export function splitIpa(ipa, units) {
  const sorted = [...units].sort((a, b) => b.length - a.length);
  const pieces = [];
  let i = 0;
  while (i < ipa.length) {
    const unit = sorted.find((u) => ipa.startsWith(u, i));
    if (unit) {
      let j = i + unit.length;
      while (['ː', 'ˑ', '\u0303'].includes(ipa[j])) {
        j++;
      }
      pieces.push({ phone: true, text: ipa.slice(i, j), base: unit });
      i = j;
    } else {
      pieces.push({ phone: false, text: ipa[i] });
      i++;
    }
  }
  return pieces;
}
const text = sentences[lang][Number(index)];
const input = synthesize(text, { lang, tier, head: 'random', preset, seed: 1 });
const x = feats(input);
const head = headMode === 'exact' ? input.head : presetHeadConfig(preset);
const units = PHONOTACTICS[lang].units;
const pieces = splitIpa(input.ipa, units);
const render = (ipa) =>
  dtw(x, feats(synthesize(ipa, { ipa: true, lang, tier, head, seed: 7 })));
const base = render(input.ipa);
console.log(input.ipa, 'base', base.toFixed(3));
let first = 0,
  total = 0;
const t0 = performance.now();
pieces.forEach((piece, k) => {
  if (!piece.phone) {
    return;
  }
  const scores = [];
  for (const u of [...units, '']) {
    if (u === piece.base) {
      continue;
    }
    const ipa = pieces
      .map((p, j) => (j === k ? p.text.replace(piece.base, u) : p.text))
      .join('');
    scores.push([u || '∅', render(ipa)]);
  }
  scores.sort((a, b) => a[1] - b[1]);
  const rank = scores.filter(([, s]) => s < base).length;
  total++;
  first += rank === 0;
  console.log(
    piece.text,
    'rank',
    rank,
    'margin',
    (scores[0][1] - base).toFixed(3),
    scores
      .slice(0, 3)
      .map(([u, s]) => `${u}:${s.toFixed(3)}`)
      .join(' ')
  );
});
console.log(
  `first ${first}/${total} in ${((performance.now() - t0) / 1000).toFixed(1)} s`
);
