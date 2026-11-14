---
id: P03
title: 'Policy check: no neural networks, permissive licences only'
type: Feature
milestone: M0
blocked_by: []
requirements: [R18, R19]
---

## Goal

Add a script that fails the build when the repository starts to depend on a
neural network library, contains a neural model file, or depends on a package
whose licence is not permissive. Make it part of `npm run check` and of CI.

## Why

The issue says: "we should not use any neural networks" and asks that the
result "be given to public domain". `docs/VISION.md` makes both a principle
(principles 1 and 9). A principle that is checked only by reviewers is broken
sooner or later, most likely by an AI agent that reaches for a speech
recogniser to score its output. A machine check makes the rule impossible to
miss.

## Current state

- There is no such check. `npm run check` is
  `npm run lint && npm run format:check && npm run check:duplication`. CI runs
  these three as separate steps in job `lint` of
  `.github/workflows/release.yml`.
- `security.yml` runs CodeQL, `actions/dependency-review-action@v5` with
  `fail-on-severity: high` (vulnerabilities only, no licence rule) and
  `npm audit`.
- Dependencies today: the library has no runtime dependency
  (`package.json` has only `devDependencies`). The app
  `examples/universal-app` depends on `react`, `react-dom`, `three` and the
  `@capacitor/*` packages. There is no `Cargo.toml` yet ({{P09}} adds one).
- Lock files: `package-lock.json` and `examples/universal-app/package-lock.json`
  (both `lockfileVersion` 3, every package entry has a `license` field) and
  `deno.lock`.
- Licences in the two npm lock files today: `MIT`, `ISC`, `Apache-2.0`,
  `BSD-2-Clause`, `BSD-3-Clause`, `BlueOak-1.0.0`, `Unlicense`, `0BSD`,
  `WTFPL`, `Python-2.0` (`argparse`), `CC-BY-4.0` (`caniuse-lite`), and the
  expressions `WTFPL OR ISC`, `(MIT OR CC0-1.0)`, `(WTFPL OR MIT)`.
- No tracked file has a model extension, and no lock file names a neural
  library (`grep -ciE "tensorflow|onnxruntime|transformers|tfjs|whisper"` on
  the three lock files prints 0).
- The word "neural" appears in `docs/` (the vision forbids it by name) and in
  `src/g2p/english-dict.js` (as an English word). A check on words would give
  false alarms, so this check looks at package names, imports and files only.

## What to do

1. Create `scripts/policy-denylist.json`:

   ```json
   {
     "deniedPackages": {
       "npm": ["@tensorflow/*", "tensorflow", "onnxruntime-*", "..."],
       "cargo": ["tch", "candle-*", "burn", "burn-*", "tract-*", "..."],
       "python": ["torch", "tensorflow", "..."]
     },
     "deniedFileExtensions": [".onnx", "..."],
     "allowedLicences": ["MIT", "..."],
     "exceptions": []
   }
   ```

   A package pattern is an exact name, or a prefix that ends with `*`.
   Fill the lists with at least:
   - npm: `@tensorflow/*`, `tensorflow`, `onnxruntime-*`, `onnxjs`,
     `@xenova/transformers`, `@huggingface/transformers`,
     `@huggingface/inference`, `@mlc-ai/*`, `@mediapipe/*`, `brain.js`,
     `synaptic`, `ml5`, `convnetjs`, `neataptic`, `whisper-node`,
     `nodejs-whisper`, `vosk`, `vosk-browser`, `sherpa-onnx*`,
     `@ricky0123/vad-*`, `openai`, `@anthropic-ai/*`, `@google/generative-ai`,
     `replicate`.
   - cargo: `tch`, `candle-*`, `burn`, `burn-*`, `tract-*`, `ort`,
     `onnxruntime`, `tensorflow`, `tflite`, `dfdx`, `rust-bert`,
     `whisper-rs`, `llama-cpp-*`, `vosk`.
   - python: `torch`, `torchaudio`, `tensorflow`, `tflite-runtime`, `keras`,
     `jax`, `flax`, `onnx`, `onnxruntime`, `transformers`, `openai-whisper`,
     `faster-whisper`, `speechbrain`, `espnet`, `vosk`.
   - file extensions: `.onnx`, `.ort`, `.pt`, `.pth`, `.ckpt`,
     `.safetensors`, `.tflite`, `.gguf`, `.ggml`, `.pb`, `.h5`, `.keras`,
     `.mlmodel`, `.mlpackage`.
   - licences (SPDX identifiers): `MIT`, `MIT-0`, `ISC`, `0BSD`,
     `BSD-2-Clause`, `BSD-3-Clause`, `Apache-2.0`, `BlueOak-1.0.0`,
     `Unlicense`, `CC0-1.0`, `WTFPL`, `Zlib`, `Python-2.0`, `CC-BY-4.0`,
     `Unicode-3.0`, `Unicode-DFS-2016`.
   - `exceptions`: a list of `{"rule", "match", "reason"}` objects, empty at
     the start. `rule` is `package`, `file` or `licence`; `match` is the
     package name or the file path; `reason` must be a non-empty sentence.

2. Create `scripts/check-policy.mjs` with these exported functions and a
   command line entry point (`node scripts/check-policy.mjs [--root <dir>]
[--json]`, default root: the repository). Each function returns a list of
   findings `{rule, file, line, name, message}`.
   - `deniedDependencies(root, list)`: names from every tracked
     `package.json` (`dependencies`, `devDependencies`,
     `optionalDependencies`, `peerDependencies`), every `package-lock.json`
     (keys of `packages`, the part after the last `node_modules/`),
     `deno.lock` (keys that start with `npm:` or `jsr:`), every `Cargo.toml`
     (table names under `dependencies`, `dev-dependencies`,
     `build-dependencies`, also with a `target.*.` prefix), every
     `Cargo.lock` (`name = "..."` lines), `requirements*.txt` and
     `pyproject.toml` (the name before any of `=<>~![;` or a space).
   - `deniedImports(root, list)`: in tracked files with the extensions `.js`,
     `.mjs`, `.cjs`, `.jsx`, `.ts`, `.tsx`, `.html`, `.rs`, `.py`, `.sh`,
     `.yml`, `.yaml` and in `Dockerfile`: a denied name inside
     `from '<name>'`, `import('<name>')`, `require('<name>')` (also with
     `/sub/path` after the name and with double quotes), `use <name>::`,
     `extern crate <name>`, Python `import <name>` / `from <name> import`,
     a URL (`https://.../<name>@...` or `.../npm/<name>`), or after
     `npm install`, `npm i`, `npx`, `bunx`, `pip install`, `pip3 install`,
     `cargo add`, `cargo install` on the same line. For Rust and Python
     compare with `-` replaced by `_`.
   - `deniedFiles(root, list)`: tracked files whose name ends with a denied
     extension (case-insensitive).
   - `licenceFindings(root, list)`: for every package entry in every npm lock
     file, evaluate the `license` string: split on `OR` and `AND`
     (parentheses allowed); `A OR B` passes when one side passes, `A AND B`
     when both pass; an identifier passes when it is in `allowedLicences`. A
     missing licence is a finding. When a `Cargo.toml` exists at the root,
     run `cargo metadata --format-version 1` and apply the same rule to the
     `license` field of every package (a `/` between identifiers means
     `OR`); if `cargo` is not installed, add a finding that says so.
   - Tracked files come from `git ls-files`. Skip `docs/`, `dev/log/`,
     `CHANGELOG.md`, `.changeset/`, `scripts/policy-denylist.json` and
     `tests/check-policy.test.js`.
   - A finding is dropped when an exception with the same `rule` and `match`
     exists. An exception that matches nothing is itself a finding (so stale
     exceptions are removed).
   - Print one line per finding (`file:line rule name: message`) and exit
     with 1 if there is any, else print `policy: ok (N packages, M files)`
     and exit with 0. With `--json` print the list as JSON.
3. `package.json`: add `"check:policy": "node scripts/check-policy.mjs"` and
   append `&& npm run check:policy` to `check`.
4. `.github/workflows/release.yml`, job `lint`: add a step
   `Check policy (no neural networks, permissive licences)` that runs
   `npm run check:policy`, after the step that runs
   `npm run check:duplication`.
5. Document the rule in `docs/CONTRIBUTING.md`, section "Policy check": what
   is checked, how to read a finding, and that an exception needs a reason
   and the approval of the repository owner. Link to the section "What counts
   as a neural network" of `docs/VISION.md`.

The check itself must use only Node.js built-ins.

## Tests

Add `tests/check-policy.test.js`. Each case builds a small tree in a temporary
folder (`git init`, write files, `git add`) and calls the exported functions
with `--root`. Register the cases with `itUnless(sandboxed, noPosixShell)`
from `tests/helpers/skip.js`, because they run `git`.

- `passes on this repository`: the command exits with 0 on the real root.
- `finds a denied npm dependency`: `package.json` with
  `"dependencies": {"onnxruntime-node": "1.0.0"}` gives one finding with
  `rule: 'package'`.
- `finds a denied package deep in a lock file`: a `package-lock.json` with
  the key `node_modules/a/node_modules/@tensorflow/tfjs-core`.
- `finds a denied crate`: `Cargo.toml` with `[dependencies]` and
  `candle-core = "0.8"`.
- `finds a denied import`: a file `a.mjs` with a dynamic `import()` of a
  denied name, and a file `b.rs` with `use tch::Tensor;`. Build the strings
  by concatenation so that this test file does not trip the check.
- `finds a model file`: an empty file `voice.ONNX`.
- `evaluates licence expressions`: `(MIT OR GPL-3.0-only)` passes,
  `MIT AND GPL-3.0-only` fails, `GPL-3.0-only` fails, a missing licence
  fails.
- `honours and polices exceptions`: an exception removes its finding; an
  exception that matches nothing produces a finding with `rule: 'exception'`.
- `ignores prose`: a file `docs/a.md` that names a denied package gives no
  finding.

## Acceptance criteria

- [ ] `npm run check:policy` prints `policy: ok` and exits with 0 on the
      branch.
- [ ] Add `"onnxruntime-node": "1.0.0"` to `devDependencies` of
      `package.json` without installing it: the command exits with 1 and
      names the package and the file (then undo the change).
- [ ] `touch model.onnx && git add model.onnx && npm run check:policy` exits
      with 1 (then undo it).
- [ ] `npm run check` runs the policy check; job `lint` in CI shows the new
      step and is green.
- [ ] The nine tests above pass on Node.js, Bun and Deno (or are reported as
      skipped with a reason where `git` cannot be run).
- [ ] `npm run check` and `npm test` pass; a patch changeset is added.

## Out of scope

- Licences and checksums of datasets: {{P04}}.
- Adding the Rust toolchain to CI so that `cargo metadata` runs there:
  {{P09}}. Until then the Cargo licence rule is tested with fixtures only.
- Judging whether an algorithm written in this repository is a neural
  network. That stays a review question; the boundary is in `docs/VISION.md`.

## References

- `docs/VISION.md`, principles 1 and 9 and "What counts as a neural network".
- SPDX License List and SPDX licence expressions: <https://spdx.org/licenses/>.
- The Unlicense: <https://unlicense.org/>.
