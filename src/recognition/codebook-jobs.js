/** Pack contiguous codebook query blocks and execute them in frame order. Unlicense. */
import { frameEnvelope } from './codebook.js';
import { attachQuery } from './codebook-search.js';
import { withWasmMemory } from './wasm-memory.js';
import { whisperCodebook } from './whisper-codebook.js';

const BANDS = 24;
const WIDTH = 30;
const tables = new WeakMap();

function tableFor(book) {
  if (!tables.has(book)) {
    const { tree, key, envelope } = book;
    tables.set(book, { tree, key, envelope });
  }
  return tables.get(book);
}

function queryRust(table, { rows, k }, module) {
  return withWasmMemory(module, (allocate) => {
    const tree = allocate(Uint32Array, table.tree.length, table.tree);
    const keys = allocate(Float32Array, table.key.length, table.key);
    const envelope = allocate(
      Uint8Array,
      table.envelope.length,
      table.envelope
    );
    const input = allocate(Float64Array, rows.length, rows);
    const count = rows.length / WIDTH;
    const out = allocate(Float64Array, 2 * k * count);
    const written = module.exports.rec_codebook_search(
      tree.pointer,
      keys.pointer,
      envelope.pointer,
      tree.length / 4,
      input.pointer,
      count,
      k,
      out.pointer,
      out.length
    );
    if (written !== out.length) {
      throw new Error(`Rust codebook search failed (${written})`);
    }
    return out.view().slice();
  });
}

function queryJs(book, { rows, k }) {
  const query = { index: new Int32Array(k), cost: new Float64Array(k) };
  const count = rows.length / WIDTH;
  const output = new Float64Array(2 * k * count);
  for (let t = 0; t < count; t++) {
    book.query(rows.subarray(t * WIDTH, t * WIDTH + BANDS), k, query);
    for (let i = 0; i < k; i++) {
      const index = 2 * (t * k + i);
      output[index] = query.index[i];
      output[index + 1] = query.cost[i];
    }
  }
  return output;
}

export function searchCodebookJob(table, job, kernels) {
  return kernels?.module
    ? queryRust(table, job, kernels.module)
    : queryJs(table.query ? table : attachQuery(table), job);
}

function queries(frames, book, whispered) {
  const rows = new Float64Array(frames.count * WIDTH).fill(NaN);
  let used = false;
  for (let t = 0; t < frames.count; t++) {
    if (frames.speech[t] && Boolean(frames.whisper?.[t]) === whispered) {
      const at = t * WIDTH;
      frameEnvelope(frames, t, book, {
        envelope: rows.subarray(at, at + BANDS),
        key: rows.subarray(at + BANDS, at + WIDTH),
      });
      used = true;
    }
  }
  return used ? rows : null;
}

function requests(frames, book, head) {
  const items = [[book, queries(frames, book, false)]];
  if (frames.whisper?.subarray(0, frames.count).some(Boolean)) {
    const quiet = whisperCodebook(book, head);
    items.push([quiet, queries(frames, quiet, true)]);
  }
  return items;
}

function combine(results, frames, k) {
  const normal = results[0];
  const quiet = results[1];
  return (t, query) => {
    const pairs = frames.whisper?.[t] ? quiet : normal;
    const start = t * k * 2;
    for (let i = 0; i < k; i++) {
      query.index[i] = pairs[start + 2 * i];
      query.cost[i] = pairs[start + 2 * i + 1];
    }
  };
}

export function codebookQueries(frames, book, head, kernels, k = 16) {
  const results = requests(frames, book, head).map(
    ([table, rows]) =>
      rows && searchCodebookJob(tableFor(table), { rows, k }, kernels)
  );
  return combine(results, frames, k);
}

export async function codebookQueriesParallel(
  frames,
  book,
  head,
  kernels,
  pool,
  k = 16
) {
  const results = [];
  for (const [source, rows] of requests(frames, book, head)) {
    if (!rows) {
      results.push(null);
      continue;
    }
    const table = tableFor(source);
    const block = Math.ceil(frames.count / pool.size) * WIDTH;
    const jobs = [];
    for (let at = 0; at < rows.length; at += block) {
      jobs.push({ rows: rows.slice(at, at + block), k });
    }
    const blocks = await pool.run(
      'codebook',
      jobs,
      (job) => searchCodebookJob(table, job, kernels),
      table
    );
    const joined = new Float64Array(frames.count * k * 2);
    let at = 0;
    for (const block of blocks) {
      joined.set(block, at);
      at += block.length;
    }
    results.push(joined);
  }
  return combine(results, frames, k);
}
