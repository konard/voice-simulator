/**
 * Round-trip metrics with HMM word decoding injected as the audio stage.
 * node experiments/issue-75-hmm-wordtrip.mjs <tier> <lang,...> <train.json...>
 * Environment: MODEL (cache file), K, LDA, LMW, WIP, BEAM, TEST, VERBOSE,
 * DECODE_LANGS (languages searched, default all four), LIMIT (sentences).
 * Unlicense.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { recognize } from '../src/index.js';
import {
  roundTrip,
  sentenceMark,
  sentences,
} from '../tests/helpers/roundtrip.js';
import { analyzeFrames } from '../src/recognition/frontend.js';
import { trackPitch } from '../src/recognition/pitch.js';
import { features } from './issue-75-hmm-lib.mjs';
import { applyLda, fitLda, transformItems } from './issue-75-hmm-lda.mjs';
import { realignStates, trainContextModel } from './issue-75-hmm-context.mjs';
import { itemDim, loadItems, trainModel } from './issue-75-hmm-model.mjs';
import {
  alignWords,
  buildNetwork,
  decodeWords,
  learnExpansions,
  tokenIpa,
} from './issue-75-hmm-words.mjs';

const [tierArg, langArg, ...files] = process.argv.slice(2);
const langs = langArg.split(',');
const env = process.env;
const decodeLangs = (env.DECODE_LANGS ?? 'en,ru,hi,zh').split(',');
const t0 = performance.now();
const elapsed = () => `${((performance.now() - t0) / 1000).toFixed(1)} s`;

function saveModel(path, lda, model, expansions) {
  const plain = {
    lda: lda && {
      ...lda,
      rows: lda.rows.map((r) => [...r]),
      mean: [...lda.mean],
    },
    units: model.units,
    states: model.states.map((s) => ({
      unit: s.unit,
      s: s.s,
      context: s.context,
      stay: s.stay,
      go: s.go,
      model: s.model.map((c) => ({ w: c.w, mu: [...c.mu], var: [...c.var] })),
    })),
    expansions: [...expansions],
    contextIndex: model.contextIndex ? [...model.contextIndex] : null,
  };
  writeFileSync(path, JSON.stringify(plain));
}

function loadModel(path) {
  const plain = JSON.parse(readFileSync(path, 'utf8'));
  const lda = plain.lda && {
    ...plain.lda,
    rows: plain.lda.rows.map((r) => Float64Array.from(r)),
    mean: Float64Array.from(plain.lda.mean),
  };
  const states = plain.states.map((s) => ({
    ...s,
    // JSON stores -Infinity as null.
    stay: s.stay ?? -Infinity,
    go: s.go ?? -Infinity,
    model: s.model.map((c) => {
      const mu = Float64Array.from(c.mu);
      const v = Float64Array.from(c.var);
      return {
        w: c.w,
        mu,
        var: v,
        norm:
          -0.5 * v.reduce((a, x) => a + Math.log(2 * Math.PI * x), 0) +
          Math.log(c.w),
        inv: Float64Array.from(v, (x) => 0.5 / x),
      };
    }),
  }));
  return {
    lda,
    model: {
      units: plain.units,
      states,
      contextIndex: plain.contextIndex ? new Map(plain.contextIndex) : null,
    },
    expansions: new Map(plain.expansions),
  };
}

let lda;
let model;
let expansions;
if (env.MODEL && existsSync(env.MODEL)) {
  ({ lda, model, expansions } = loadModel(env.MODEL));
  console.log('loaded', env.MODEL, elapsed());
} else {
  let items = loadItems(files);
  expansions = learnExpansions(items);
  if (env.LDA) {
    const sample = items.filter((_, i) => i % 4 === 0);
    lda = fitLda(sample, {
      dims: Number(env.LDA),
      ctx: Number(env.CTX ?? 4),
      dim: itemDim(items[0]),
    });
    items = transformItems(lda, items);
    console.log('lda', elapsed());
  }
  const train = () =>
    env.CD
      ? trainContextModel(items, {
          K: Number(env.K ?? 16),
          Kcd: Number(env.KCD ?? 8),
          minFrames: Number(env.CD),
        })
      : trainModel(items, { K: Number(env.K ?? 8) });
  model = train();
  // REALIGN=n re-segments the states of each phone n times and retrains.
  for (let pass = 0; pass < Number(env.REALIGN ?? 0); pass++) {
    items = realignStates(items, model);
    model = train();
    console.log('realign pass', pass + 1, elapsed());
  }
  console.log('trained', model.units.length, 'units', elapsed());
  if (env.MODEL) {
    saveModel(env.MODEL, lda, model, expansions);
  }
}
const network = buildNetwork(model, expansions, decodeLangs, {
  maxWords: Number(env.WORDS ?? 8000),
});
console.log(
  'network',
  network.nodes.length,
  'nodes',
  network.words.length,
  'pronunciations, skipped',
  network.skipped,
  elapsed()
);

function frontEnd(samples, rate) {
  const pitch = (lda?.dim ?? 26) === 30;
  const f = features(samples, rate, { pitch });
  if (!lda) {
    return f;
  }
  const D = lda.dim;
  const flat = new Float32Array(f.length * D);
  f.forEach((v, t) => flat.set(v, t * D));
  const out = applyLda(lda, flat, f.length);
  const n = lda.rows.length;
  return Array.from({ length: f.length }, (_, t) =>
    out.subarray(t * n, t * n + n)
  );
}

const frameTime = (t) => (t * 80 + 100) / 8000;
let decodeSeconds = 0;
function audioToIpa(samples, rate) {
  const started = performance.now();
  const feats = frontEnd(samples, rate);
  const decoded = decodeWords(network, feats, {
    lmw: Number(env.LMW ?? 8),
    wip: Number(env.WIP ?? -4),
    beam: Number(env.BEAM ?? 120),
  });
  const aligned = decoded.words.length
    ? alignWords(network, feats, decoded)
    : [];
  decodeSeconds += (performance.now() - started) / 1000;
  const segments = [];
  let lastEnd = 0;
  let lastWord = -1;
  for (const a of aligned) {
    const start = frameTime(a.from);
    if (a.word !== lastWord && start - lastEnd >= 0.3 && segments.length) {
      segments.push({
        ipa: '|',
        kind: 'pause',
        start: lastEnd,
        end: start,
        confidence: 1,
        modelWord: lastWord,
      });
    }
    const end = Math.max(start + 0.005, frameTime(a.to));
    segments.push({
      ipa: env.STRIP_TONES
        ? tokenIpa(a.token).replace(/[˥˦˧˨˩]/gu, '')
        : tokenIpa(a.token),
      kind: a.token.kind,
      start,
      end,
      confidence: 0.9,
      modelWord: a.word,
    });
    lastEnd = end;
    lastWord = a.word;
  }
  audioToIpa.last = decoded;
  const tracks = env.PITCH_TRACK
    ? { pitch: trackPitch(analyzeFrames(samples, rate, { hop: 0.01 })) }
    : undefined;
  return {
    ipa: segments.map((s) => s.ipa).join(''),
    segments,
    ...(tracks && { tracks }),
    ...(decoded.lang && { modelLanguage: decoded.lang }),
  };
}

const presets = (env.TEST ?? 'male,female').split(',');
const limit = Number(env.LIMIT ?? 20);
for (const tier of tierArg.split(',')) {
  for (const lang of langs) {
    const sum = {
      per: [0, 0],
      sound: [0, 0],
      lang: 0,
      n: 0,
      sec: 0,
      audio: 0,
      time: [0, 0],
      tone: [0, 0],
      stress: [0, 0],
      mark: 0,
    };
    decodeSeconds = 0;
    for (const preset of presets) {
      for (const [index, text] of sentences[lang].slice(0, limit).entries()) {
        const r = roundTrip(text, {
          lang,
          tier,
          preset,
          seed: 1,
          recognize: (samples, rate, options) =>
            recognize(samples, rate, { ...options, stages: { audioToIpa } }),
        });
        sum.per[0] += r.per.distance;
        sum.per[1] += r.per.referenceLength;
        sum.sound[0] += r.soundWer.distance;
        sum.sound[1] += r.soundWer.referenceLength;
        sum.lang += r.languageRight;
        sum.n++;
        sum.sec += r.seconds;
        sum.audio += r.spoken.duration;
        sum.time[0] += r.timeErrors.total;
        sum.time[1] += r.timeErrors.errors.length;
        if (r.toneErrors) {
          sum.tone[0] += r.toneErrors.distance;
          sum.tone[1] += r.toneErrors.referenceLength;
        }
        if (r.stressHits) {
          sum.stress[0] += r.stressHits.hits;
          sum.stress[1] += r.stressHits.count;
        }
        sum.mark += r.sentenceMark === sentenceMark(text);
        if (env.TONES && r.toneErrors) {
          const tones = (words) =>
            words
              .flatMap((w) => w.syllables)
              .map((s) => s.ipa.match(/[˥˦˧˨˩]/gu)?.join('') ?? '-')
              .join(' ');
          console.log(
            'tones',
            r.toneErrors.rate.toFixed(2),
            tones(r.spoken.timeline.words),
            '|',
            tones(r.heard.words),
            '|',
            r.heard.words.map((w) => w.ipa).join(' ')
          );
        }
        if (env.VERBOSE || r.soundWer.rate > 0) {
          const raw = audioToIpa.last.words.map((w) => w.word).join(' ');
          console.log(
            preset,
            index + 1,
            r.per.rate.toFixed(2),
            r.soundWer.rate.toFixed(2),
            JSON.stringify(text),
            '→',
            JSON.stringify(r.heard.text),
            raw !== r.heard.text ? `[${raw}]` : ''
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
      'time',
      (sum.time[0] / Math.max(1, sum.time[1])).toFixed(1),
      'ms',
      ...(sum.tone[1] ? ['tone', (sum.tone[0] / sum.tone[1]).toFixed(3)] : []),
      ...(sum.stress[1]
        ? ['stress', (sum.stress[0] / sum.stress[1]).toFixed(3)]
        : []),
      'marks',
      (sum.mark / sum.n).toFixed(2),
      'RTF decode',
      (decodeSeconds / sum.audio).toFixed(2),
      'recognize',
      (sum.sec / sum.audio).toFixed(2)
    );
  }
}
