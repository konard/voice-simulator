/**
 * Rules for the Rust workspace (docs/RUST-ENGINE.md): every crate in
 * Cargo.lock is one of ours or is listed with its licence in
 * scripts/rust-allowed-crates.json, the toolchain is an exact stable
 * version, and the core crate keeps its no_std, libm-in-math.rs shape with
 * unsafe code only in the thread team and private validated grid step.
 * These read files only, so they run without a Rust toolchain.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'test-anywhere';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

const WORKSPACE_CRATES = [
  'voice-simulator-cli',
  'voice-simulator-core',
  'voice-simulator-wasm',
];

/** Paths of the .rs files under `dir` (relative to it, with `/`). */
function rustFiles(dir, prefix = '') {
  return readdirSync(path.join(root, dir, prefix), {
    withFileTypes: true,
  }).flatMap((entry) => {
    const file = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      return rustFiles(dir, file);
    }
    return file.endsWith('.rs') ? [file] : [];
  });
}

/** `[[package]]` entries of a Cargo.lock as {name, source}. */
function lockPackages(text) {
  return text
    .split(/^\[\[package\]\]$/m)
    .slice(1)
    .map((block) => ({
      name: /^name = "([^"]+)"$/m.exec(block)?.[1],
      source: /^source = "([^"]+)"$/m.exec(block)?.[1] ?? null,
    }));
}

describe('Rust workspace', () => {
  const allowed = JSON.parse(read('scripts/rust-allowed-crates.json'));
  const packages = lockPackages(read('Cargo.lock'));

  it('lists the three crates as workspace members', () => {
    const members = /members\s*=\s*\[([^\]]*)\]/.exec(read('Cargo.toml'))[1];
    const names = [...members.matchAll(/"crates\/([^"]+)"/g)].map((m) => m[1]);
    expect(names.sort()).toEqual(WORKSPACE_CRATES);
  });

  it('every crate in Cargo.lock is ours or allowed with its licence', () => {
    expect(packages.length > 0).toBe(true);
    const unknown = packages
      .filter(({ name }) => !WORKSPACE_CRATES.includes(name))
      .filter(({ name }) => !Object.hasOwn(allowed, name))
      .map(({ name }) => name);
    expect(unknown).toEqual([]);
    for (const { name, source } of packages) {
      // Our crates come from the workspace, others from crates.io.
      expect(source === null).toBe(WORKSPACE_CRATES.includes(name));
    }
  });

  it('the allow list has no unused entries and names a licence for each', () => {
    const used = new Set(packages.map(({ name }) => name));
    for (const [name, licence] of Object.entries(allowed)) {
      expect(used.has(name)).toBe(true);
      expect(
        /^(MIT|Apache-2\.0|BSD-[23]-Clause|ISC|Zlib|Unlicense)$/.test(licence)
      ).toBe(true);
    }
  });

  it('pins an exact stable toolchain', () => {
    const channel = /^channel\s*=\s*"([^"]+)"$/m.exec(
      read('rust-toolchain.toml')
    )?.[1];
    expect(/^\d+\.\d+\.\d+$/.test(channel ?? '')).toBe(true);
    const toolchain = read('rust-toolchain.toml');
    expect(toolchain.includes('wasm32-unknown-unknown')).toBe(true);
  });

  it('keeps the core crate no_std, with libm only in math.rs', () => {
    const lib = read('crates/voice-simulator-core/src/lib.rs');
    expect(lib.includes('#![no_std]')).toBe(true);
    const dir = 'crates/voice-simulator-core/src';
    const usesLibm = readdirSync(path.join(root, dir))
      .filter((file) => file.endsWith('.rs'))
      .filter((file) => /\blibm::/.test(read(path.join(dir, file))));
    expect(usesLibm).toEqual(['math.rs']);
  });

  it('limits core unsafe code to the thread team and validated grid step', () => {
    const manifest = read('crates/voice-simulator-core/Cargo.toml');
    expect(/^\[lints\.rust\]\r?\nunsafe_code = "deny"$/m.test(manifest)).toBe(
      true
    );
    const dir = 'crates/voice-simulator-core/src';
    const files = rustFiles(dir);
    const unsafeFiles = files.filter((file) =>
      /\bunsafe\b/.test(read(path.join(dir, file)))
    );
    expect(unsafeFiles.sort()).toEqual(['fdtd/parallel.rs', 'fdtd/solver.rs']);
    for (const file of unsafeFiles) {
      const source = read(path.join(dir, file));
      const blocks = source.match(/\bunsafe\s*\{/g) ?? [];
      const reasons = source.match(/\/\/ SAFETY:/g) ?? [];
      expect(blocks.length > 0).toBe(true);
      expect(reasons.length >= blocks.length).toBe(true);
    }
    const solver = read(path.join(dir, 'fdtd/solver.rs'));
    expect(solver.match(/#\[allow\(unsafe_code\)\]/g)?.length).toBe(1);
    expect(/#\[allow\(unsafe_code\)\]\s+fn step_grid\(/.test(solver)).toBe(
      true
    );
    expect(solver.match(/\bunsafe\s*\{/g)?.length).toBe(1);
  });
});
