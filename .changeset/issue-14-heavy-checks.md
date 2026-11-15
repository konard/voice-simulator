---
'voice-simulator': patch
---

The `ref` input of the `Heavy checks` workflow (issue 14) now also accepts a commit that is already on the branch the run was started on, such as a short SHA of a pull request's own branch, besides a branch or tag of this repository or a commit on the default branch (`scripts/resolve-heavy-ref.sh`). A run on the default branch still cannot test code from a fork. The library itself does not change.
