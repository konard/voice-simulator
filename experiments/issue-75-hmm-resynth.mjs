/**
 * Analysis by synthesis after the HMM word decoder: fit a voice to the
 * decoded words, then for each word (and each pair of neighbours) render
 * candidate words in their context and keep the one whose render is
 * closest (DTW over cepstra) to the recording.
 * Candidates: words spotted by the decoder over the span, lexicon words one
 * phone from the decoded word, and the decoded word.
 * node experiments/issue-75-hmm-resynth.mjs [tier] [lang] [from] [to] [preset]
 * Environment: SPOT (8), NEAR (10), HEADS (6 or 3), PAIRS (1). Unlicense.
 */
import { performance } from 'node:perf_hooks';
import { synthesize } from '../src/index.js';
import { presetHeadConfig } from '../src/head-config.js';
import {
  hmmAudio,
  hmmStatics,
  hmmFeatures,
} from '../src/recognition/hmm-features.js';
import { getHmmModel } from '../src/recognition/hmm-model.js';
import { getNetwork } from '../src/recognition/hmm-network.js';
import { alignWords, decodeWords } from '../src/recognition/hmm-decode.js';
import { getLexicon } from '../src/recognition/lexicon.js';
import { sentences } from '../tests/helpers/roundtrip.js';

const [
  tier = 'telephone',
  lang = 'en',
  from = '0',
  to = '20',
  preset = 'male',
] = process.argv.slice(2);
const env = process.env;
const SPOT = Number(env.SPOT ?? 8);
const NEAR = Number(env.NEAR ?? 10);
const MARGIN = 5;
const model = getHmmModel();
const blind = getNetwork(model, ['en', 'ru', 'hi', 'zh']);
const frameOf = (time) => Math.max(0, Math.round((time * 8000 - 60) / 80));
const headNames = env.HEADS === '3' ? [0.5] : [0.25, 0.75];
const heads = ['male', 'female', 'child'].flatMap((name) =>
  headNames.map((size) => presetHeadConfig(name, size))
);
let renders = 0;

function dtw(a, b) {
  const n = a.length;
  const m = b.length;
  if (!n || !m) {
    return Infinity;
  }
  let prev = new Float64Array(m + 1).fill(Infinity);
  let cur = new Float64Array(m + 1);
  prev[0] = 0;
  for (let i = 1; i <= n; i++) {
    cur.fill(Infinity);
    const x = a[i - 1];
    for (let j = 1; j <= m; j++) {
      const y = b[j - 1];
      let d = 0;
      for (let k = 0; k < 13; k++) {
        d += (x[k] - y[k]) ** 2;
      }
      cur[j] = Math.sqrt(d) + Math.min(prev[j], cur[j - 1], prev[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[m] / (n + m);
}

/** Rows with c1.. centred on their own mean. */
function centred(rows) {
  const mean = new Float64Array(13);
  for (const r of rows) {
    for (let k = 1; k < 13; k++) {
      mean[k] += r[k] / rows.length;
    }
  }
  return rows.map((r) => r.map((v, k) => (k && k < 13 ? v - mean[k] : v)));
}

/** Cepstra of a render of the words, from its first word to its last. */
function render(words, head) {
  renders++;
  const spoken = synthesize(words.join(' '), {
    lang,
    tier,
    head,
    engine: 'js',
  });
  const rows = hmmStatics(hmmAudio(spoken.samples, spoken.sampleRate)).statics;
  const ws = spoken.timeline.words;
  if (!ws.length) {
    return [];
  }
  return centred(rows.slice(frameOf(ws[0].start), frameOf(ws.at(-1).end)));
}

/** Symmetric deletion index of the lexicon pronunciations. */
function nearIndex(language) {
  const index = new Map();
  const add = (key, entry) => {
    if (!index.has(key)) {
      index.set(key, []);
    }
    index.get(key).push(entry);
  };
  for (const entry of getLexicon(language).pronunciations(20000)) {
    const units = entry.tokens
      .filter((t) => t.kind === 'vowel' || t.kind === 'consonant')
      .map((t) => t.symbol);
    if (!units.length) {
      continue;
    }
    add(units.join(' '), entry);
    units.forEach((_, i) => add(units.toSpliced(i, 1).join(' '), entry));
  }
  return index;
}

function neighbours(index, units) {
  const keys = [
    units.join(' '),
    ...units.map((_, i) => units.toSpliced(i, 1).join(' ')),
  ];
  const found = new Map();
  for (const key of keys) {
    for (const e of index.get(key) ?? []) {
      found.set(e.word, Math.max(found.get(e.word) ?? 0, e.count));
    }
  }
  return [...found].sort((a, b) => b[1] - a[1]).map(([w]) => w);
}

function spot(network, feats, dims, total, a, b) {
  const lo = Math.max(0, a - MARGIN);
  const hi = Math.min(total, b + MARGIN);
  const best = new Map();
  decodeWords(network, feats.subarray(lo * dims, hi * dims), hi - lo, {
    lmw: 2,
    beam: 200,
    maxActive: 20000,
    onWordEnd(id, score, start, end) {
      if (
        Math.abs(start - (a - lo)) <= MARGIN &&
        Math.abs(end - (b - lo)) <= MARGIN
      ) {
        const word = network.words[id].word;
        if (!best.has(word) || best.get(word) < score) {
          best.set(word, score);
        }
      }
    },
  });
  return [...best].sort((x, y) => y[1] - x[1]).map(([w]) => w);
}

function wer(ref, hyp) {
  const d = Array.from({ length: ref.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= hyp.length; j++) {
    d[0][j] = j;
  }
  for (let i = 1; i <= ref.length; i++) {
    for (let j = 1; j <= hyp.length; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1)
      );
    }
  }
  return d[ref.length][hyp.length];
}

const near = nearIndex(lang);
const local = getNetwork(model, [lang]);
const words = (text) =>
  text
    .toLowerCase()
    .split(/[\s,.?!:;—–"«»।。？！，]+/u)
    .filter(Boolean);
let before = 0;
let after = 0;
let total = 0;
let seconds = 0;
for (let i = Number(from); i < Number(to); i++) {
  const text = sentences[lang][i];
  const spoken = synthesize(text, {
    lang,
    tier,
    preset,
    head: 'random',
    seed: 1,
  });
  const t0 = performance.now();
  const { feats, frames } = hmmFeatures(
    spoken.samples,
    spoken.sampleRate,
    model.lda
  );
  const dims = feats.length / frames;
  const decoded = decodeWords(blind, feats, frames);
  const aligned = alignWords(blind, feats, frames, decoded.words);
  const hyp = decoded.words.map((w) => w.word);
  const spans = hyp.map((_, k) => {
    const own = aligned.filter((x) => x.word === k && x.from < x.to);
    return [
      Math.min(...own.map((x) => x.from)),
      Math.max(...own.map((x) => x.to)),
    ];
  });
  const audio = hmmStatics(hmmAudio(spoken.samples, spoken.sampleRate)).statics;
  const t1 = performance.now();
  // Voice: the head whose render of the decoded words fits best.
  let head = null;
  let fit = Infinity;
  if (hyp.length) {
    const target = centred(audio.slice(spans[0][0], spans.at(-1)[1]));
    for (const h of heads) {
      const d = dtw(target, render(hyp, h));
      if (d < fit) {
        fit = d;
        head = h;
      }
    }
  }
  const t2 = performance.now();
  const current = [...hyp];
  const regionSize = env.PAIRS === '0' ? [1] : [1, 2];
  for (const size of regionSize) {
    for (let k = 0; k + size <= current.length; k++) {
      if (current.length !== spans.length) {
        break;
      }
      const a = spans[k][0];
      const b = spans[k + size - 1][1];
      const left = Math.max(0, k - 1);
      const right = Math.min(current.length, k + size + 1);
      const target = centred(audio.slice(spans[left][0], spans[right - 1][1]));
      const decodedUnits = decoded.words
        .slice(k, k + size)
        .flatMap((w) => w.units.map((u) => u.replace(/@\d$/u, '')));
      const own = current.slice(k, k + size).join(' ');
      const candidates = new Set([
        own,
        ...spot(local, feats, dims, frames, a, b).slice(0, SPOT),
        ...(size === 1 ? neighbours(near, decodedUnits).slice(0, NEAR) : []),
      ]);
      let best = own;
      let bestD = Infinity;
      for (const cand of candidates) {
        const ws = [
          ...current.slice(left, k),
          cand,
          ...current.slice(k + size, right),
        ];
        const d = dtw(target, render(ws, head));
        if (d < bestD - 1e-9) {
          bestD = d;
          best = cand;
        }
      }
      if (best !== own) {
        const parts = best.split(' ');
        current.splice(k, size, ...parts);
        // Keep the spans aligned with the words: a merged word takes both.
        if (parts.length < size) {
          spans.splice(k, size, [a, b]);
        }
      }
    }
  }
  const t3 = performance.now();
  seconds += (t3 - t0) / 1000;
  const ref = words(text);
  const e0 = wer(ref, hyp);
  const e1 = wer(ref, current);
  before += e0;
  after += e1;
  total += ref.length;
  console.log(
    i,
    `${e0}→${e1}/${ref.length}`,
    JSON.stringify(hyp.join(' ')),
    '→',
    JSON.stringify(current.join(' ')),
    `decode ${((t1 - t0) / 1000).toFixed(1)} s voice ${((t2 - t1) / 1000).toFixed(1)} s search ${((t3 - t2) / 1000).toFixed(1)} s`
  );
}
console.log(
  `${lang} ${tier} ${preset} WER ${(before / total).toFixed(3)} → ${(after / total).toFixed(3)} renders ${renders} ${(seconds / (Number(to) - Number(from))).toFixed(1)} s/utt`
);
