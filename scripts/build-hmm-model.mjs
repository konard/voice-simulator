#!/usr/bin/env node
/**
 * Pack a Gaussian HMM trained by experiments/issue-75-hmm-wordtrip.mjs
 * (MODEL=<file>) into src/recognition/data/hmm-model.js: mixture means
 * and log variances as int8 with a per-dimension scale and offset, log
 * weights as int8, the LDA projection as float32, all base64.
 * node scripts/build-hmm-model.mjs <model.json> [out.js]
 * Unlicense.
 */
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Buffer } from 'node:buffer';

const base64 = (array) =>
  Buffer.from(array.buffer, array.byteOffset, array.byteLength).toString(
    'base64'
  );

function quantiser(columns) {
  const dims = columns[0].length;
  const scale = new Float32Array(dims);
  const offset = new Float32Array(dims);
  for (let d = 0; d < dims; d++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const row of columns) {
      lo = Math.min(lo, row[d]);
      hi = Math.max(hi, row[d]);
    }
    offset[d] = (lo + hi) / 2;
    scale[d] = Math.max((hi - lo) / 254, 1e-9);
  }
  const values = new Int8Array(columns.length * dims);
  columns.forEach((row, i) => {
    for (let d = 0; d < dims; d++) {
      values[i * dims + d] = Math.round((row[d] - offset[d]) / scale[d]);
    }
  });
  return { values, scale, offset };
}

export function packHmmModel(plain) {
  const units = plain.units;
  const contexts = (plain.contextIndex ?? [])
    .sort((a, b) => a[1] - b[1])
    .map(([key, index], i) => {
      if (index !== 3 * units.length + i) {
        throw new Error(`context state ${key} out of order`);
      }
      return key;
    });
  const components = plain.states.flatMap((s) => s.model);
  const means = quantiser(components.map((c) => c.mu));
  const logVars = quantiser(components.map((c) => c.var.map(Math.log)));
  const logWeights = components.map((c) => Math.log(c.w));
  const weightRange = Math.max(...logWeights.map(Math.abs), 1e-9);
  const durations = units.map((_, u) => {
    // go = ln(3 / mean frames) of the unit's states.
    const go = plain.states[3 * u].go;
    return go === null ? 3 : Number((3 / Math.exp(go)).toFixed(4));
  });
  const rows = plain.lda.rows;
  return {
    lda: {
      ctx: plain.lda.ctx,
      dim: plain.lda.dim,
      width: plain.lda.width,
      dims: rows.length,
      rows: base64(Float32Array.from(rows.flat())),
      mean: base64(Float32Array.from(plain.lda.mean)),
    },
    units,
    contexts,
    durations,
    expansions: plain.expansions.map(([symbol, e]) => [
      symbol,
      e.release,
      e.optional,
    ]),
    mixtures: {
      counts: base64(Uint8Array.from(plain.states, (s) => s.model.length)),
      weightRange: Number(weightRange.toFixed(6)),
      weights: base64(
        Int8Array.from(logWeights, (w) => Math.round((127 * w) / weightRange))
      ),
      means: base64(means.values),
      meanScale: base64(means.scale),
      meanOffset: base64(means.offset),
      logVars: base64(logVars.values),
      varScale: base64(logVars.scale),
      varOffset: base64(logVars.offset),
    },
  };
}

/** Characters per data part: each part becomes its own app chunk, which
 * must stay under Vite's 500 kB warning (examples/universal-app). */
const PART = 400000;

const HEADER = `/** Gaussian HMM states trained on the simulator's own renders, packed by
 * node scripts/build-hmm-model.mjs (training: tests/heavy/README.md,
 * "Recognition model"). Unlicense. */
`;

/** Keep the large ASCII columns separate from the Unicode metadata. */
export function hmmModelSources(packed, name = 'hmm-model') {
  const metadata = { ...packed, mixtures: { ...packed.mixtures } };
  const files = [];
  const imports = [];
  const columns = [];
  for (const key of ['means', 'logVars']) {
    const column = metadata.mixtures[key];
    delete metadata.mixtures[key];
    const parts = [];
    for (let at = 0; at < column.length; at += PART) {
      const id = files.length;
      const file = `${name}-${id}.js`;
      const value = JSON.stringify(column.slice(at, at + PART));
      files.push([
        file,
        `${HEADER}// prettier-ignore\nexport default ${value};\n`,
      ]);
      imports.push(`import part${id} from './${file}';`);
      parts.push(`part${id}`);
    }
    columns.push(`  data.mixtures.${key} = [${parts.join(', ')}];`);
  }
  const encoded = JSON.stringify(JSON.stringify(metadata));
  files.push([
    `${name}.js`,
    `${HEADER}${imports.join('\n')}\n\n// prettier-ignore\nconst metadata = ${encoded};\n\nexport function readHmmModel() {\n  const data = JSON.parse(metadata);\n${columns.join('\n')}\n  return data;\n}\n`,
  ]);
  return files;
}

if (process.argv[1]?.endsWith('build-hmm-model.mjs')) {
  const [input, out = 'src/recognition/data/hmm-model.js'] =
    process.argv.slice(2);
  const packed = packHmmModel(JSON.parse(readFileSync(input, 'utf8')));
  const dir = dirname(out);
  const name = basename(out, '.js');
  for (const file of readdirSync(dir)) {
    if (file.startsWith(`${name}-`) && /-\d+\.js$/.test(file)) {
      unlinkSync(join(dir, file));
    }
  }
  let bytes = 0;
  for (const [file, source] of hmmModelSources(packed, name)) {
    writeFileSync(join(dir, file), source);
    bytes += source.length;
  }
  console.log(
    out,
    bytes,
    'bytes',
    packed.units.length,
    'units',
    packed.contexts.length,
    'context states'
  );
}
