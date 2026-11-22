/**
 * Round-trip metrics with the phone-loop HMM decoder injected as the
 * audio-to-IPA stage of recognize().
 * node experiments/issue-75-hmm-roundtrip.mjs <tier> <lang,...> <train.json...>
 * Unlicense.
 */
import { performance } from 'node:perf_hooks';
import { roundTrip, sentences } from '../tests/helpers/roundtrip.js';
import { features } from './issue-75-hmm-lib.mjs';
import { applyLda, fitLda, transformItems } from './issue-75-hmm-lda.mjs';
import {
  decodeLoop,
  emissions,
  loadItems,
  phoneLoop,
  timedSounds,
  trainModel,
} from './issue-75-hmm-model.mjs';

const [tier, langArg, ...files] = process.argv.slice(2);
const langs = langArg.split(',');
const presets = (process.env.TEST ?? 'male,female').split(',');
const t0 = performance.now();
let items = loadItems(files);
const lda = process.env.LDA
  ? fitLda(items, {
      ctx: Number(process.env.CTX ?? 4),
      dims: Number(process.env.LDA),
    })
  : null;
if (lda) {
  items = transformItems(lda, items);
  console.log(
    'lda',
    lda.values
      .slice(0, 5)
      .map((v) => v.toFixed(2))
      .join(' '),
    '…',
    lda.values.at(-1).toFixed(3),
    ((performance.now() - t0) / 1000).toFixed(1),
    's'
  );
}
const model = trainModel(items, { K: Number(process.env.K ?? 8) });
const lm = phoneLoop(model, {
  lmw: Number(process.env.LMW ?? 1),
  penalty: Number(process.env.PEN ?? 0),
});
console.log(
  'units',
  model.units.length,
  'train',
  ((performance.now() - t0) / 1000).toFixed(1),
  's'
);

function audioToIpa(samples, rate) {
  let f = features(samples, rate);
  if (lda) {
    const flat = new Float32Array(f.length * 26);
    f.forEach((v, t) => flat.set(v, t * 26));
    const out = applyLda(lda, flat, f.length);
    const n = lda.rows.length;
    f = Array.from({ length: f.length }, (_, t) =>
      out.subarray(t * n, t * n + n)
    );
  }
  const emit = emissions(model, f);
  const { runs } = decodeLoop(model, lm, emit);
  const segments = timedSounds(runs)
    .filter((s) => s.kind !== 'pause' || s.end - s.start >= 0.3)
    .map((s) => (s.kind === 'pause' ? { ...s, ipa: '|' } : s))
    .map((s) => ({ ...s, confidence: 0.8 }));
  return {
    ipa: segments.map((s) => s.ipa).join(''),
    segments: segments.map((s) =>
      s.ipa === '|' ? { ...s, kind: 'pause' } : s
    ),
  };
}

for (const lang of langs) {
  const sum = { per: [0, 0], sound: [0, 0], lang: 0, n: 0, sec: 0 };
  for (const preset of presets) {
    for (const [index, text] of sentences[lang].entries()) {
      const r = roundTrip(text, {
        lang,
        tier,
        preset,
        seed: 1,
        recognize: (samples, rate, options) =>
          recognizeWith(samples, rate, options),
      });
      sum.per[0] += r.per.distance;
      sum.per[1] += r.per.referenceLength;
      sum.sound[0] += r.soundWer.distance;
      sum.sound[1] += r.soundWer.referenceLength;
      sum.lang += r.languageRight;
      sum.n++;
      sum.sec += r.seconds;
      if (process.env.VERBOSE || index < 2) {
        console.log(
          preset,
          index + 1,
          r.per.rate.toFixed(2),
          r.soundWer.rate.toFixed(2),
          JSON.stringify(text),
          '→',
          JSON.stringify(r.heard.text)
        );
      }
    }
  }
  console.log(
    lang,
    tier,
    'PER',
    (sum.per[0] / sum.per[1]).toFixed(3),
    'soundWER',
    (sum.sound[0] / sum.sound[1]).toFixed(3),
    'lang',
    (sum.lang / sum.n).toFixed(2),
    'sec/utt',
    (sum.sec / sum.n).toFixed(2)
  );
}

import { recognize } from '../src/index.js';
function recognizeWith(samples, rate, options) {
  return recognize(samples, rate, {
    ...options,
    ...(process.env.ONE_LANG && { languages: [process.env.ONE_LANG] }),
    stages: { audioToIpa },
  });
}
