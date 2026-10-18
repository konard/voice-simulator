## Summary

Three defects in the `preview-regen` job of `.github/workflows/example-app.yml` (template `main` at 0a62b80). The first two are hidden today by #237, because the job's `[[ ]]` tests never run under `sh`. Once #237 is fixed they show up on every drift.

1. **A missing `RELEASE_PR_TOKEN` fails the push even when main accepts a direct push.** The step stops with `::error::RELEASE_PR_TOKEN is required to push generated preview images.` before it tries anything. The dedicated token is only needed when a ruleset sends the commit through the fallback pull request. That is the only case where checks have to run on a PR opened by the bot. A repository without such a ruleset could push with the job's own `GITHUB_TOKEN` (the job already has `contents: write`). The error also does not say where to add the secret.
2. **The summary claims a commit that never happened.** `Summarize regeneration result` prints `::notice::Preview images regenerated and (if applicable) committed to main.` whenever `drift == 'true'`, including when the commit step failed. It also reports "already up to date" when regeneration itself failed and no drift output was written.
3. **The failure artifact lists paths that do not exist.** `Upload screenshot failure artifacts` uploads `web/test-results/` and `web/playwright-report/`. The template has no `web/` directory (`GET /contents/web` returns 404), and the preview script writes only to `docs/screenshots/example-app/`.

## Evidence

In konard/voice-simulator, which already has the #237 fix, main run [39097205073](https://github.com/konard/voice-simulator/actions/runs/39097205073) failed with:

```
##[notice]Preview images regenerated and (if applicable) committed to main.
##[error]RELEASE_PR_TOKEN is required to push generated preview images.
```

That repository has no ruleset and no branch protection, so a direct push with `GITHUB_TOKEN` would have landed the commit.

## Suggested fix (applied in konard/voice-simulator#8)

- Use `GH_TOKEN="${RELEASE_PR_TOKEN:-$BUILT_IN_TOKEN}"`, with `BUILT_IN_TOKEN: ${{ secrets.GITHUB_TOKEN }}`.
- Without `RELEASE_PR_TOKEN`, push directly. If main refuses the push, fail with `::error title=Preview images need RELEASE_PR_TOKEN::`. The message names the required token permissions, links `$SECRETS_URL`, and gives the local alternative (`npm run example:web:preview-images`).
- Give the regenerate and commit steps ids, and build the summary from `steps.regenerate.outcome`, `steps.drift.outputs.drift` and `steps.commit.outcome`.
- Upload `docs/screenshots/example-app/` only.

Commit: https://github.com/konard/voice-simulator/commit/6a307c0
