/**
 * Syllable tone classification from the rendered training items: f0
 * contour points over each toned vowel run (semitones re the utterance
 * median), Gaussian classes with full covariance.
 * node experiments/issue-75-tone-classifier.mjs <train.json,...> <test.json,...>
 * Unlicense.
 */
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { analyzeFrames } from '../src/recognition/frontend.js';
import { trackPitch } from '../src/recognition/pitch.js';
import { VOWELS } from '../src/ipa/inventory.js';

const RATE = 8000;
const POINTS = 6;

const isVowel = (label) => {
  const base = label.split('@')[0].replace(/_r$/u, '');
  return [...base].some((ch) => VOWELS[ch]);
};

function pitchOf(audio) {
  const pcm = new Int16Array(Buffer.from(audio, 'base64').buffer.slice(0));
  const x = Float64Array.from(pcm, (v) => v / 32767);
  const p = trackPitch(analyzeFrames(x, RATE, { hop: 0.01 }));
  const st = Array.from(p.f0, (f, i) =>
    f > 0 && p.voicing[i] > 0.5 ? 12 * Math.log2(f) : NaN
  );
  const voiced = st.filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
  const median = voiced.length ? voiced[voiced.length >> 1] : 0;
  return { p, st: st.map((v) => v - median) };
}

export function syllableRuns(labels) {
  const runs = [];
  for (let t = 0; t < labels.length; t++) {
    const label = labels[t];
    if (!isVowel(label)) {
      continue;
    }
    const tone = Number(label.split('@')[1] ?? 0);
    const last = runs.at(-1);
    if (last && last.to === t && last.tone === tone) {
      last.to = t + 1;
    } else {
      runs.push({ from: t, to: t + 1, tone });
    }
  }
  return runs;
}

/** Contour points of a time span in semitones (NaN when unvoiced). */
export function contour(pitch, start, end) {
  const { p, st } = pitch;
  const values = [];
  for (let i = 0; i < p.count; i++) {
    const time = p.startTime + i * p.hop;
    if (time >= start && time < end && !Number.isNaN(st[i])) {
      values.push(st[i]);
    }
  }
  if (values.length < 2) {
    return null;
  }
  return Array.from({ length: POINTS }, (_, k) => {
    const at = (k * (values.length - 1)) / (POINTS - 1);
    const lo = Math.floor(at);
    return values[lo] + (values[Math.ceil(at)] - values[lo]) * (at - lo);
  });
}

const frameTime = (t) => (t * 80 + 100) / RATE;

export function syllableFeatures(pitch, runs) {
  const rows = runs.map((r) =>
    contour(pitch, frameTime(r.from) - 0.005, frameTime(r.to) + 0.005)
  );
  return runs.map((r, i) => {
    const c = rows[i];
    if (!c) {
      return null;
    }
    const prev = rows[i - 1]?.at(-1) ?? c[0];
    const next = rows[i + 1]?.[0] ?? c.at(-1);
    return [...c, prev, next, 100 * (frameTime(r.to) - frameTime(r.from))];
  });
}

function load(files) {
  const rows = [];
  for (const file of files) {
    for (const item of JSON.parse(readFileSync(file, 'utf8'))) {
      const pitch = pitchOf(item.audio);
      const runs = syllableRuns(item.labels);
      syllableFeatures(pitch, runs).forEach((x, i) => {
        if (x) {
          rows.push({ x, tone: runs[i].tone });
        }
      });
    }
  }
  return rows;
}

function invert(m, n) {
  const a = m.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => +(i === j)),
  ]);
  let logDet = 0;
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) {
      if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) {
        pivot = r;
      }
    }
    [a[c], a[pivot]] = [a[pivot], a[c]];
    const d = a[c][c];
    logDet += Math.log(Math.abs(d));
    for (let j = 0; j < 2 * n; j++) {
      a[c][j] /= d;
    }
    for (let r = 0; r < n; r++) {
      if (r !== c) {
        const f = a[r][c];
        for (let j = 0; j < 2 * n; j++) {
          a[r][j] -= f * a[c][j];
        }
      }
    }
  }
  return { inv: a.map((row) => row.slice(n)), logDet };
}

export function trainTones(rows) {
  const n = rows[0].x.length;
  const classes = new Map();
  for (const { x, tone } of rows) {
    const c = classes.get(tone) ?? [];
    c.push(x);
    classes.set(tone, c);
  }
  const models = [];
  for (const [tone, xs] of classes) {
    const mean = Array.from(
      { length: n },
      (_, d) => xs.reduce((s, x) => s + x[d], 0) / xs.length
    );
    const cov = Array.from({ length: n }, (_, i) =>
      Array.from(
        { length: n },
        (_, j) =>
          xs.reduce((s, x) => s + (x[i] - mean[i]) * (x[j] - mean[j]), 0) /
            xs.length +
          (i === j ? 0.05 : 0)
      )
    );
    const { inv, logDet } = invert(cov, n);
    models.push({
      tone,
      mean,
      inv,
      norm: -0.5 * logDet + Math.log(xs.length / rows.length),
    });
  }
  return models;
}

export function toneScores(models, x) {
  return models.map((m) => {
    const e = x.map((v, i) => v - m.mean[i]);
    let q = 0;
    for (let i = 0; i < e.length; i++) {
      for (let j = 0; j < e.length; j++) {
        q += e[i] * m.inv[i][j] * e[j];
      }
    }
    return { tone: m.tone, score: m.norm - 0.5 * q };
  });
}

if (process.argv[1]?.endsWith('issue-75-tone-classifier.mjs')) {
  const [train, test] = process.argv.slice(2).map((s) => s.split(','));
  const models = trainTones(load(train));
  const rows = load(test);
  const confusion = new Map();
  let right = 0;
  for (const { x, tone } of rows) {
    const best = toneScores(models, x).sort((a, b) => b.score - a.score)[0];
    right += best.tone === tone;
    const key = `${tone}>${best.tone}`;
    confusion.set(key, (confusion.get(key) ?? 0) + 1);
  }
  console.log('accuracy', (right / rows.length).toFixed(3), rows.length);
  console.log(
    [...confusion]
      .sort()
      .map((e) => e.join(' '))
      .join('\n')
  );
}
