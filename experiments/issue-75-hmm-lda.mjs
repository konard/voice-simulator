/* eslint-disable complexity, max-statements */
/**
 * Linear discriminant analysis over stacked cepstral frames: classes are
 * the labelled HMM states. Unlicense.
 */
import { decodeFeats } from './issue-75-hmm-model.mjs';

export const STATIC = 13;

/** Cyclic Jacobi eigen decomposition of a symmetric matrix (row-major). */
export function symmetricEigen(matrix, n) {
  const a = Float64Array.from(matrix);
  const v = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    v[i * n + i] = 1;
  }
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        off += a[p * n + q] ** 2;
      }
    }
    if (off < 1e-22) {
      break;
    }
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q];
        if (Math.abs(apq) < 1e-300) {
          continue;
        }
        const theta = (a[q * n + q] - a[p * n + p]) / (2 * apq);
        const t =
          Math.sign(theta || 1) /
          (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k * n + p];
          const akq = a[k * n + q];
          a[k * n + p] = c * akp - s * akq;
          a[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p * n + k];
          const aqk = a[q * n + k];
          a[p * n + k] = c * apk - s * aqk;
          a[q * n + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k * n + p];
          const vkq = v[k * n + q];
          v[k * n + p] = c * vkp - s * vkq;
          v[k * n + q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const values = Float64Array.from({ length: n }, (_, i) => a[i * n + i]);
  // vectors[j] is the eigenvector of values[j]
  const vectors = Array.from({ length: n }, (_, j) =>
    Float64Array.from({ length: n }, (_, k) => v[k * n + j])
  );
  return { values, vectors };
}

/** Stack the static cepstra of frames t-ctx..t+ctx. */
export function stack(feats, frames, dim, ctx) {
  const width = STATIC * (2 * ctx + 1);
  const out = new Float64Array(frames * width);
  for (let t = 0; t < frames; t++) {
    for (let j = -ctx; j <= ctx; j++) {
      const u = Math.min(frames - 1, Math.max(0, t + j));
      for (let d = 0; d < STATIC; d++) {
        out[t * width + (j + ctx) * STATIC + d] = feats[u * dim + d];
      }
    }
  }
  return out;
}

export function fitLda(items, { ctx = 4, dims = 40, dim = 26 } = {}) {
  const width = STATIC * (2 * ctx + 1);
  const classes = new Map();
  const total = new Float64Array(width);
  let count = 0;
  for (const item of items) {
    const x = stack(decodeFeats(item.feats), item.frames, dim, ctx);
    for (let t = 0; t < item.frames; t++) {
      const key = `${item.labels[t]}#${item.states[t]}`;
      let c = classes.get(key);
      if (!c) {
        c = { n: 0, sum: new Float64Array(width) };
        classes.set(key, c);
      }
      c.n++;
      count++;
      for (let d = 0; d < width; d++) {
        c.sum[d] += x[t * width + d];
        total[d] += x[t * width + d];
      }
    }
  }
  const mean = total.map((v) => v / count);
  // Within-class scatter from a second pass.
  const sw = new Float64Array(width * width);
  const means = new Map(
    [...classes].map(([k, c]) => [k, c.sum.map((v) => v / c.n)])
  );
  const e = new Float64Array(width);
  for (const item of items) {
    const x = stack(decodeFeats(item.feats), item.frames, dim, ctx);
    for (let t = 0; t < item.frames; t++) {
      const m = means.get(`${item.labels[t]}#${item.states[t]}`);
      for (let d = 0; d < width; d++) {
        e[d] = x[t * width + d] - m[d];
      }
      for (let i = 0; i < width; i++) {
        const ei = e[i];
        for (let j = i; j < width; j++) {
          sw[i * width + j] += ei * e[j];
        }
      }
    }
  }
  const sb = new Float64Array(width * width);
  for (const [k, c] of classes) {
    const m = means.get(k);
    for (let i = 0; i < width; i++) {
      for (let j = i; j < width; j++) {
        sb[i * width + j] += c.n * (m[i] - mean[i]) * (m[j] - mean[j]);
      }
    }
  }
  for (let i = 0; i < width; i++) {
    for (let j = i; j < width; j++) {
      sw[i * width + j] /= count;
      sw[j * width + i] = sw[i * width + j];
      sb[i * width + j] /= count;
      sb[j * width + i] = sb[i * width + j];
    }
  }
  // Whitening W = Sw^-1/2, then eigenvectors of W Sb W.
  const w = symmetricEigen(sw, width);
  const white = w.vectors.map((vec, j) =>
    vec.map((x) => x / Math.sqrt(Math.max(w.values[j], 1e-10)))
  ); // rows: whitened directions
  const k = width;
  const proj = new Float64Array(k * k);
  for (let a = 0; a < k; a++) {
    for (let b = a; b < k; b++) {
      let s = 0;
      const wa = white[a];
      const wb = white[b];
      for (let i = 0; i < width; i++) {
        let r = 0;
        const row = i * width;
        for (let j = 0; j < width; j++) {
          r += sb[row + j] * wb[j];
        }
        s += wa[i] * r;
      }
      proj[a * k + b] = s;
      proj[b * k + a] = s;
    }
  }
  const b = symmetricEigen(proj, k);
  const order = [...b.values.keys()].sort((x, y) => b.values[y] - b.values[x]);
  const rows = order.slice(0, dims).map((j) => {
    const r = new Float64Array(width);
    for (let a = 0; a < k; a++) {
      const coef = b.vectors[j][a];
      for (let i = 0; i < width; i++) {
        r[i] += coef * white[a][i];
      }
    }
    return r;
  });
  return {
    ctx,
    dim,
    width,
    rows,
    mean,
    values: order.slice(0, dims).map((j) => b.values[j]),
  };
}

export function applyLda(lda, feats, frames) {
  const { ctx, dim, width, rows, mean } = lda;
  const x = stack(feats, frames, dim, ctx);
  const out = new Float32Array(frames * rows.length);
  for (let t = 0; t < frames; t++) {
    for (let r = 0; r < rows.length; r++) {
      let s = 0;
      const row = rows[r];
      for (let d = 0; d < width; d++) {
        s += row[d] * (x[t * width + d] - mean[d]);
      }
      out[t * rows.length + r] = s;
    }
  }
  return out;
}

export function transformItems(lda, items) {
  return items.map((item) => ({
    ...item,
    feats: applyLda(lda, decodeFeats(item.feats), item.frames),
  }));
}
