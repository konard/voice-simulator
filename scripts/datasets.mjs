#!/usr/bin/env node

/**
 * Speech dataset registry and fetcher (issue 16).
 *
 * `datasets/registry.json` lists the speech datasets that tests may use. This
 * script downloads a small part of one into a local cache (`.datasets/`,
 * never committed), checks it against the SHA-256 recorded in the registry,
 * and refuses a dataset whose licence is not in `allowedDatasetLicences` of
 * `scripts/policy-denylist.json`. There is no option that switches the
 * licence gate off. Node.js built-ins only.
 *
 * Usage:
 *   node scripts/datasets.mjs list [--json]
 *   node scripts/datasets.mjs fetch <id>... [--cache <dir>] [--limit <n>]
 *                                          [--max-bytes <n>] [--record]
 *   node scripts/datasets.mjs verify [<id>...] [--cache <dir>]
 *
 * Exit codes: 0 ok, 2 wrong usage or unknown id, 3 licence refused,
 * 4 checksum or size mismatch, 5 too large, 6 network failure.
 *
 * See docs/CONTRIBUTING.md, section "Datasets".
 */

import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
export const REGISTRY_FILE = path.join(REPO_ROOT, 'datasets', 'registry.json');
export const REFUSED_FILE = path.join(REPO_ROOT, 'datasets', 'refused.json');
export const POLICY_FILE = path.join(
  REPO_ROOT,
  'scripts',
  'policy-denylist.json'
);
export const DEFAULT_CACHE = path.join(REPO_ROOT, '.datasets');
export const ROWS_ENDPOINT = 'https://datasets-server.huggingface.co/rows';
export const USER_AGENT = 'voice-simulator-datasets';

export const DEFAULT_LIMIT = 20;
export const DEFAULT_MAX_BYTES = 209715200;
/** One page of the rows interface. */
export const MAX_ROWS = 100;
export const LANGUAGES = ['en', 'ru', 'hi', 'zh'];
/** The only licences under which a part may be committed. */
export const REDISTRIBUTABLE = ['Public-Domain', 'CC0-1.0'];

const ATTEMPTS = 4;
const DELAY = 2000;
const AUDIO_EXTENSIONS = /\.(wav|flac|mp3|ogg|opus)$/i;
const GENDERS = ['male', 'female', 'other'];

export const EXIT = {
  ok: 0,
  usage: 2,
  licence: 3,
  checksum: 4,
  tooLarge: 5,
  network: 6,
};

/** An error that carries the exit code of the command line. */
export class DatasetError extends Error {
  /**
   * @param {string} message
   * @param {number} code one of EXIT
   */
  constructor(message, code) {
    super(message);
    this.name = 'DatasetError';
    this.code = code;
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';
const isSha256 = (value) =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

/** @param {string|Buffer} data */
export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

/** @returns {Promise<{size: number, sha256: string}>} */
export async function hashFile(file) {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
    size += chunk.length;
  }
  return { size, sha256: hash.digest('hex') };
}

// ---------------------------------------------------------------------------
// Registry, policy and validation

/** @param {string} [file] */
export function loadRegistry(file = REGISTRY_FILE) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** @param {string} [file] */
export function loadPolicy(file = POLICY_FILE) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** @param {string} [file] */
export function loadRefused(file = REFUSED_FILE) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
}

/**
 * @param {{licence?: string}} entry
 * @param {{allowedDatasetLicences?: string[]}} policy
 * @returns {string|null} null when the licence is allowed, else the reason
 */
export function licenceGate(entry, policy) {
  const allowed = policy?.allowedDatasetLicences;
  if (!Array.isArray(allowed)) {
    return 'the policy has no allowedDatasetLicences list';
  }
  const licence = entry?.licence;
  if (!isText(licence)) {
    return 'has no licence';
  }
  if (!allowed.includes(licence)) {
    return `licence "${licence}" is not in allowedDatasetLicences of scripts/policy-denylist.json`;
  }
  return null;
}

/**
 * The URL of the rows interface for a `rows` source.
 * @param {object} source
 * @param {{endpoint?: string, length?: number}} [options]
 */
export function rowsUrl(source, { endpoint = ROWS_ENDPOINT, length } = {}) {
  const url = new URL(endpoint);
  url.searchParams.set('dataset', source.dataset);
  url.searchParams.set('config', source.config);
  url.searchParams.set('split', source.split);
  url.searchParams.set('offset', '0');
  url.searchParams.set('length', String(length ?? source.length));
  return url.toString();
}

/**
 * Every URL an entry names; the first one answers a HEAD request, so it is
 * the one to probe for reachability.
 * @param {object} entry
 * @param {{endpoint?: string}} [options]
 */
export function entryUrls(entry, { endpoint = ROWS_ENDPOINT } = {}) {
  const source = entry?.source ?? {};
  const urls = [];
  if (source.kind === 'rows') {
    const splits = new URL(endpoint.replace(/\/rows$/, '/splits'));
    splits.searchParams.set('dataset', source.dataset);
    urls.push(splits.toString(), rowsUrl(source, { endpoint }));
    urls.push(`https://huggingface.co/datasets/${source.dataset}`);
  } else if (Array.isArray(source.files)) {
    urls.push(...source.files.map((file) => file?.url).filter(Boolean));
  }
  if (entry?.licenceUrl) {
    urls.push(entry.licenceUrl);
  }
  return urls;
}

function isHttps(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function sameOrBelow(url, base) {
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return url === base || url.startsWith(prefix) || `${url}/` === prefix;
}

const REQUIRED_TEXT = [
  'title',
  'licence',
  'licenceUrl',
  'licenceQuote',
  'licenceChecked',
  'citation',
];

function filesProblems(label, source, problem) {
  if (!Array.isArray(source.files) || source.files.length === 0) {
    problem('usage', `${label}: source.files must be a non-empty list`);
    return;
  }
  const names = new Set();
  source.files.forEach((file, at) => {
    const where = `${label}: source.files[${at}]`;
    if (!isObject(file)) {
      problem('usage', `${where} must be an object`);
      return;
    }
    if (
      !/^[A-Za-z0-9._-]+$/.test(file.name ?? '') ||
      file.name.startsWith('.')
    ) {
      problem('usage', `${where}: bad name "${file.name}"`);
    } else if (names.has(file.name)) {
      problem('usage', `${where}: duplicate name "${file.name}"`);
    }
    names.add(file.name);
    if (!isHttps(file.url)) {
      problem('usage', `${where}: url "${file.url}" is not https://`);
    }
    if (file.size === null || file.size === undefined) {
      problem('checksum', `${where}: size is null; run fetch --record`);
    } else if (!Number.isInteger(file.size) || file.size <= 0) {
      problem('usage', `${where}: size must be a positive integer`);
    }
    if (file.sha256 === null || file.sha256 === undefined) {
      problem('checksum', `${where}: sha256 is null; run fetch --record`);
    } else if (!isSha256(file.sha256)) {
      problem('usage', `${where}: sha256 must be 64 lower-case hex digits`);
    }
  });
  source.files.forEach((file, at) => {
    if (file?.transcripts !== undefined && !names.has(file.transcripts)) {
      problem(
        'usage',
        `${label}: source.files[${at}]: transcripts "${file.transcripts}" names no file of the entry`
      );
    }
  });
}

function rowsProblems(label, source, problem) {
  for (const key of ['dataset', 'config', 'split', 'textColumn']) {
    if (!isText(source[key])) {
      problem('usage', `${label}: missing field source.${key}`);
    }
  }
  if (
    !Number.isInteger(source.length) ||
    source.length < 1 ||
    source.length > MAX_ROWS
  ) {
    problem('usage', `${label}: source.length must be 1 to ${MAX_ROWS}`);
  }
  if (source.textSha256 === null || source.textSha256 === undefined) {
    problem(
      'checksum',
      `${label}: source.textSha256 is null; run fetch --record`
    );
  } else if (!isSha256(source.textSha256)) {
    problem(
      'usage',
      `${label}: source.textSha256 must be 64 lower-case hex digits`
    );
  }
}

function idProblems(entry, label, seen, problem) {
  if (entry.id === undefined) {
    problem('usage', `${label}: missing field id`);
  } else if (typeof entry.id !== 'string' || !/^[a-z0-9-]+$/.test(entry.id)) {
    problem('usage', `${label}: bad id; use lower case letters, digits and -`);
  } else if (seen.has(entry.id)) {
    problem('usage', `${label}: duplicate id`);
  }
  seen.add(entry.id);
}

function fieldProblems(entry, label, problem) {
  for (const key of REQUIRED_TEXT) {
    if (!isText(entry[key])) {
      problem('usage', `${label}: missing field ${key}`);
    }
  }
  if (!Array.isArray(entry.languages) || entry.languages.length === 0) {
    problem('usage', `${label}: missing field languages`);
  } else {
    for (const language of entry.languages.filter(
      (item) => !LANGUAGES.includes(item)
    )) {
      problem(
        'usage',
        `${label}: unknown language "${language}"; use ${LANGUAGES.join(', ')}`
      );
    }
  }
  if (entry.licenceUrl !== undefined && !isHttps(entry.licenceUrl)) {
    problem(
      'usage',
      `${label}: licenceUrl "${entry.licenceUrl}" is not https://`
    );
  }
  if (
    isText(entry.licenceChecked) &&
    !/^\d{4}-\d{2}-\d{2}$/.test(entry.licenceChecked)
  ) {
    problem('usage', `${label}: licenceChecked must be a date YYYY-MM-DD`);
  }
}

function licenceProblems(entry, label, policy, problem) {
  const gate = licenceGate(entry, policy);
  if (gate) {
    problem('licence', `${label}: licence refused: ${gate}`);
  }
  if (typeof entry.redistribution !== 'boolean') {
    problem('usage', `${label}: missing field redistribution (true or false)`);
  } else if (entry.redistribution && !REDISTRIBUTABLE.includes(entry.licence)) {
    problem(
      'usage',
      `${label}: redistribution is true but the licence is "${entry.licence}"; only ${REDISTRIBUTABLE.join(' or ')} may be committed`
    );
  }
}

function sourceProblems(entry, label, problem) {
  const source = entry.source;
  if (!isObject(source)) {
    problem('usage', `${label}: missing field source`);
  } else if (source.kind === 'files') {
    filesProblems(label, source, problem);
  } else if (source.kind === 'rows') {
    rowsProblems(label, source, problem);
  } else {
    problem('usage', `${label}: source.kind must be "files" or "rows"`);
  }
}

function refusedProblems(entry, label, refused, problem) {
  for (const url of entryUrls(entry)) {
    const match = refused.find(
      (item) => isText(item?.url) && sameOrBelow(url, item.url)
    );
    if (match) {
      problem(
        'licence',
        `${label}: ${url} belongs to "${match.title}", which datasets/refused.json refuses (${match.reason})`
      );
    }
  }
}

function entryProblems(entry, at, policy, refused, seen, problem) {
  if (!isObject(entry)) {
    problem('usage', `datasets[${at}] must be an object`);
    return;
  }
  const label = typeof entry.id === 'string' ? entry.id : `datasets[${at}]`;
  idProblems(entry, label, seen, problem);
  fieldProblems(entry, label, problem);
  licenceProblems(entry, label, policy, problem);
  sourceProblems(entry, label, problem);
  refusedProblems(entry, label, refused, problem);
}

/**
 * @param {object} registry
 * @param {object} policy
 * @param {object[]} [refused] entries of datasets/refused.json
 * @returns {{kind: 'usage'|'licence'|'checksum', message: string}[]}
 */
export function registryProblems(registry, policy, refused = []) {
  const problems = [];
  const problem = (kind, message) => problems.push({ kind, message });
  if (!isObject(registry)) {
    problem('usage', 'the registry must be an object');
    return problems;
  }
  if (registry.schema !== 1) {
    problem(
      'usage',
      `schema must be 1, not ${JSON.stringify(registry.schema)}`
    );
  }
  if (!Array.isArray(registry.datasets)) {
    problem('usage', 'missing field datasets');
    return problems;
  }
  const seen = new Set();
  registry.datasets.forEach((entry, at) =>
    entryProblems(entry, at, policy, refused, seen, problem)
  );
  return problems;
}

/**
 * @param {object} registry
 * @param {object} policy
 * @param {object[]} [refused]
 * @returns {string[]} one message per error; empty when the registry is valid
 */
export function validateRegistry(registry, policy, refused = []) {
  return registryProblems(registry, policy, refused).map(
    (item) => item.message
  );
}

/** Exit code for a list of registry problems. */
export function problemsExitCode(problems) {
  if (problems.some((item) => item.kind === 'licence')) {
    return EXIT.licence;
  }
  if (problems.some((item) => item.kind === 'checksum')) {
    return EXIT.checksum;
  }
  return problems.length === 0 ? EXIT.ok : EXIT.usage;
}

/**
 * Writes JSON the way Prettier formats it: objects one key per line, arrays
 * of plain values on one line when they fit in 80 columns.
 */
export function formatJson(value, indent = '') {
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    if (value.every((item) => item === null || typeof item !== 'object')) {
      const flat = `[${value.map((item) => JSON.stringify(item)).join(', ')}]`;
      if (indent.length + flat.length <= 60) {
        return flat;
      }
    }
    const items = value.map((item) => `${inner}${formatJson(item, inner)}`);
    return `[\n${items.join(',\n')}\n${indent}]`;
  }
  if (isObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      return '{}';
    }
    const items = keys.map(
      (key) =>
        `${inner}${JSON.stringify(key)}: ${formatJson(value[key], inner)}`
    );
    return `{\n${items.join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Downloads

function budgetOf(maxBytes) {
  return isObject(maxBytes) ? maxBytes : { left: maxBytes ?? Infinity };
}

function spend(budget, bytes, url) {
  budget.left -= bytes;
  if (budget.left < 0) {
    throw new DatasetError(
      `${url}: the download is larger than --max-bytes`,
      EXIT.tooLarge
    );
  }
}

function sizeOf(file) {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

async function drop(response) {
  await response.body?.cancel?.();
}

/** Refuses an answer that is not a usable 200 or a 206 to a range request. */
async function checkStatus(response, url, part, have) {
  const resumed = have > 0 && response.status === 206;
  if (resumed || response.status === 200) {
    return resumed;
  }
  await drop(response);
  if (response.status === 416) {
    rmSync(part, { force: true });
  }
  throw new DatasetError(
    `${url} answered HTTP ${response.status}`,
    EXIT.network
  );
}

/** Refuses a body that the content-length shows to be too large. */
async function checkLength(response, url, part, { size, budget, start }) {
  const length = Number(response.headers.get('content-length'));
  if (!Number.isFinite(length) || length <= 0) {
    return 0;
  }
  if (size && start + length > size) {
    await drop(response);
    rmSync(part, { force: true });
    throw new DatasetError(
      `${url}: the server sends ${start + length} bytes, the registry says ${size}`,
      EXIT.checksum
    );
  }
  if (length > budget.left) {
    await drop(response);
    spend(budget, length, url);
  }
  return length;
}

/** Appends or writes the body to `part`; @returns the bytes written */
async function writeBody(response, url, part, { resumed, budget }) {
  const handle = await open(part, resumed ? 'a' : 'w');
  let written = 0;
  try {
    for await (const chunk of response.body ?? []) {
      written += chunk.length;
      spend(budget, chunk.length, url);
      await handle.write(chunk);
    }
  } finally {
    await handle.close();
  }
  return written;
}

/** One request; writes the body to `part`. @returns {'downloaded'|'resumed'} */
async function requestOnce(url, part, options) {
  const { fetcher, size, budget } = options;
  const have = sizeOf(part);
  const headers = { 'User-Agent': USER_AGENT };
  if (have > 0) {
    headers.Range = `bytes=${have}-`;
  }
  const response = await fetcher(url, { headers, redirect: 'follow' });
  const resumed = await checkStatus(response, url, part, have);
  const start = resumed ? have : 0;
  const length = await checkLength(response, url, part, {
    size,
    budget,
    start,
  });
  const written = await writeBody(response, url, part, { resumed, budget });
  if (length > 0 && written !== length) {
    throw new DatasetError(
      `${url}: the connection closed after ${written} of ${length} bytes`,
      EXIT.network
    );
  }
  return resumed ? 'resumed' : 'downloaded';
}

function unreachable(url, error) {
  return error instanceof DatasetError
    ? error
    : new DatasetError(
        `${url} is unreachable (${error?.cause?.message ?? error?.message ?? error})`,
        EXIT.network
      );
}

/** Requests until `part` is complete; network failures are retried. */
async function retrieve(url, part, options) {
  const { size, attempts, delay } = options;
  for (let attempt = 1; ; attempt += 1) {
    if (size !== null && sizeOf(part) === size) {
      return 'resumed';
    }
    if (size !== null && sizeOf(part) > size) {
      rmSync(part, { force: true });
    }
    try {
      return await requestOnce(url, part, options);
    } catch (error) {
      const final =
        error instanceof DatasetError && error.code !== EXIT.network;
      if (final) {
        rmSync(part, { force: true });
      }
      if (final || attempt >= attempts) {
        throw unreachable(url, error);
      }
      await wait(delay * attempt);
    }
  }
}

/**
 * Downloads `url` to `target` through `<target>.part`, resuming a partial
 * file with a range request, and checks the size and the SHA-256.
 *
 * @param {string} url
 * @param {string} target
 * @param {{size?: number|null, sha256?: string|null, attempts?: number,
 *   delay?: number, fetcher?: typeof fetch,
 *   maxBytes?: number|{left: number}}} [options]
 * @returns {Promise<{path: string, size: number, sha256: string,
 *   status: 'cached'|'downloaded'|'resumed'}>}
 */
export async function downloadFile(url, target, options = {}) {
  const {
    size = null,
    sha256: expected = null,
    attempts = ATTEMPTS,
    delay = DELAY,
    fetcher = globalThis.fetch,
  } = options;
  const sizeWrong = (actual) => size !== null && actual.size !== size;
  const matches = (actual) =>
    !sizeWrong(actual) && (expected === null || actual.sha256 === expected);
  if (expected !== null && existsSync(target)) {
    const actual = await hashFile(target);
    if (matches(actual)) {
      return { path: target, ...actual, status: 'cached' };
    }
    rmSync(target, { force: true });
  }
  mkdirSync(path.dirname(target), { recursive: true });
  const part = `${target}.part`;
  const budget = budgetOf(options.maxBytes);
  const status = await retrieve(url, part, {
    size,
    attempts,
    delay,
    fetcher,
    budget,
  });
  const actual = await hashFile(part);
  if (!matches(actual)) {
    rmSync(part, { force: true });
    const [want, got] = sizeWrong(actual)
      ? [`${size} bytes`, `${actual.size} bytes`]
      : [expected, actual.sha256];
    throw new DatasetError(
      `${url}: expected ${want}, got ${got}; the file was deleted`,
      EXIT.checksum
    );
  }
  renameSync(part, target);
  return { path: target, ...actual, status };
}

/** GET with the same retries as downloadFile; parses JSON. */
async function fetchJson(url, { attempts = ATTEMPTS, delay = DELAY, fetcher }) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetcher(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      });
      if (!response.ok) {
        await response.body?.cancel?.();
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      if (attempt >= attempts) {
        throw new DatasetError(
          `${url} failed (${error?.cause?.message ?? error?.message ?? error})`,
          EXIT.network
        );
      }
      await wait(delay * attempt);
    }
  }
}

// ---------------------------------------------------------------------------
// Datasets

function resolveRegistry(registry) {
  if (isObject(registry)) {
    return { data: registry, file: null };
  }
  const file = registry ?? REGISTRY_FILE;
  return { data: loadRegistry(file), file };
}

/** @returns {object} the entry; throws exit 2 for an unknown id */
export function findEntry(registry, id) {
  const entry = (registry.datasets ?? []).find((item) => item?.id === id);
  if (!entry) {
    throw new DatasetError(`unknown dataset id "${id}"`, EXIT.usage);
  }
  return entry;
}

function attribution(entry) {
  return [
    entry.title,
    `Licence: ${entry.licence}`,
    `Licence source: ${entry.licenceUrl}`,
    `Licence text: ${entry.licenceQuote}`,
    `Citation: ${entry.citation}`,
    '',
    'Fetched by scripts/datasets.mjs of voice-simulator. Do not commit this',
    'folder, attach it to a release or upload it as an artifact.',
    '',
  ].join('\n');
}

const pad = (index) => String(index).padStart(6, '0');
/** The text that `textSha256` pins: one line per row. */
export const joinTexts = (texts) =>
  texts.map((text) => String(text ?? '')).join('\n');

function readRowsJson(dir) {
  try {
    const rows = JSON.parse(readFileSync(path.join(dir, 'rows.json'), 'utf8'));
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

async function fetchFiles(entry, dir, options) {
  const { record, budget } = options;
  const results = [];
  for (const file of entry.source.files) {
    const target = path.join(dir, file.name);
    const result = await downloadFile(file.url, target, {
      ...options,
      size: record ? null : file.size,
      sha256: record ? null : file.sha256,
      maxBytes: budget,
    });
    if (record) {
      file.size = result.size;
      file.sha256 = result.sha256;
    }
    results.push({
      name: file.name,
      status: result.status,
      bytes: result.size,
    });
  }
  return results;
}

/** Rows whose cached audio still matches the SHA-256 stored at its fetch. */
async function cachedRows(dir, previous, limit) {
  const cached = new Set();
  for (const row of (previous ?? []).slice(0, limit)) {
    if (row?.audio && isSha256(row.sha256)) {
      const file = path.join(dir, row.audio);
      if (existsSync(file) && (await hashFile(file)).sha256 === row.sha256) {
        cached.add(row.index);
      }
    }
  }
  return cached;
}

async function fetchRows(entry, dir, options) {
  const { record, limit, budget, endpoint } = options;
  const source = entry.source;
  const want = Math.min(limit, source.length);
  const previous = readRowsJson(dir);
  const sameText =
    previous &&
    isSha256(source.textSha256) &&
    sha256(joinTexts(previous.map((row) => row?.text))) === source.textSha256;
  if (!record && sameText) {
    const cached = await cachedRows(dir, previous, want);
    if (cached.size === Math.min(want, previous.length)) {
      return previous.slice(0, want).map((row) => ({
        name: row.audio,
        status: 'cached',
        bytes: sizeOf(path.join(dir, row.audio)),
      }));
    }
  }
  const page = await fetchJson(rowsUrl(source, { endpoint }), options);
  const rows = (Array.isArray(page?.rows) ? page.rows : [])
    .filter((item) => Number.isInteger(item?.row_idx))
    .sort((a, b) => a.row_idx - b.row_idx)
    .slice(0, source.length);
  if (rows.length === 0) {
    throw new DatasetError(
      `${entry.id}: the rows interface sent no rows`,
      EXIT.network
    );
  }
  const texts = rows.map((item) => item.row?.[source.textColumn]);
  const actual = sha256(joinTexts(texts));
  if (record) {
    source.textSha256 = actual;
  } else if (actual !== source.textSha256) {
    throw new DatasetError(
      `${entry.id}: the text of the rows has SHA-256 ${actual}, the registry says ${source.textSha256}; the dataset changed`,
      EXIT.checksum
    );
  }
  const kept = new Map(
    (sameText ? previous : []).map((row) => [row.index, row])
  );
  const results = await Promise.all(
    rows.slice(0, want).map(async (item, at) => {
      const audio = `audio/${pad(at)}.wav`;
      const src = item.row?.audio?.[0]?.src;
      if (!isText(src)) {
        throw new DatasetError(
          `${entry.id}: row ${at} has no audio link`,
          EXIT.network
        );
      }
      const stored = kept.get(at);
      const result = await downloadFile(src, path.join(dir, audio), {
        ...options,
        sha256:
          stored?.audio === audio && isSha256(stored.sha256)
            ? stored.sha256
            : null,
        maxBytes: budget,
      });
      kept.set(at, { audio, sha256: result.sha256 });
      return { name: audio, status: result.status, bytes: result.size };
    })
  );
  const list = rows.map((item, at) => {
    const gender = item.row?.gender;
    const stored = kept.get(at);
    const audio =
      stored?.audio && existsSync(path.join(dir, stored.audio))
        ? stored.audio
        : null;
    return {
      index: at,
      text: texts[at] ?? null,
      gender: GENDERS[gender] ?? null,
      audio,
      sha256: audio ? stored.sha256 : null,
    };
  });
  writeFileSync(
    path.join(dir, 'rows.json'),
    `${JSON.stringify(list, null, 2)}\n`
  );
  return results;
}

const FETCH_DEFAULTS = {
  limit: DEFAULT_LIMIT,
  cache: DEFAULT_CACHE,
  record: false,
  maxBytes: DEFAULT_MAX_BYTES,
  endpoint: ROWS_ENDPOINT,
  attempts: ATTEMPTS,
  delay: DELAY,
};

/** Drops undefined values, so that they take the defaults. */
const withoutUndefined = (options) =>
  Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== undefined)
  );

/** The licence gate and the registry checks of one entry before a fetch. */
function checkForFetch(entry, record) {
  const policy = loadPolicy();
  const gate = licenceGate(entry, policy);
  if (gate) {
    throw new DatasetError(
      `${entry.id}: licence refused: ${gate}`,
      EXIT.licence
    );
  }
  const problems = registryProblems({ schema: 1, datasets: [entry] }, policy)
    .filter((item) => !(record && item.kind === 'checksum'))
    // Tests serve the data from http://127.0.0.1; the registry check
    // (verify, check:policy) still requires https:// for committed entries.
    .filter((item) => !/ is not https:\/\/$/.test(item.message));
  if (problems.length > 0) {
    throw new DatasetError(
      problems.map((item) => item.message).join('\n'),
      problemsExitCode(problems)
    );
  }
}

/** Refuses a files entry whose missing files exceed `maxBytes`. */
async function checkTotal(entry, dir, maxBytes) {
  let total = 0;
  for (const file of entry.source.files) {
    const target = path.join(dir, file.name);
    const cached =
      existsSync(target) && (await hashFile(target)).sha256 === file.sha256;
    total += cached ? 0 : file.size;
  }
  if (total > maxBytes) {
    throw new DatasetError(
      `${entry.id}: ${total} bytes to download, more than --max-bytes ${maxBytes}`,
      EXIT.tooLarge
    );
  }
}

/**
 * Downloads a dataset into `<cache>/<id>/`. The licence gate always runs.
 *
 * @param {string} id
 * @param {{limit?: number, cache?: string, record?: boolean,
 *   fetcher?: typeof fetch, maxBytes?: number, registry?: string|object,
 *   attempts?: number, delay?: number, endpoint?: string}} [options]
 * @returns {Promise<{id: string, dir: string,
 *   files: {name: string, status: string, bytes: number}[]}>}
 */
export async function fetchDataset(id, options = {}) {
  const { limit, cache, record, fetcher, maxBytes, endpoint, attempts, delay } =
    {
      ...FETCH_DEFAULTS,
      fetcher: globalThis.fetch,
      ...withoutUndefined(options),
    };
  const registry = resolveRegistry(options.registry);
  const entry = findEntry(registry.data, id);
  checkForFetch(entry, record);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new DatasetError('--limit must be a positive integer', EXIT.usage);
  }
  const dir = path.join(cache, id);
  const budget = { left: maxBytes };
  if (entry.source.kind === 'files' && !record) {
    await checkTotal(entry, dir, maxBytes);
  }
  mkdirSync(dir, { recursive: true });
  const shared = { fetcher, attempts, delay, record, limit, budget, endpoint };
  const files =
    entry.source.kind === 'files'
      ? await fetchFiles(entry, dir, shared)
      : await fetchRows(entry, dir, shared);
  writeFileSync(path.join(dir, 'ATTRIBUTION.txt'), attribution(entry));
  if (record && registry.file) {
    writeFileSync(registry.file, `${formatJson(registry.data)}\n`);
  }
  return { id, dir, files };
}

/**
 * Checks what is in the cache against the registry, without the network.
 *
 * @param {string} id
 * @param {{cache?: string, registry?: string|object}} [options]
 * @returns {Promise<{id: string, cached: boolean, present: boolean,
 *   problems: string[]}>} `cached`: complete and verified; `present`: some
 *   of it is in the cache
 */
export function verifyDataset(id, options = {}) {
  const { cache = DEFAULT_CACHE } = options;
  const entry = findEntry(resolveRegistry(options.registry).data, id);
  const dir = path.join(cache, id);
  return entry.source.kind === 'files'
    ? verifyFiles(entry, dir)
    : verifyRows(entry, dir);
}

async function verifyFiles(entry, dir) {
  const problems = [];
  const present = entry.source.files.filter((file) =>
    existsSync(path.join(dir, file.name))
  );
  for (const file of present) {
    const actual = await hashFile(path.join(dir, file.name));
    if (actual.size !== file.size || actual.sha256 !== file.sha256) {
      problems.push(
        `${entry.id}/${file.name}: ${actual.size} bytes, SHA-256 ${actual.sha256}; the registry says ${file.size} bytes, ${file.sha256}`
      );
    }
  }
  const complete = present.length === entry.source.files.length;
  return {
    id: entry.id,
    cached: complete && problems.length === 0,
    present: present.length > 0,
    problems,
  };
}

async function verifyRows(entry, dir) {
  const id = entry.id;
  const problems = [];
  const rows = readRowsJson(dir);
  if (!rows) {
    return { id, cached: false, present: false, problems };
  }
  const actual = sha256(joinTexts(rows.map((row) => row?.text)));
  if (actual !== entry.source.textSha256) {
    problems.push(
      `${id}/rows.json: text SHA-256 ${actual}; the registry says ${entry.source.textSha256}`
    );
  }
  const withAudio = rows.filter((row) => row?.audio);
  for (const row of withAudio) {
    const target = path.join(dir, row.audio);
    const hash = existsSync(target)
      ? (await hashFile(target)).sha256
      : 'missing';
    if (hash !== row.sha256) {
      problems.push(
        `${id}/${row.audio}: SHA-256 ${hash}; rows.json says ${row.sha256}`
      );
    }
  }
  return {
    id,
    cached: withAudio.length > 0 && problems.length === 0,
    present: true,
    problems,
  };
}

/**
 * What is in the cache, ready for a test.
 *
 * @param {string} id
 * @param {{cache?: string, registry?: string|object}} [options]
 * @returns {{id: string, text: string|null, audioPath: string,
 *   gender: string|null}[]}
 */
export function readDataset(id, options = {}) {
  const { cache = DEFAULT_CACHE } = options;
  const entry = findEntry(resolveRegistry(options.registry).data, id);
  const dir = path.join(cache, id);
  if (entry.source.kind === 'rows') {
    return (readRowsJson(dir) ?? [])
      .filter((row) => row?.audio && existsSync(path.join(dir, row.audio)))
      .map((row) => ({
        id: `${id}/${pad(row.index)}`,
        text: row.text ?? null,
        audioPath: path.join(dir, row.audio),
        gender: row.gender ?? null,
      }));
  }
  const text = (name) => {
    const file = name === undefined ? null : path.join(dir, name);
    return file && existsSync(file) ? readFileSync(file, 'utf8') : null;
  };
  return entry.source.files
    .filter((file) => AUDIO_EXTENSIONS.test(file.name))
    .filter((file) => existsSync(path.join(dir, file.name)))
    .map((file) => ({
      id: `${id}/${file.name}`,
      text: text(file.transcripts),
      audioPath: path.join(dir, file.name),
      gender: null,
    }));
}

// ---------------------------------------------------------------------------
// Command line

const USAGE = `Usage:
  node scripts/datasets.mjs list [--json]
  node scripts/datasets.mjs fetch <id>... [--cache <dir>] [--limit <n>] [--max-bytes <n>] [--record]
  node scripts/datasets.mjs verify [<id>...] [--cache <dir>]

Downloads parts of the speech datasets of datasets/registry.json into a local
cache (default .datasets, never committed) and checks their SHA-256. A dataset
whose licence is not in allowedDatasetLicences of scripts/policy-denylist.json
is refused.

  --cache <dir>      cache folder (default .datasets)
  --limit <n>        kind rows: audio of the first n rows only (default ${DEFAULT_LIMIT})
  --max-bytes <n>    refuse a larger download (default ${DEFAULT_MAX_BYTES})
  --record           write the size and SHA-256 of the download into the registry
  --registry <file>  another registry (default datasets/registry.json)

Exit codes: 0 ok, 2 wrong usage or unknown id, 3 licence refused,
4 checksum or size mismatch, 5 too large, 6 network failure.
See docs/CONTRIBUTING.md, section "Datasets".`;

const COMMANDS = new Set(['list', 'fetch', 'verify']);

function positiveInteger(name, value) {
  const number = Number(value);
  if (
    !/^\d+$/.test(value ?? '') ||
    !Number.isSafeInteger(number) ||
    number < 1
  ) {
    throw new DatasetError(`${name} needs a positive integer`, EXIT.usage);
  }
  return number;
}

/** Flags without a value. */
const SWITCHES = {
  '--help': 'help',
  '-h': 'help',
  '--json': 'json',
  '--record': 'record',
};

/** Options with a value, and how to read it. */
const VALUES = {
  '--cache': ['cache', (value) => path.resolve(value)],
  '--registry': ['registry', (value) => path.resolve(value)],
  '--limit': ['limit', (value) => positiveInteger('--limit', value)],
  '--max-bytes': ['maxBytes', (value) => positiveInteger('--max-bytes', value)],
};

function checkCommand(options) {
  if (!options.help && !COMMANDS.has(options.command)) {
    throw new DatasetError(
      options.command === undefined
        ? 'missing command; use list, fetch or verify'
        : `unknown command "${options.command}"; use list, fetch or verify`,
      EXIT.usage
    );
  }
  if (options.command === 'fetch' && options.ids.length === 0) {
    throw new DatasetError('fetch needs at least one dataset id', EXIT.usage);
  }
}

/** @param {string[]} argv */
export function parseArguments(argv) {
  const options = {
    command: undefined,
    ids: [],
    help: false,
    json: false,
    record: false,
    cache: DEFAULT_CACHE,
    limit: DEFAULT_LIMIT,
    maxBytes: DEFAULT_MAX_BYTES,
    registry: REGISTRY_FILE,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i];
    if (Object.hasOwn(SWITCHES, argument)) {
      options[SWITCHES[argument]] = true;
    } else if (Object.hasOwn(VALUES, argument)) {
      if (argv[i + 1] === undefined) {
        throw new DatasetError(`${argument} needs a value`, EXIT.usage);
      }
      const [key, read] = VALUES[argument];
      i += 1;
      options[key] = read(argv[i]);
    } else if (argument.startsWith('-')) {
      throw new DatasetError(`unknown option ${argument}`, EXIT.usage);
    } else if (options.command === undefined) {
      options.command = argument;
    } else {
      options.ids.push(argument);
    }
  }
  checkCommand(options);
  return options;
}

function checkRegistry(registry, out, record = false) {
  // --record fills in the null checksums, so they do not stop it.
  const problems = registryProblems(
    registry,
    loadPolicy(),
    loadRefused()
  ).filter((item) => !(record && item.kind === 'checksum'));
  for (const item of problems) {
    out.error(`datasets: ${item.message}`);
  }
  return problemsExitCode(problems);
}

async function listCommand(registry, options, out) {
  const rows = [];
  for (const entry of registry.datasets) {
    const state = await verifyDataset(entry.id, options);
    rows.push({
      id: entry.id,
      languages: entry.languages,
      licence: entry.licence,
      kind: entry.source?.kind,
      cached: state.cached,
    });
  }
  if (options.json) {
    out.log(JSON.stringify(rows, null, 2));
    return EXIT.ok;
  }
  for (const row of rows) {
    out.log(
      [
        row.id.padEnd(24),
        row.languages.join(',').padEnd(8),
        row.licence.padEnd(18),
        row.kind.padEnd(6),
        row.cached ? 'cached' : 'not cached',
      ].join(' ')
    );
  }
  return EXIT.ok;
}

async function fetchCommand(options, out) {
  for (const id of options.ids) {
    const result = await fetchDataset(id, options);
    for (const file of result.files) {
      out.log(`${id} ${file.name} ${file.status} ${file.bytes} bytes`);
    }
    if (options.record) {
      out.log(
        `${id}: recorded in ${path.relative(process.cwd(), options.registry)}`
      );
    }
  }
  return EXIT.ok;
}

async function verifyCommand(registry, options, out) {
  const ids = options.ids.length
    ? options.ids
    : registry.datasets.map((entry) => entry.id);
  let code = EXIT.ok;
  for (const id of ids) {
    const state = await verifyDataset(id, options);
    for (const problem of state.problems) {
      out.error(`datasets: ${problem}`);
    }
    if (state.problems.length > 0) {
      code = EXIT.checksum;
    }
    const word =
      state.problems.length > 0
        ? 'mismatch'
        : state.present
          ? 'ok'
          : 'not cached';
    out.log(`${id} ${word}`);
  }
  return code;
}

/** @returns {Promise<number>} exit code */
export async function main(argv = process.argv.slice(2), out = console) {
  try {
    const options = parseArguments(argv);
    if (options.help) {
      out.log(USAGE);
      return EXIT.ok;
    }
    const registry = loadRegistry(options.registry);
    for (const id of options.ids) {
      findEntry(registry, id);
    }
    if (options.command === 'list') {
      return await listCommand(registry, options, out);
    }
    const record = options.command === 'fetch' && options.record;
    const code = checkRegistry(registry, out, record);
    if (code !== EXIT.ok) {
      return code;
    }
    return options.command === 'verify'
      ? await verifyCommand(registry, options, out)
      : await fetchCommand(options, out);
  } catch (error) {
    if (error instanceof DatasetError) {
      out.error(`datasets: ${error.message}`);
      return error.code;
    }
    out.error(`datasets: ${error?.stack ?? error}`);
    return EXIT.usage;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
