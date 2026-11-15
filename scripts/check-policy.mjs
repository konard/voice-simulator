#!/usr/bin/env node

/**
 * Policy check: no neural networks, permissive licences only (issue 15).
 *
 * Fails when the repository depends on a neural network library, imports
 * one, contains a neural model file, depends on a package whose licence
 * is not in the allow list, lists a speech dataset that the dataset registry
 * check refuses, or tracks a file of the dataset cache (issue 16). The lists live in scripts/policy-denylist.json;
 * the boundary itself is described in docs/VISION.md, section "What counts
 * as a neural network".
 *
 * Usage:
 *   node scripts/check-policy.mjs [--root <dir>] [--list <file>] [--json]
 *
 * The check looks at package names, import statements, install commands and
 * file names only, never at prose: the word "neural" is allowed everywhere.
 * It uses Node.js built-ins only, so it runs before `npm install`.
 *
 * Exit codes: 0 = no finding, 1 = at least one finding, 2 = the check could
 * not run (for example, the root is not a git repository).
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { registryProblems } from './datasets.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
export const LIST_FILE = 'scripts/policy-denylist.json';

/** Paths that may name denied packages in prose or as test data. */
export const SKIPPED_PATHS = [
  'docs/',
  'dev/log/',
  'CHANGELOG.md',
  '.changeset/',
  LIST_FILE,
  'tests/check-policy.test.js',
];

const SCANNED_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.tsx',
  '.html',
  '.rs',
  '.py',
  '.sh',
  '.yml',
  '.yaml',
]);

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];

const CARGO_DEPENDENCY_TABLES = new Set([
  'dependencies',
  'dev-dependencies',
  'build-dependencies',
]);

const RULES = new Set(['package', 'file', 'licence']);

// ---------------------------------------------------------------------------
// Lists and names

/**
 * @param {string} root
 * @param {string} [file] explicit list file
 * @returns {object} the parsed list: the root's own, else this repository's
 */
export function loadList(root = REPO_ROOT, file) {
  const candidates = file
    ? [path.resolve(file)]
    : [path.join(root, LIST_FILE), path.join(REPO_ROOT, LIST_FILE)];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`policy list not found: ${candidates.join(', ')}`);
  }
  const list = JSON.parse(readFileSync(found, 'utf8'));
  return {
    deniedPackages: { npm: [], cargo: [], python: [] },
    deniedFileExtensions: [],
    allowedLicences: [],
    allowedDatasetLicences: [],
    exceptions: [],
    ...list,
  };
}

/**
 * Rust crate names and Python distribution names treat `-` and `_` as the
 * same character (Python also ignores case and treats `.` like `-`).
 *
 * @param {string} name
 * @param {'npm'|'cargo'|'python'} ecosystem
 */
export function normaliseName(name, ecosystem) {
  if (ecosystem === 'cargo') {
    return name.replaceAll('-', '_');
  }
  if (ecosystem === 'python') {
    return name.toLowerCase().replace(/[-_.]+/g, '_');
  }
  return name;
}

/**
 * A pattern is an exact name, or a prefix that ends with `*`.
 *
 * @param {string} name
 * @param {string} pattern
 * @param {'npm'|'cargo'|'python'} ecosystem
 */
export function matchesPattern(name, pattern, ecosystem) {
  const value = normaliseName(name, ecosystem);
  if (pattern.endsWith('*')) {
    return value.startsWith(normaliseName(pattern.slice(0, -1), ecosystem));
  }
  return value === normaliseName(pattern, ecosystem);
}

/** @returns {string|undefined} the first denied pattern that `name` matches */
function deniedPattern(name, ecosystem, list) {
  if (!name) {
    return undefined;
  }
  const patterns = list.deniedPackages?.[ecosystem] ?? [];
  return patterns.find((pattern) => matchesPattern(name, pattern, ecosystem));
}

/**
 * `@scope/name/sub/path@1.2.3` and `npm:name@1` → the package name.
 *
 * @param {string} specifier
 * @returns {string}
 */
export function npmPackageName(specifier) {
  let value = specifier.trim().replace(/^npm:/, '');
  if (value.startsWith('@')) {
    const [scope, rest = ''] = value.split('/');
    value = `${scope}/${rest.split('@')[0]}`;
    return value;
  }
  return value.split('/')[0].split('@')[0];
}

/** The name before any of `=<>~![;@` or white space (PEP 508). */
export function pythonPackageName(requirement) {
  return requirement.trim().split(/[=<>~![;@\s]/)[0];
}

// ---------------------------------------------------------------------------
// Tracked files

/**
 * @param {string} root
 * @returns {string[]} tracked files, with `/` separators, outside the skips
 */
export function trackedFiles(root) {
  const result = spawnSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const reason = result.error?.message ?? result.stderr.trim();
    throw new Error(`git ls-files failed in ${root}: ${reason}`);
  }
  return result.stdout
    .split('\0')
    .filter(Boolean)
    .filter((file) => !isSkipped(file));
}

/** @param {string} file */
export function isSkipped(file) {
  return SKIPPED_PATHS.some((skip) =>
    skip.endsWith('/') ? file.startsWith(skip) : file === skip
  );
}

function readTracked(root, file) {
  try {
    return readFileSync(path.join(root, file), 'utf8');
  } catch {
    // Tracked but deleted from the work tree, or not a regular file.
    return null;
  }
}

const baseName = (file) => file.split('/').pop();

/** @returns {number} 1-based line of the first line that contains `needle` */
function lineOf(lines, needle) {
  const index = lines.findIndex((line) => line.includes(needle));
  return index === -1 ? 1 : index + 1;
}

function finding(rule, file, line, name, message) {
  return { rule, file, line, name, message };
}

// ---------------------------------------------------------------------------
// Dependencies declared in manifests and lock files

function packageJsonEntries(file, text) {
  const json = JSON.parse(text);
  const lines = text.split('\n');
  const entries = [];
  for (const field of DEPENDENCY_FIELDS) {
    for (const [name, version] of Object.entries(json[field] ?? {})) {
      const line = lineOf(lines, `"${name}"`);
      entries.push({ ecosystem: 'npm', name, file, line });
      // An alias, "x": "npm:real-name@1", installs real-name.
      if (typeof version === 'string' && version.startsWith('npm:')) {
        const real = npmPackageName(version);
        entries.push({ ecosystem: 'npm', name: real, file, line });
      }
    }
  }
  return entries;
}

function packageLockEntries(file, text) {
  const json = JSON.parse(text);
  const lines = text.split('\n');
  const entries = [];
  for (const [key, entry] of Object.entries(json.packages ?? {})) {
    if (!key) {
      continue;
    }
    const line = lineOf(lines, `"${key}"`);
    const name = key.split('node_modules/').pop();
    entries.push({ ecosystem: 'npm', name, file, line });
    if (entry?.name && entry.name !== name) {
      entries.push({ ecosystem: 'npm', name: entry.name, file, line });
    }
  }
  return entries;
}

function denoLockEntries(file, text) {
  const json = JSON.parse(text);
  const lines = text.split('\n');
  const entries = [];
  const add = (key, name) =>
    entries.push({
      ecosystem: 'npm',
      name,
      file,
      line: lineOf(lines, `"${key}"`),
    });
  for (const key of Object.keys(json.specifiers ?? {})) {
    if (key.startsWith('npm:') || key.startsWith('jsr:')) {
      add(key, npmPackageName(key.replace(/^jsr:/, '')));
    }
  }
  for (const section of ['npm', 'jsr']) {
    for (const key of Object.keys(json[section] ?? {})) {
      add(key, npmPackageName(key));
    }
  }
  return entries;
}

/**
 * The import map of `deno.json`: `npm:`/`jsr:` specifiers and CDN URLs,
 * also in `scopes`. The lock file lists only what was resolved.
 */
function denoJsonEntries(file, text) {
  const json = JSON.parse(text);
  const lines = text.split('\n');
  const maps = [json.imports ?? {}, ...Object.values(json.scopes ?? {})];
  const entries = [];
  for (const map of maps) {
    for (const value of Object.values(map)) {
      if (typeof value !== 'string') {
        continue;
      }
      const names = /^(?:npm|jsr):/.test(value)
        ? [npmPackageName(value.replace(/^jsr:/, ''))]
        : urlPackageNames(value);
      const line = lineOf(lines, value);
      for (const name of names) {
        entries.push({ ecosystem: 'npm', name, file, line });
      }
    }
  }
  return entries;
}

/** Splits a TOML key such as `target.'cfg(unix)'.dependencies` on dots. */
function tomlKeyParts(key) {
  const parts = [];
  const pattern = /\s*("(?:[^"\\]|\\.)*"|'[^']*'|[^.]+)\s*(?:\.|$)/g;
  for (const match of key.matchAll(pattern)) {
    if (match[1] !== undefined && match[0] !== '') {
      parts.push(match[1].replace(/^["']|["']$/g, '').trim());
    }
  }
  return parts;
}

/** Strips a `#` comment that is not inside a string. */
function stripTomlComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quote) {
      if (char === quote) {
        quote = null;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '#') {
      return line.slice(0, i);
    }
  }
  return line;
}

const TOML_HEADER = /^\s*\[\s*([^[\]]+?)\s*\]\s*$/;
const TOML_KEY = /^\s*("[^"]+"|'[^']+'|[A-Za-z0-9_-]+)\s*(?:\.|=)/;

/**
 * @returns {{name: string, line: number}[]} crates under `[dependencies]`,
 *   `[dev-dependencies]`, `[build-dependencies]`, also with a `target.*.`
 *   or `workspace.` prefix and in the dotted-table form.
 */
export function cargoTomlDependencies(text) {
  const found = [];
  let mode = null;
  text.split('\n').forEach((raw, index) => {
    const line = stripTomlComment(raw);
    const lineNumber = index + 1;
    const header = line.match(TOML_HEADER);
    if (header) {
      let parts = tomlKeyParts(header[1]);
      if (parts[0] === 'target' && parts.length > 2) {
        parts = parts.slice(2);
      } else if (parts[0] === 'workspace') {
        parts = parts.slice(1);
      }
      mode = null;
      if (CARGO_DEPENDENCY_TABLES.has(parts[0])) {
        if (parts.length === 1) {
          mode = 'table';
        } else if (parts.length === 2) {
          found.push({ name: parts[1], line: lineNumber });
          mode = 'crate';
        }
      }
      return;
    }
    if (mode === 'table') {
      const key = line.match(TOML_KEY);
      if (key) {
        found.push({
          name: key[1].replace(/^["']|["']$/g, ''),
          line: lineNumber,
        });
      }
    }
    if (mode === 'table' || mode === 'crate') {
      // A renamed dependency, `alias = { package = "real" }`.
      const renamed = line.match(/\bpackage\s*=\s*["']([^"']+)["']/);
      if (renamed) {
        found.push({ name: renamed[1], line: lineNumber });
      }
    }
  });
  return found;
}

function cargoLockEntries(file, text) {
  const entries = [];
  text.split('\n').forEach((line, index) => {
    const match = line.match(/^\s*name\s*=\s*"([^"]+)"/);
    if (match) {
      entries.push({
        ecosystem: 'cargo',
        name: match[1],
        file,
        line: index + 1,
      });
    }
  });
  return entries;
}

function requirementsEntries(file, text) {
  const entries = [];
  text.split('\n').forEach((raw, index) => {
    const line = raw.replace(/(^|\s)#.*$/, '').trim();
    if (!line || line.startsWith('-')) {
      return;
    }
    entries.push({
      ecosystem: 'python',
      name: pythonPackageName(line),
      file,
      line: index + 1,
    });
  });
  return entries;
}

const PYPROJECT_ARRAY_KEYS = {
  project: new Set(['dependencies']),
  'build-system': new Set(['requires']),
};
const PYPROJECT_ARRAY_TABLES = new Set([
  'project.optional-dependencies',
  'dependency-groups',
]);

function isPoetryDependencyTable(table) {
  return /^tool\.poetry\.(?:(?:dev-)?dependencies|group\.[^.]+\.dependencies)$/.test(
    table
  );
}

/**
 * @returns {{name: string, line: number}[]} requirements in `[project]`
 *   `dependencies`, `[project.optional-dependencies]`,
 *   `[dependency-groups]`, `[build-system]` `requires` and the Poetry
 *   dependency tables.
 */
export function pyprojectDependencies(text) {
  const found = [];
  let table = '';
  let inArray = false;
  const collectStrings = (segment, lineNumber) => {
    for (const match of segment.matchAll(/"([^"]*)"|'([^']*)'/g)) {
      const name = pythonPackageName(match[1] ?? match[2]);
      if (name) {
        found.push({ name, line: lineNumber });
      }
    }
  };
  text.split('\n').forEach((raw, index) => {
    const line = stripTomlComment(raw);
    const lineNumber = index + 1;
    if (inArray) {
      const end = line.indexOf(']');
      collectStrings(end === -1 ? line : line.slice(0, end), lineNumber);
      inArray = end === -1;
      return;
    }
    const header = line.match(TOML_HEADER);
    if (header) {
      table = tomlKeyParts(header[1]).join('.');
      return;
    }
    const assignment = line.match(/^\s*("[^"]+"|'[^']+'|[\w.-]+)\s*=\s*(.*)$/);
    if (!assignment) {
      return;
    }
    const key = assignment[1].replace(/^["']|["']$/g, '');
    if (isPoetryDependencyTable(table)) {
      if (key.toLowerCase() !== 'python') {
        found.push({ name: key, line: lineNumber });
      }
      return;
    }
    const arrayKey =
      PYPROJECT_ARRAY_TABLES.has(table) ||
      PYPROJECT_ARRAY_KEYS[table]?.has(key);
    if (arrayKey && assignment[2].trimStart().startsWith('[')) {
      const value = assignment[2].trimStart().slice(1);
      const end = value.indexOf(']');
      collectStrings(end === -1 ? value : value.slice(0, end), lineNumber);
      inArray = end === -1;
    }
  });
  return found;
}

/**
 * @param {string} file tracked path
 * @param {string} text file contents
 * @returns {{ecosystem: string, name: string, file: string, line: number}[]}
 */
export function dependencyEntries(file, text) {
  const name = baseName(file);
  if (name === 'package.json') {
    return packageJsonEntries(file, text);
  }
  if (name === 'package-lock.json' || name === 'npm-shrinkwrap.json') {
    return packageLockEntries(file, text);
  }
  if (name === 'deno.lock') {
    return denoLockEntries(file, text);
  }
  if (name === 'deno.json') {
    return denoJsonEntries(file, text);
  }
  if (name === 'Cargo.toml') {
    return cargoTomlDependencies(text).map((entry) => ({
      ecosystem: 'cargo',
      file,
      ...entry,
    }));
  }
  if (name === 'Cargo.lock') {
    return cargoLockEntries(file, text);
  }
  if (/^requirements.*\.txt$/.test(name)) {
    return requirementsEntries(file, text);
  }
  if (name === 'pyproject.toml') {
    return pyprojectDependencies(text).map((entry) => ({
      ecosystem: 'python',
      file,
      ...entry,
    }));
  }
  return [];
}

/** Every dependency named by every tracked manifest and lock file. */
export function collectDependencies(root, files = trackedFiles(root)) {
  const entries = [];
  for (const file of files) {
    if (!isManifest(file)) {
      continue;
    }
    const text = readTracked(root, file);
    if (text === null) {
      continue;
    }
    try {
      entries.push(...dependencyEntries(file, text));
    } catch (error) {
      entries.push({ error: error.message, file });
    }
  }
  return entries;
}

function isManifest(file) {
  const name = baseName(file);
  return (
    [
      'package.json',
      'package-lock.json',
      'npm-shrinkwrap.json',
      'deno.lock',
      'deno.json',
      'Cargo.toml',
      'Cargo.lock',
      'pyproject.toml',
    ].includes(name) || /^requirements.*\.txt$/.test(name)
  );
}

/**
 * @param {string} root
 * @param {object} list
 * @param {string[]} [files]
 */
export function deniedDependencies(root, list, files = trackedFiles(root)) {
  const findings = [];
  for (const entry of collectDependencies(root, files)) {
    if (entry.error) {
      findings.push(finding('package', entry.file, 1, entry.file, entry.error));
      continue;
    }
    const pattern = deniedPattern(entry.name, entry.ecosystem, list);
    if (pattern) {
      findings.push(
        finding(
          'package',
          entry.file,
          entry.line,
          entry.name,
          `depends on the denied ${entry.ecosystem} package (pattern "${pattern}")`
        )
      );
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Imports, URLs and install commands in source files

const QUOTED = String.raw`['"\x60]([^'"\x60\s]+)['"\x60]`;
const JS_IMPORTS = [
  new RegExp(String.raw`\bfrom\s*${QUOTED}`, 'g'),
  new RegExp(String.raw`\bimport\s*\(\s*${QUOTED}`, 'g'),
  new RegExp(String.raw`\bimport\s+${QUOTED}`, 'g'),
  new RegExp(String.raw`\brequire\s*\(\s*${QUOTED}`, 'g'),
];
const RUST_IMPORTS = [
  /\buse\s+(?:::)?([A-Za-z_][A-Za-z0-9_]*)\s*::/g,
  /\bextern\s+crate\s+([A-Za-z_][A-Za-z0-9_]*)/g,
];
const PYTHON_IMPORTS = [
  /(?:^|[\s;"'(])import\s+([A-Za-z_][\w.]*(?:\s+as\s+\w+)?(?:\s*,\s*[A-Za-z_][\w.]*(?:\s+as\s+\w+)?)*)/g,
  /(?:^|[\s;"'(])from\s+([A-Za-z_][\w.]*)\s+import\b/g,
];
const URL_PATTERN = /\bhttps?:\/\/[^\s'"\x60<>()]+/g;
const CDN_HOSTS = new Set([
  'unpkg.com',
  'esm.sh',
  'esm.run',
  'cdn.skypack.dev',
  'jspm.dev',
  'ga.jspm.io',
  'bundle.run',
]);
const COMMANDS = [
  {
    ecosystem: 'npm',
    pattern:
      /\b(?:npm\s+(?:install|i|add)|npx|bunx|bun\s+(?:add|x)|pnpm\s+(?:add|dlx)|yarn\s+(?:global\s+)?add|deno\s+(?:add|install))(?=\s|$)(.*)$/,
  },
  {
    ecosystem: 'python',
    pattern:
      /\b(?:pip3?\s+install|python3?\s+-m\s+pip\s+install|uv\s+(?:pip\s+install|add)|poetry\s+add|pipx\s+install|conda\s+install)(?=\s|$)(.*)$/,
  },
  {
    ecosystem: 'cargo',
    pattern: /\bcargo\s+(?:add|install)(?=\s|$)(.*)$/,
  },
];

/** Package names that a URL loads: `.../npm/<name>`, `/<name>@<version>`. */
export function urlPackageNames(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }
  let segments;
  try {
    segments = parsed.pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    return [];
  }
  const names = new Set();
  // A scoped name spans two segments; read it as one.
  const nameAt = (index) =>
    segments[index]?.startsWith('@') && segments[index + 1]
      ? npmPackageName(`${segments[index]}/${segments[index + 1]}`)
      : npmPackageName(segments[index] ?? '');
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment.startsWith('npm:')) {
      names.add(npmPackageName(segment));
    } else if (segment === 'npm' && segments[index + 1]) {
      names.add(nameAt(index + 1));
    } else if (segment.startsWith('@') && segments[index + 1]) {
      if (segments[index + 1].includes('@')) {
        names.add(nameAt(index));
      }
      index += 1;
    } else if (/^[^@]+@/.test(segment)) {
      names.add(npmPackageName(segment));
    }
  }
  if (CDN_HOSTS.has(parsed.hostname) && segments.length > 0) {
    names.add(nameAt(0));
  }
  names.delete('');
  return [...names];
}

/** Arguments of an install command up to the next shell separator. */
function commandArguments(rest) {
  const command = rest.split(/&&|\|\||[;|`)]|\s#/)[0];
  return command
    .split(/\s+/)
    .map((token) => token.replace(/^['",]+|['",\\]+$/g, ''))
    .filter((token) => token && !token.startsWith('-') && !token.includes('$'));
}

function commandPackageName(token, ecosystem) {
  if (ecosystem === 'npm') {
    return npmPackageName(token);
  }
  if (ecosystem === 'python') {
    return pythonPackageName(token);
  }
  return token.split('@')[0];
}

/**
 * @param {string} file tracked path
 * @param {string} text file contents
 * @returns {{ecosystem: string, name: string, line: number, how: string}[]}
 */
export function importedNames(file, text) {
  const name = baseName(file);
  const extension = path.extname(name).toLowerCase();
  const isDockerfile = /^Dockerfile(\..+)?$/i.test(name);
  const isShellLike =
    isDockerfile || ['.sh', '.yml', '.yaml'].includes(extension);
  const python = extension === '.py' || isShellLike;
  const rust = extension === '.rs';
  const names = [];
  text.split('\n').forEach((line, index) => {
    const add = (ecosystem, value, how) =>
      names.push({ ecosystem, name: value, line: index + 1, how });
    for (const pattern of JS_IMPORTS) {
      for (const match of line.matchAll(pattern)) {
        add('npm', npmPackageName(match[1]), 'import');
      }
    }
    if (rust) {
      for (const pattern of RUST_IMPORTS) {
        for (const match of line.matchAll(pattern)) {
          add('cargo', match[1], 'use');
        }
      }
    }
    if (python) {
      for (const pattern of PYTHON_IMPORTS) {
        for (const match of line.matchAll(pattern)) {
          for (const part of match[1].split(',')) {
            const module = part.trim().split(/\s+/)[0].split('.')[0];
            add('python', module, 'import');
          }
        }
      }
    }
    for (const match of line.matchAll(URL_PATTERN)) {
      for (const value of urlPackageNames(match[0])) {
        add('npm', value, 'URL');
      }
    }
    for (const { ecosystem, pattern } of COMMANDS) {
      const match = line.match(pattern);
      if (match) {
        for (const token of commandArguments(match[1])) {
          add(ecosystem, commandPackageName(token, ecosystem), 'install');
        }
      }
    }
  });
  return names;
}

/** @param {string} file */
export function isScanned(file) {
  const name = baseName(file);
  return (
    SCANNED_EXTENSIONS.has(path.extname(name).toLowerCase()) ||
    /^Dockerfile(\..+)?$/i.test(name)
  );
}

/**
 * @param {string} root
 * @param {object} list
 * @param {string[]} [files]
 */
export function deniedImports(root, list, files = trackedFiles(root)) {
  const findings = [];
  for (const file of files.filter(isScanned)) {
    const text = readTracked(root, file);
    if (text === null) {
      continue;
    }
    for (const entry of importedNames(file, text)) {
      const pattern = deniedPattern(entry.name, entry.ecosystem, list);
      if (pattern) {
        findings.push(
          finding(
            'package',
            file,
            entry.line,
            entry.name,
            `${entry.how} of the denied ${entry.ecosystem} package (pattern "${pattern}")`
          )
        );
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Model files

/**
 * @param {string} root
 * @param {object} list
 * @param {string[]} [files]
 */
export function deniedFiles(root, list, files = trackedFiles(root)) {
  const extensions = (list.deniedFileExtensions ?? []).map((extension) =>
    extension.toLowerCase()
  );
  const findings = [];
  for (const file of files) {
    // Every path segment, so files inside a `.mlpackage` folder count too.
    const segment = file
      .split('/')
      .map((part) => part.toLowerCase())
      .find((part) => extensions.some((extension) => part.endsWith(extension)));
    if (segment) {
      const extension = extensions.find((value) => segment.endsWith(value));
      findings.push(
        finding(
          'file',
          file,
          1,
          file,
          `has the model file extension "${extension}"`
        )
      );
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Licences

function licenceTokens(expression) {
  return expression
    .replace(/[()]/g, ' $& ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Evaluates an SPDX licence expression against the allow list: `A OR B`
 * passes when one side passes, `A AND B` when both pass, and `AND` binds
 * tighter than `OR`. `A WITH exception` is judged by `A`; a trailing `+`
 * ("or later") is ignored.
 *
 * @param {unknown} expression
 * @param {string[]} allowed
 * @returns {{ok: boolean, reason?: string}}
 */
export function evaluateLicence(expression, allowed) {
  const text = licenceText(expression);
  if (!text) {
    return { ok: false, reason: 'has no licence' };
  }
  const tokens = licenceTokens(text);
  let position = 0;
  const peek = () => tokens[position];
  const isOperator = (token, operator) => token?.toUpperCase() === operator;
  const fail = (why) => {
    throw new Error(why);
  };

  const parsePrimary = () => {
    const token = tokens[position];
    position += 1;
    if (token === undefined) {
      return fail('ends early');
    }
    if (token === '(') {
      const value = parseOr();
      if (tokens[position] !== ')') {
        fail('has an unclosed parenthesis');
      }
      position += 1;
      return value;
    }
    if (token === ')' || ['AND', 'OR', 'WITH'].includes(token.toUpperCase())) {
      return fail(`has "${token}" where a licence was expected`);
    }
    if (isOperator(peek(), 'WITH')) {
      position += 2;
    }
    return allowed.includes(token.replace(/\+$/, ''));
  };
  const parseAnd = () => {
    let value = parsePrimary();
    while (isOperator(peek(), 'AND')) {
      position += 1;
      value = parsePrimary() && value;
    }
    return value;
  };
  const parseOr = () => {
    let value = parseAnd();
    while (isOperator(peek(), 'OR')) {
      position += 1;
      value = parseAnd() || value;
    }
    return value;
  };

  try {
    const ok = parseOr();
    if (position !== tokens.length) {
      fail(`has "${tokens[position]}" after the end of the expression`);
    }
    return ok
      ? { ok: true }
      : { ok: false, reason: `licence "${text}" is not permissive` };
  } catch (error) {
    return {
      ok: false,
      reason: `licence "${text}" is not an SPDX expression: it ${error.message}`,
    };
  }
}

/** Accepts the old `{type}` object and `licenses` array forms as well. */
function licenceText(value) {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const parts = value.map(licenceText).filter(Boolean);
    return parts.length > 1
      ? parts.map((part) => `(${part})`).join(' OR ')
      : (parts[0] ?? '');
  }
  if (value && typeof value === 'object' && typeof value.type === 'string') {
    return value.type.trim();
  }
  return '';
}

/**
 * Applies the licence rule to the packages of `cargo metadata` output; a
 * `/` between identifiers means `OR`.
 *
 * @param {{packages?: {name: string, license?: string|null}[]}} metadata
 * @param {object} list
 * @param {string} [file]
 */
export function cargoLicenceFindings(metadata, list, file = 'Cargo.toml') {
  const findings = [];
  for (const pkg of metadata.packages ?? []) {
    const expression = (pkg.license ?? '').replaceAll('/', ' OR ');
    const result = evaluateLicence(expression, list.allowedLicences ?? []);
    if (!result.ok) {
      findings.push(
        finding('licence', file, 1, pkg.name, `crate ${result.reason}`)
      );
    }
  }
  return findings;
}

/**
 * @param {string} root
 * @param {object} list
 * @param {string[]} [files]
 * @param {{cargo?: string}} [options] the `cargo` command to run
 */
export function licenceFindings(
  root,
  list,
  files = trackedFiles(root),
  { cargo = 'cargo' } = {}
) {
  const findings = [];
  for (const file of files) {
    const name = baseName(file);
    if (name !== 'package-lock.json' && name !== 'npm-shrinkwrap.json') {
      continue;
    }
    const text = readTracked(root, file);
    if (text !== null) {
      findings.push(...lockLicenceFindings(file, text, list));
    }
  }
  if (existsSync(path.join(root, 'Cargo.toml'))) {
    findings.push(...cargoMetadataFindings(root, list, cargo));
  }
  return findings;
}

/** The licence rule for every package entry of one npm lock file. */
function lockLicenceFindings(file, text, list) {
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return [
      finding('licence', file, 1, file, `cannot be read: ${error.message}`),
    ];
  }
  const lines = text.split('\n');
  const findings = [];
  for (const [key, entry] of Object.entries(json.packages ?? {})) {
    if (entry?.link) {
      // A workspace link; its target has its own entry.
      continue;
    }
    const result = evaluateLicence(
      entry?.license ?? entry?.licenses,
      list.allowedLicences ?? []
    );
    if (!result.ok) {
      const packageName =
        entry?.name ?? (key ? key.split('node_modules/').pop() : json.name);
      findings.push(
        finding(
          'licence',
          file,
          lineOf(lines, `"${key}"`),
          packageName,
          `package ${result.reason}`
        )
      );
    }
  }
  return findings;
}

function cargoMetadataFindings(root, list, cargo) {
  const result = spawnSync(cargo, ['metadata', '--format-version', '1'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error?.code === 'ENOENT') {
    return [
      finding(
        'licence',
        'Cargo.toml',
        1,
        'cargo',
        'cargo is not installed, so the licences of the crates cannot be checked'
      ),
    ];
  }
  if (result.error || result.status !== 0) {
    const reason = result.error?.message ?? result.stderr.trim();
    return [
      finding(
        'licence',
        'Cargo.toml',
        1,
        'cargo',
        `cargo metadata failed: ${reason}`
      ),
    ];
  }
  return cargoLicenceFindings(JSON.parse(result.stdout), list);
}

// ---------------------------------------------------------------------------
// Speech datasets (issue 16)

export const DATASET_REGISTRY = 'datasets/registry.json';
export const DATASET_REFUSED = 'datasets/refused.json';
export const DATASET_CACHE = '.datasets/';

function readJson(root, file) {
  const full = path.join(root, file);
  return existsSync(full) ? JSON.parse(readFileSync(full, 'utf8')) : null;
}

/**
 * Every error of the dataset registry check, and every tracked file of the
 * dataset cache, is a finding with rule `dataset`. No exception covers it.
 *
 * @param {string} root
 * @param {object} list
 * @param {string[]} [files]
 */
export function datasetFindings(root, list, files = trackedFiles(root)) {
  const findings = files
    .filter((file) => file.startsWith(DATASET_CACHE))
    .map((file) =>
      finding(
        'dataset',
        file,
        1,
        file,
        'is in the dataset cache; fetched data never enters the repository'
      )
    );
  let registry;
  try {
    registry = readJson(root, DATASET_REGISTRY);
  } catch (error) {
    findings.push(
      finding('dataset', DATASET_REGISTRY, 1, DATASET_REGISTRY, error.message)
    );
    return findings;
  }
  if (registry === null) {
    return findings;
  }
  const lines = readFileSync(path.join(root, DATASET_REGISTRY), 'utf8').split(
    '\n'
  );
  const refused = readJson(root, DATASET_REFUSED) ?? [];
  for (const { message } of registryProblems(registry, list, refused)) {
    const name = message.split(':')[0];
    const line = lineOf(lines, `"id": "${name}"`);
    const text = message.slice(name.length + 1).trim() || message;
    findings.push(finding('dataset', DATASET_REGISTRY, line, name, text));
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Exceptions and the whole check

/**
 * Drops each finding that an exception covers and reports each exception
 * that is malformed or covers nothing, so stale exceptions get removed.
 *
 * @param {object[]} findings
 * @param {{rule: string, match: string, reason: string}[]} exceptions
 */
export function applyExceptions(findings, exceptions = []) {
  const problems = exceptions.map((exception) => {
    if (!RULES.has(exception?.rule)) {
      return `exception has rule "${exception?.rule}"; use package, file or licence`;
    }
    if (typeof exception.match !== 'string' || !exception.match) {
      return 'exception needs a match';
    }
    if (typeof exception.reason !== 'string' || !exception.reason.trim()) {
      return 'exception needs a non-empty reason';
    }
    return null;
  });
  const used = new Set();
  const covers = (exception, item) =>
    exception.rule === item.rule &&
    (item.rule === 'file' ? item.file : item.name) === exception.match;
  const kept = findings.filter((item) => {
    // A malformed exception covers nothing.
    const index = exceptions.findIndex(
      (exception, at) => problems[at] === null && covers(exception, item)
    );
    if (index === -1) {
      return true;
    }
    used.add(index);
    return false;
  });
  exceptions.forEach((exception, index) => {
    const problem =
      problems[index] ??
      (used.has(index)
        ? null
        : `exception for rule "${exception.rule}" matches nothing; remove it`);
    if (problem) {
      const label = String(exception?.match ?? `#${index + 1}`);
      kept.push(finding('exception', LIST_FILE, 1, label, problem));
    }
  });
  return kept;
}

/**
 * @param {string} [root]
 * @param {object} [list]
 * @param {{cargo?: string}} [options]
 * @returns {{findings: object[], packages: number, files: number}}
 */
export function checkPolicy(root = REPO_ROOT, list = loadList(root), options) {
  const files = trackedFiles(root);
  const raw = [
    ...deniedDependencies(root, list, files),
    ...deniedImports(root, list, files),
    ...deniedFiles(root, list, files),
    ...licenceFindings(root, list, files, options),
  ];
  // Kept out of applyExceptions: the dataset licence gate cannot be
  // switched off.
  const datasets = datasetFindings(root, list, files);
  const packages = new Set(
    collectDependencies(root, files)
      .filter((entry) => !entry.error)
      .map(
        (entry) =>
          `${entry.ecosystem}:${normaliseName(entry.name, entry.ecosystem)}`
      )
  );
  return {
    findings: [...applyExceptions(raw, list.exceptions ?? []), ...datasets],
    packages: packages.size,
    files: files.length,
  };
}

/** @param {{file: string, line: number, rule: string, name: string, message: string}} item */
export function formatFinding(item) {
  return `${item.file}:${item.line} ${item.rule} ${item.name}: ${item.message}`;
}

/** @param {string[]} argv */
export function parseArguments(argv) {
  const options = { root: REPO_ROOT, json: false, list: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i];
    if (argument === '--json') {
      options.json = true;
    } else if (argument === '--root' || argument === '--list') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error(`${argument} needs a value`);
      }
      options[argument.slice(2)] = path.resolve(value);
      i += 1;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return options;
}

const USAGE = `Usage: node scripts/check-policy.mjs [--root <dir>] [--list <file>] [--json]

Fails when the repository depends on or imports a neural network library,
contains a neural model file, or depends on a package whose licence is not
in the allow list. The lists are in ${LIST_FILE}.`;

/** @returns {number} exit code */
export function main(argv = process.argv.slice(2)) {
  let options;
  let result;
  try {
    options = parseArguments(argv);
    if (options.help) {
      console.log(USAGE);
      return 0;
    }
    result = checkPolicy(options.root, loadList(options.root, options.list));
  } catch (error) {
    console.error(`policy: cannot run the check: ${error.message}`);
    return 2;
  }
  const { findings, packages, files } = result;
  if (options.json) {
    console.log(JSON.stringify(findings, null, 2));
  } else if (findings.length === 0) {
    console.log(`policy: ok (${packages} packages, ${files} files)`);
  } else {
    for (const item of findings) {
      console.log(formatFinding(item));
    }
    console.log(
      `policy: ${findings.length} finding(s); see docs/CONTRIBUTING.md, section "Policy check"`
    );
  }
  return findings.length === 0 ? 0 : 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
