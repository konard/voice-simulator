---
id: P01
title: Template case studies occupy `docs/case-studies/issue-N` folders
type: Bug
milestone: M0
blocked_by: []
requirements: [R16, R21]
---

## Goal

A folder `docs/case-studies/issue-N` must hold the case study of issue `N` of
this repository and nothing else. Today 19 such folders hold case studies of
another repository. Move them to `docs/case-studies/template-issue-N` so that
the names are free for the issues of this roadmap.

## Why

Every issue of this project is asked to collect its data and analysis in
`docs/case-studies/issue-{id}`. The roadmap creates about seventy issues,
starting at number 13. `docs/case-studies/issue-13` already exists and is about
something else, so the first agent that works on issue 13 will mix its files
with foreign ones, or read the foreign study as if it were context for its
task.

## Current state

List the folders with `ls docs/case-studies`. There are 23:

- Four belong to this repository: `issue-1`, `issue-5`, `issue-9`, `issue-11`.
- Nineteen were inherited from the template this repository was created from
  (`link-foundation/js-ai-driven-development-pipeline-template`): `issue-3`,
  `issue-7`, `issue-13`, `issue-21`, `issue-23`, `issue-25`, `issue-29`,
  `issue-31`, `issue-33`, `issue-36`, `issue-38`, `issue-40`, `issue-41`,
  `issue-42`, `issue-56`, `issue-58`, `issue-75`, `issue-93`, `issue-212`.
  Together they are 235 tracked files and 7.2 MB (`issue-58` alone is 2.8 MB).

Example: `docs/case-studies/issue-13/README.md` starts with "Case Study:
Robust Changeset CI/CD for Concurrent PRs" and describes issue 13 of the
template. This repository has issues 1, 3, 5, 7, 9 and 11 so far, therefore
`issue-3` and `issue-7` already collide with real issues of this repository
(their records are in `dev/log/issues/3` and `dev/log/issues/7`).

Files outside the folders that point into them (found with
`git grep -n "case-studies/issue-"`):

| File                                  | Lines        | Folder                 |
| ------------------------------------- | ------------ | ---------------------- |
| `docs/BEST-PRACTICES.md`              | 118, 305-307 | `issue-25`, `issue-29` |
| `scripts/simulate-fresh-merge.sh`     | 15, 20       | `issue-23`             |
| `.github/workflows/release.yml`       | 210, 277     | `issue-23` (comments)  |
| `experiments/test-detect-changes.mjs` | 84           | `issue-31` (sample)    |
| `CHANGELOG.md`                        | 416, 429     | `issue-23`, `issue-21` |

Configuration that matches the folders by pattern. All of these patterns keep
matching after a rename that stays one level below `docs/case-studies/`:

- `.prettierignore`: `docs/case-studies/*/data/`
- `.jscpd.json`: `**/docs/case-studies/**`
- `eslint.config.js`: `docs/case-studies/**/*.{js,mjs,cjs}` and the ignore
  `docs/case-studies/*/data/**`
- `scripts/check-file-line-limits.sh`, function `is_exempt()`:
  `docs/case-studies/*/data/*`
- `scripts/detect-code-changes.mjs`, `ignoredPathPrefixes`:
  `'docs/case-studies/'`
- `.github/workflows/links.yml`: `--exclude-path docs/case-studies` (asserted
  by `tests/workflow-reliability.test.js`)

Tests mention only made-up paths (`issue-99`, `issue-113`, `issue-141`), so no
test depends on the template folders.

## What to do

1. Rename each of the 19 template folders with `git mv` so that history is
   kept, for example
   `git mv docs/case-studies/issue-13 docs/case-studies/template-issue-13`.
   Do not change the content of the moved files, with one exception in step 3.
   Do not rename `issue-1`, `issue-5`, `issue-9` or `issue-11`.
2. Update the references outside the folders:
   - `docs/BEST-PRACTICES.md`: the four links on lines 118 and 305-307;
   - `scripts/simulate-fresh-merge.sh`: the two comments;
   - `.github/workflows/release.yml`: the two comments;
   - `experiments/test-detect-changes.mjs`: leave as it is (the path is only a
     sample string).
     Do not edit `CHANGELOG.md`, `dev/log/**` or any file under a `data/`
     folder: they are records of the past.
3. Inside the moved folders, fix links that point from one template folder to
   another (`git grep -n "issue-[0-9]*/" docs/case-studies/template-issue-*`
   and check each relative link `../issue-N/`). Change only the link target.
4. Create `docs/case-studies/README.md` with:
   - the rule: "`issue-N` is the case study of issue N of
     konard/voice-simulator. `template-issue-N` is a case study inherited from
     the template repository and is kept for reference only.";
   - a table of the `issue-N` folders (number, title of the issue, link to
     the main document of the folder);
   - a table of the `template-issue-N` folders (number, first heading of the
     folder's `README.md`).
5. Add a line to `docs/CONTRIBUTING.md`, in the section that describes case
   studies if there is one, otherwise at the end of the file: "Case studies of
   this repository live in `docs/case-studies/issue-N` where N is the number
   of the issue in this repository."
6. Add the test from the next section.
7. Run `npm run check` and `npm test`. The link checker is not affected,
   because `docs/case-studies` is excluded from it.

Folders to delete: none. Deleting the template studies is a separate decision
for the owner of the repository; this issue only frees the names.

## Tests

Add `tests/case-study-folders.test.js` (imports `describe`, `it`, `expect`
from `test-anywhere`, like the other tests):

- `keeps issue-N folders for issues of this repository`: read the names in
  `docs/case-studies`. For every name that matches `^issue-(\d+)$`, read the
  main document of the folder (`README.md`; if it does not exist, the first
  `*.md` file in alphabetical order). The text must contain
  `konard/voice-simulator/issues/N` or
  `konard/voice-simulator/pull/` and must not contain
  `js-ai-driven-development-pipeline-template/issues/N`.
- `allows only known folder name patterns`: every directory in
  `docs/case-studies` matches `^issue-\d+$` or `^template-issue-\d+$`.
- `lists every folder in the index`: every directory name appears in
  `docs/case-studies/README.md`.

The test reads files only; it needs no network and no shell, so it runs on
Node.js, Bun and Deno.

## Acceptance criteria

- [ ] `ls docs/case-studies | grep -c '^template-issue-'` prints `19`.
- [ ] `ls docs/case-studies | grep -c '^issue-'` prints the number of case
      studies of this repository (4 at the time of writing, more if other
      issues were merged first).
- [ ] `git grep -n "case-studies/issue-\(3\|7\|13\|21\|23\|25\|29\|31\|33\|36\|38\|40\|41\|42\|56\|58\|75\|93\|212\)/"`
      prints matches only in `CHANGELOG.md`, `dev/log/`, `data/` folders and
      `experiments/test-detect-changes.mjs`.
- [ ] `git log --follow --oneline docs/case-studies/template-issue-13/README.md`
      shows commits older than the rename.
- [ ] `docs/case-studies/README.md` exists and lists all folders.
- [ ] `tests/case-study-folders.test.js` passes on Node.js, Bun and Deno.
- [ ] `npm run check` and `npm test` pass. No changeset is needed (only
      documentation, tests and comments change).

## Out of scope

- Deleting or shortening the template case studies.
- The template analysis documents `docs/ISSUE-199-RELEASE-ANALYSIS.md`,
  `docs/ISSUE-203-ANALYSIS.md`, `docs/ISSUE-216-ANALYSIS.md` and
  `docs/ISSUE-228-ANALYSIS.md`, and the test
  `tests/issue-228-regressions.test.js`. They do not collide with anything.
- The records in `dev/log/`.

## References

- Case study of issue 11, section on the state of the repository:
  `docs/case-studies/issue-11/README.md`.
- The template the folders came from:
  <https://github.com/link-foundation/js-ai-driven-development-pipeline-template>.
