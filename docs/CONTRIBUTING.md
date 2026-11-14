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
  `peerDependencies`), every `package-lock.json`, `deno.lock`, `Cargo.toml`,
  `Cargo.lock`, `requirements*.txt` and `pyproject.toml` are compared with
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
