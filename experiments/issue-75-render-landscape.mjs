/** How render error separates head and phone hypotheses. Unlicense. */
import { synthesize } from '../src/index.js';
import { presetHeadConfig } from '../src/head-config.js';
import { mfcc } from '../src/metrics/spectrum.js';

const opts = { window: 0.025, hop: 0.01, coefficients: 12 };
function feats(s) {
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
function dtw(x, y) {
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
const tier = process.argv[2] ?? 'telephone';
const input = synthesize('Is this your pen or mine?', {
  lang: 'en',
  tier,
  head: 'random',
  preset: 'male',
  seed: 1,
});
const x = feats(input);
const ipa = input.ipa;
const heads = {
  exact: input.head,
  male: presetHeadConfig('male'),
  female: presetHeadConfig('female'),
  child: presetHeadConfig('child'),
};
const variants = {
  exact: ipa,
  'ɪz→iz': ipa.replace('ɪz', 'iz'),
  'pɛn→bɛn': ipa.replace('pɛn', 'bɛn'),
  'pɛn→pæn': ipa.replace('pɛn', 'pæn'),
  'maɪn→naɪn': ipa.replace('maɪn', 'naɪn'),
  'ðɪs→ðɪz': ipa.replace('ðɪs', 'ðɪz'),
  'drop jɚ': ipa.replace('jɚ ', ''),
  statement: ipa.replace('↘ ?', '.'),
};
for (const [hn, head] of Object.entries(heads)) {
  const row = [];
  for (const [vn, v] of Object.entries(variants)) {
    const y = feats(
      synthesize(v, { ipa: true, lang: 'en', tier, head, seed: 7 })
    );
    row.push(`${vn}=${dtw(x, y).toFixed(3)}`);
  }
  console.log(hn, row.join(' '));
}
