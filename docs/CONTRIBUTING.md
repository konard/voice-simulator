# Contributing to js-ai-driven-development-pipeline-template

## Development Workflow

Use Node.js 24 with npm 10.9 or newer for development and release tooling.
Changesets 3 requires a supported Node.js 22.11, 24, or 26+ runtime.

1. **Fork the repository** and clone your fork
2. **Create a feature branch**: `git checkout -b feature/my-feature`
3. **Install dependencies**: `bun install` (or `npm install`)
4. **Make your changes**
5. **Run local checks**: `bun run check`
6. **Create a changeset**: `bun run changeset`
7. **Commit and push** (pre-commit hooks will run automatically)
8. **Create a Pull Request**

## Code Standards

### File Size Limits

**Maximum 1500 lines per file** (enforced via ESLint `max-lines` rule and CI `check-file-line-limits` job).

This benefits both AI and human developers by ensuring files remain readable and maintainable.

### Formatting and Linting

All code must pass:

```bash
# Check formatting
bun run format:check

# Check linting
bun run lint

# Run all checks
bun run check
```

The pre-commit hook runs automatically, but you can also manually format and fix:

```bash
# Auto-fix formatting
bun run format

# Auto-fix lint issues
bun run lint:fix
```

### Testing Requirements

Tests should:

- Cover critical paths
- Work across all runtimes (Node.js, Bun, Deno)
- Use the [test-anywhere](https://github.com/link-foundation/test-anywhere) framework

```bash
# Run tests
bun test --timeout 30000
npm test
deno test -A --parallel
```

Tests that need more than about 10 seconds or a download do not belong in
`tests/*.test.js`; put them into `tests/heavy/` (see "Heavy checks" below).

### Heavy checks

Slow tests (full 3D renders, quality reports against recordings, recognition
of datasets, round trips, voice copying) live in `tests/heavy/` and are named
`<suite>-<topic>.test.js`, where the suite is `quality`, `recognition`,
`roundtrip`, `copy`, `performance` or `gpu`. `npm test`, `bun test` and
`deno test` never run them; [tests/heavy/README.md](../tests/heavy/README.md)
describes the folder and its helpers.

They run in the workflow `Heavy checks`
([.github/workflows/heavy.yml](../.github/workflows/heavy.yml)), which is only
started by hand:

- in the **Actions** tab: choose **Heavy checks**, then **Run workflow**, pick
  the branch, the suite, optionally a `ref` (a branch or tag of this
  repository, or a commit already on `main` or on the branch picked; empty
  means the branch picked)
  and a `limit` (largest number of items, such as utterances or files, that
  each test may process; empty means no limit);
- from the command line:

  ```bash
  gh workflow run heavy.yml -f suite=quality -f limit=5
  # on another branch
  gh workflow run heavy.yml --ref my-branch -f suite=performance
  ```

A run started on `main` writes to the cache scope of `main`, so
[scripts/resolve-heavy-ref.sh](../scripts/resolve-heavy-ref.sh) refuses a
`ref` that names anything else, such as a commit of a fork; to test a pull
request from a fork, start the workflow on its branch after pushing that
branch here.

The run summary shows one row per test file with its result and wall time,
followed by the reports the tests wrote; the reports are also uploaded as the
artifact `heavy-<suite>-<run id>` and kept for 30 days. The step has a budget
of 300 minutes (see [CI-TIMEOUT-BUDGETS.md](CI-TIMEOUT-BUDGETS.md)).

Locally:

```bash
npm run test:heavy -- --suite performance
npm run test:heavy -- --suite performance --limit 2 --out /tmp/heavy
```

Reports go to `reports/heavy/` (`--out` changes the folder): every test writes
`<name>.md` and `<name>.json`, and the runner writes `summary.md`. `reports/`
is never committed. A report that should be kept is copied to `docs/reports/`
by the issue that owns it.

#### Suite `gpu`

The files `gpu-*.test.js` run the WebGPU 3D solver, which Node.js and Bun
lack, so the runner gives them, together with `tests/fdtd-gpu.test.js`, to
`deno test -A --config deno.heavy.json` after the Node.js files. The suite
needs Deno on `PATH`; without it their rows in `summary.md` say
`skipped (no Deno)`. `deno.heavy.json` has its own import of `test-anywhere`
and `"lock": false`: Deno finds `package.json` only next to `deno.json`, and
the lock it would write for this config would replace `deno.lock`.

`REQUIRE_GPU=1` turns a missing adapter into a failure:
`tests/helpers/gpu.js` throws
`REQUIRE_GPU=1 but this runtime has no WebGPU adapter` and the runner exits
with 1 and prints `suite gpu needs Deno on PATH` when Deno is missing. The
workflow sets it for the suites `gpu` and `all`, and the Deno test jobs of
`release.yml` set it on macOS and Windows, whose runners have an adapter.

On Linux without a GPU, Deno's WebGPU falls back to Mesa's software OpenGL ES
driver; install it with

```bash
sudo apt-get install -y --no-install-recommends libegl1 libgles2 libegl-mesa0 libgl1-mesa-dri
deno run -A scripts/gpu-adapter.mjs   # prints the adapter, or null
REQUIRE_GPU=1 npm run test:heavy -- --suite gpu
```

Every GPU test prints its adapter (`WebGPU adapter: {...}`) and the report
`gpu-solver.md` names it. A software adapter says nothing about GPU speed.

### Policy check

The [vision](VISION.md) rules out neural networks and asks for a result in
the public domain. `npm run check:policy` (part of `npm run check` and of the
CI job "Lint and Format Check") enforces both by machine. It uses Node.js
built-ins only, so it also runs before `npm install`. What counts as a neural
network is described in
[What counts as a neural network](VISION.md#what-counts-as-a-neural-network);
the lists the check uses are in `scripts/policy-denylist.json`.

What is checked, in every file that `git ls-files` lists:

- **Dependencies** (`package`): the names in every `package.json`
  (`dependencies`, `devDependencies`, `optionalDependencies`,
  `peerDependencies`), every `package-lock.json`, `deno.lock`, the import map
  of `deno.json`, `Cargo.toml`, `Cargo.lock`, `requirements*.txt` and
  `pyproject.toml` are compared with
  `deniedPackages` (npm, cargo and python). A pattern is an exact name or a
  prefix that ends with `*`; Rust and Python names treat `-` and `_` alike.
- **Imports** (`package`): in `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.tsx`,
  `.html`, `.rs`, `.py`, `.sh`, `.yml`, `.yaml` files and in `Dockerfile`, a
  denied name in `from '...'`, `import('...')`, `require('...')`,
  `use <crate>::`, `extern crate`, Python `import` / `from ... import`, a CDN
  URL (`.../npm/<name>`, `/<name>@<version>`), or after an install command
  such as `npm install`, `npx`, `bunx`, `pip install` or `cargo add`.
- **Model files** (`file`): a file name that ends with one of
  `deniedFileExtensions` (`.onnx`, `.pt`, `.safetensors`, `.gguf`, ...), in
  any case.
- **Licences** (`licence`): the `license` of every package in every npm lock
  file, and of every crate in `cargo metadata` when there is a `Cargo.toml` at
  the root, must pass `allowedLicences`. `A OR B` passes when one side passes,
  `A AND B` when both do; a missing licence fails.
- **Datasets** (`dataset`): every error that `validateRegistry` of
  `scripts/datasets.mjs` finds in `datasets/registry.json` (see
  [Datasets](#datasets)), including a licence that is not in
  `allowedDatasetLicences`, and every tracked file under `.datasets/`. These
  findings cannot be excepted.
- **Lexicon sources** (`lexicon`): `lexiconSources(root, list)` reports every
  entry of `data/lexicon/sources.json` (the sources of the shipped
  pronunciation lexicons) whose `licence` does not pass `allowedLicences`,
  whose `licenceQuote` is empty, that has no `licenceChecked` date or whose
  `url` or file URL lies under a URL of `data/lexicon/refused.json`
  (CC-CEDICT, OpenRussian, Wiktionary and other share-alike, non-commercial
  or unclear sources). These findings cannot be excepted either; add a
  source's licence text and copyright line to `src/g2p/lexicon/NOTICE.md`.

Words are not checked: `docs/`, `dev/log/`, `CHANGELOG.md`, `.changeset/`,
the list itself and its test are skipped, and "neural" may be written
anywhere.

A finding is printed as `file:line rule name: message`, for example:

```text
package.json:4 package onnxruntime-node: depends on the denied npm package (pattern "onnxruntime-*")
```

It means: line 4 of `package.json` names the package `onnxruntime-node`,
which matches the npm pattern `onnxruntime-*`. Remove the dependency, the
import or the file, or choose a package with a permissive licence. Without a
finding the check prints `policy: ok (N packages, M files)`; with `--json` it
prints the findings as JSON, and `--root <dir>` checks another repository.

An exception is an entry
`{"rule": "package" | "file" | "licence", "match": "<package name or file path>", "reason": "<sentence>"}`
in `exceptions`. It needs a non-empty reason and the approval of the
repository owner in the pull request that adds it. An exception that matches
nothing is itself a finding (rule `exception`), so stale exceptions are
removed.

### Datasets

Tests that need real speech take it from the datasets listed in
[datasets/registry.json](../datasets/registry.json). Only that list is
committed; `npm run datasets` (`scripts/datasets.mjs`, Node.js built-ins
only) downloads a small part of a dataset into `.datasets/<id>/`, which git
ignores, and checks it against the SHA-256 in the list.

```bash
npm run datasets -- list                 # id, languages, licence, kind, cached or not
npm run datasets -- fetch fleurs-ru --limit 3
npm run datasets -- verify               # the registry, and the cache without the network
```

`fetch` prints one line per file (`cached`, `downloaded` or `resumed` and
the byte count) and fetches a cached file with the right checksum only once.
Options: `--cache <dir>` (default `.datasets`), `--limit <n>` (kind `rows`:
the audio of the first `n` rows, default 20), `--max-bytes <n>` (refuse a
larger download, default 209715200) and `--record`. Exit codes: 0 ok, 2 wrong
usage or unknown id, 3 licence refused, 4 checksum or size mismatch, 5 too
large, 6 network failure. A download is resumed from `<file>.part` with a
range request; a failed request is tried up to 4 times, waiting 2, 4 and 6
seconds between the attempts.

Every dataset belongs to one of three classes:

1. **May be committed**: licence `Public-Domain` or `CC0-1.0` and no extra
   terms; the entry has `"redistribution": true`. A part of it may be added
   to the repository by the issue that needs it, never the whole cache.
2. **Fetch only**: any other licence of `allowedDatasetLicences` in
   `scripts/policy-denylist.json` (`CC-BY-4.0`, `CC-BY-3.0`, `Apache-2.0`,
   `MIT`, `BSD-2-Clause`, `BSD-3-Clause`, `Unicode-3.0`,
   `Custom-Attribution`); the entry has
   `"redistribution": false`. Tests download it at run time.
3. **Refused**: everything else (non-commercial, no-derivatives, share-alike,
   GPL, paid, behind a login, re-hosting forbidden, unknown). Well-known
   examples are listed with the reason in
   [datasets/refused.json](../datasets/refused.json); a registry entry that
   names one of their URLs is an error. The licence gate has no switch.

To add an entry:

1. Read the licence page and copy the sentence that grants the licence into
   `licenceQuote`, its address into `licenceUrl` and the day into
   `licenceChecked` (`YYYY-MM-DD`). `licence` is an SPDX identifier,
   `Public-Domain` or `Custom-Attribution`.
2. Fill in `id` (lower case letters, digits and `-`), `title`, `languages`
   (`en`, `ru`, `hi`, `zh`), `redistribution`, `citation` and `source`: kind
   `files` (a list of `name`, `url`, `size`, `sha256` and an optional
   `transcripts`, the name of the file with the text) or kind `rows` (the
   Hugging Face rows interface: `dataset`, `config`, `split`, `length` of at
   most 100, `textColumn`, `textSha256`). URLs are `https://`.
3. Never invent a checksum: write `null`, run
   `npm run datasets -- fetch <id> --record`, which downloads the data and
   writes the size and the SHA-256 into the registry, and commit the result.
   `textSha256` of kind `rows` is the SHA-256 of the texts of the rows joined
   with `\n`; it pins the revision, so a changed dataset fails with exit 4.
4. `npm run datasets -- verify` and `npm run check:policy` must pass.

Fetched audio and text never enter the repository, a release or an
artifact: `.datasets/` is ignored, `npm run check:policy` reports a tracked
file under it, and `fetch` writes `ATTRIBUTION.txt` (title, licence, licence
source and citation) next to the data. The workflow `Heavy checks` keeps
`.datasets` in the GitHub Actions cache under the key
`datasets-<hash of datasets/registry.json>`, so a changed registry fetches
again.

In a test, `datasetSkipReason(id)` of `tests/helpers/datasets.js` returns
`null` when the dataset is in the cache and verifies, otherwise the reason
why its first URL cannot be reached (or `null` when it can); pass it to
`itUnless`, then call `fetchDataset(id)` and `readDataset(id)`, which returns
`{id, text, audioPath, gender}` for every cached recording.

### Golden set

[tests/fixtures/golden/](../tests/fixtures/golden/README.md) holds 24 short
sentences from public-domain LibriVox recordings, 6 each in English,
Russian, Hindi and Mandarin, with their text and hand-written IPA. Tests
read them without the network through `loadGolden({ lang, reviewedOnly })`
of `tests/helpers/golden.js`. The fixtures README describes how a file is
made with `node scripts/golden.mjs pauses` and `cut`. After any change,
`node scripts/golden.mjs verify` must print nothing and exit 0. It checks:

- the manifest;
- the SHA-256 of every file;
- the format (16 kHz, mono, 16-bit FLAC);
- the total size (at most 2 000 000 bytes);
- that every source is a `redistribution: true` entry of the registry;
- the rate of speech;
- the IPA.

Only a person who listened to a file may set its `review.text` and
`review.ipa` to `confirmed` and `review.by` to their GitHub name; an
automatic agent never does.

### Listening tests

A blind listening test with
[examples/listening-test/](../examples/listening-test/README.md) is required
before a claim about naturalness is written anywhere: in the README, a
release note, a pull request or a report. The steps for organising one are
in that README; in short:

1. Write a sentences file (`sentences.example.json` shows one trial of each
   kind; `node scripts/listening-test.mjs sus --lang en --count 20 --seed 1`
   writes sentences for intelligibility trials).
2. `node scripts/listening-test.mjs build --sentences <file.json> --out examples/listening-test`
   writes `stimuli/` and `config.js`, which are not committed.
3. Send the folder to at least 8 listeners. With fewer, the report says that
   its numbers support no claim, and no claim may be based on it.
4. `node scripts/listening-test.mjs analyze <result.json>... --out docs/reports/listening/<test id>/report.md`.
   Commit the result files and the report to
   `docs/reports/listening/<test id>/`.

The start screen shows this consent sentence, and only results of
listeners who pressed "Start" after reading it are published: "Your answers
are saved in a file on this computer only. It holds your ratings, the time
you spent on each trial, whether you use headphones and, if you give it,
your native language; it holds no name, address or browser details. By
pressing "Start" you agree that this file may be published as part of the
results of the test."

Audio of other synthesisers enters a test only through `extra` in the
sentences file. It is never committed and no code in this repository runs
another synthesiser.

### Rust engine

The Rust workspace in `crates/` reproduces numerical code of `src/` as one
WebAssembly file. [RUST-ENGINE.md](RUST-ENGINE.md) has the interface rules,
the determinism rules and the parity classes; read it before porting code.
In short:

1. `rustup toolchain install` installs the compiler pinned in
   `rust-toolchain.toml`; `npm run build:wasm` builds
   `src/engine/voice-simulator.wasm`, which is git-ignored.
2. Before a pull request, run `cargo fmt --all --check`,
   `cargo clippy --workspace --all-targets --locked -- -D warnings`,
   `cargo test --workspace --locked` and
   `REQUIRE_WASM=1 node --test tests/rust-parity.test.js`.
3. A new crate is added to `scripts/rust-allowed-crates.json` with its
   licence in the same pull request; only permissive licences are allowed.

Without `cargo` everything else still works: the build script prints a note
and the parity tests are skipped with their reason.

## Version Management with Changesets

This project uses [Changesets](https://github.com/changesets/changesets) to manage versions and changelogs. This eliminates merge conflicts that occur when multiple PRs bump the version in `package.json`.

### Adding a Changeset

When you make changes that affect users, add a changeset:

```bash
bun run changeset
# or
npm run changeset
```

This will prompt you to:

1. Select the type of change (patch/minor/major)
2. Provide a summary of the changes

The changeset will be saved as a markdown file in `.changeset/` and should be committed with your PR.

### Changeset Guidelines

| Type      | When to Use                          | Examples                                            |
| --------- | ------------------------------------ | --------------------------------------------------- |
| **Patch** | Bug fixes, internal changes          | Fix typo, update dependency, refactor internal code |
| **Minor** | New features, non-breaking additions | Add new function, new optional parameter            |
| **Major** | Breaking changes                     | Remove function, change API signature               |

Example changeset summary:

```markdown
Add support for custom configuration via config file
```

### What Changes Need Changesets?

**Required** for:

- Bug fixes
- New features
- Breaking changes
- Public API changes

**Not required** for:

- Documentation-only changes (in `./docs` folder)
- Changes to markdown files
- CI/CD workflow updates (unless they affect users)

### PR guard comparison and local validation

Version and changeset guards compare the PR head with its merge base. CI passes
`GITHUB_BASE_SHA` and `GITHUB_HEAD_SHA`; local runs default to `origin/main` and
`HEAD`. Fetch the base before running the guards. Missing refs, Git failures,
and invalid package metadata fail validation.

The changeset guard counts added fragments only. Exact file moves do not count
as new fragments; replacing a deleted fragment with different content does.
Both paths of a move are checked when deciding whether code requires a fragment.
Markdown, `docs/`, `examples/`,
`experiments/`, `dev/log/`, and changeset metadata are exempt. In multi-language
repositories, unrelated language roots are exempt; shared workflows still
require a fragment. For local directory validation without Git comparison, use
`ALLOW_LOCAL_CHANGESET_SCAN=true node scripts/validate-changeset.mjs`. This
explicit mode is forbidden in CI. Set `DEBUG=1` to print comparison details.

Automated release PRs are exempt only when their author matches the release
actor, both repositories match `GITHUB_REPOSITORY`, and their branch uses a
release prefix. The default author is `github-actions[bot]`. When a dedicated
release token creates PRs as another account, configure repository variable
`RELEASE_PR_ACTOR` to that account's exact login. A branch name alone never
grants an exemption.

## Release Process

The release process is fully automated:

1. **PR with changeset merged** - The changeset is added to `.changeset/`
2. **CI detects changesets** - On push to main, CI checks for pending changesets
3. **Version bump** - Package version is updated based on changeset type
4. **Changelog update** - `CHANGELOG.md` is updated automatically
5. **npm publish** - Package is published via OIDC trusted publishing
6. **GitHub Release** - A release is created with formatted notes

Changesets explicitly uses Prettier in `.changeset/config.json`, matching
`format:check`. Keep that setting when adding runtime configs: auto-detection
selects Deno for any `deno.json`, independently of the npm package-manager
declaration. PR lint checks dry-run `npm run changeset:version` after the fresh
merge simulation and restore the generated metadata and consumed fragments.
This requires no publishing credentials and runs independently of release
credential preflight.

### Multiple Changesets

If multiple PRs are merged before a release:

- All changesets are merged into one
- The highest version bump type wins (major > minor > patch)
- All descriptions are preserved in chronological order

## Pull Request Guidelines

### PR Title

Use a clear, descriptive title that summarizes the change:

```
feat: Add support for custom configuration
fix: Resolve race condition in async handler
docs: Update API documentation for v2
```

### PR Description

Include:

- **What** - Describe the change
- **Why** - Explain the motivation
- **Testing** - How the change was tested

### CI Checks

All PRs must pass:

- [ ] Test compilation (syntax check)
- [ ] Lint, format, and secrets scan
- [ ] File line limits check
- [ ] Changeset validation (for code changes)
- [ ] Documentation validation (when docs change)
- [ ] Tests on all platforms (Ubuntu, macOS, Windows)
- [ ] Tests on all runtimes (Node.js, Bun, Deno)

### Fresh Merge Simulation

The CI workflow automatically:

1. Merges the latest `main` into your PR branch
2. Runs checks against the merged state

If this fails with merge conflicts, you need to:

```bash
git fetch origin main
git merge origin/main
# Resolve conflicts
git push
```

## Questions?

If you have questions about contributing, feel free to open an issue for discussion.

## Case Studies

Case studies of this repository live in `docs/case-studies/issue-N` where N is the number of the issue in this repository.
Folders named `template-issue-N` were inherited from the template repository and are kept for reference only; see the [index of case studies](case-studies/README.md).
