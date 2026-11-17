#!/usr/bin/env node
/** Build-free inventory gate; --write-vectors records the JS reference. */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { ENGINE_FEATURES, JS_ONLY } from '../src/engine/features.js';

export const RUST_FEATURES = 'crates/voice-simulator-core/src/features.rs';

export function checkParity(rustFile = RUST_FEATURES) {
  const source = readFileSync(rustFile, 'utf8');
  const block = source.match(/\/\/ features:start([\s\S]*?)\/\/ features:end/);
  if (!block) throw new Error('Rust feature markers are missing');
  const rust = [...block[1].matchAll(/^\s*"([\w.-]+)",?\s*$/gm)].map(
    (m) => m[1]
  );
  const js = ENGINE_FEATURES.map((f) => f.id);
  const listed = new Set([
    ...ENGINE_FEATURES.flatMap((f) => f.modules),
    ...JS_ONLY.map((f) => f.module),
  ]);
  const unlisted = readdirSync('src/acoustics')
    .filter((name) => name.endsWith('.js'))
    .map((name) => `src/acoustics/${name}`)
    .filter((name) => !listed.has(name));
  const invalid = [];
  for (const f of ENGINE_FEATURES) {
    if (!f.probe || !(f.probe.text || f.probe.ipa) || !f.probe.options)
      invalid.push(`${f.id}: missing probe`);
    const t = f.tolerance;
    if (
      !t ||
      !(
        (t.kind === 'samples' && t.maxError >= 0 && t.maxError <= 1e-4) ||
        (t.kind === 'spectrum' && t.maxDb >= 0 && t.maxDb <= 0.5)
      )
    )
      invalid.push(`${f.id}: missing or invalid tolerance`);
    if (!f.modules?.length || f.modules.some((m) => !existsSync(m)))
      invalid.push(`${f.id}: missing module`);
  }
  for (const entry of JS_ONLY)
    if (!entry.reason?.trim() || !existsSync(entry.module))
      invalid.push(`${entry.module}: invalid JS_ONLY`);
  for (const [name, ids] of [
    ['JavaScript', js],
    ['Rust', rust],
  ]) {
    if (new Set(ids).size !== ids.length)
      invalid.push(`${name}: duplicate feature id`);
  }
  return {
    js,
    rust,
    missingInRust: js.filter((id) => !rust.includes(id)),
    missingInJs: rust.filter((id) => !js.includes(id)),
    unlisted,
    invalid,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    if (args.includes('--write-vectors')) {
      const { writeVectors } = await import('./engine-parity-vectors.mjs');
      await writeVectors();
    } else {
      const index = args.indexOf('--rust-file');
      if (index !== -1 && !args[index + 1])
        throw new Error('--rust-file needs a path');
      const result = checkParity(
        index === -1 ? RUST_FEATURES : args[index + 1]
      );
      if (args.includes('--json')) {
        console.log(JSON.stringify(result));
      } else {
        console.table(
          result.js.map((id) => ({
            feature: id,
            js: true,
            rust: result.rust.includes(id),
          }))
        );
        for (const key of [
          'missingInRust',
          'missingInJs',
          'unlisted',
          'invalid',
        ]) {
          for (const entry of result[key]) console.error(`${key}: ${entry}`);
        }
      }
      if (
        ['missingInRust', 'missingInJs', 'unlisted', 'invalid'].some(
          (key) => result[key].length
        )
      )
        process.exitCode = 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
