#!/usr/bin/env bash
# Resolve the `ref` input of the Heavy checks workflow (.github/workflows/
# heavy.yml) to the commit to test, and write `revision=<sha>` to
# $GITHUB_OUTPUT.
#
# A run started on the default branch writes to that branch's cache scope,
# so it must not execute code from outside this repository (CodeQL rule
# actions/cache-poisoning/poisonable-step). WANTED is therefore accepted
# only as
#   - empty: FALLBACK_SHA, the commit of the branch chosen in the form;
#   - the name of a branch or a tag of REPOSITORY;
#   - a commit SHA (7 to 40 hex digits) already on DEFAULT_BRANCH, or already
#     on the branch chosen in the form (an ancestor of FALLBACK_SHA): that
#     branch's code runs in this job anyway, and on the default branch the
#     two rules are the same.
# Anything else, such as the head commit of a pull request from a fork,
# fails with exit code 1.
set -euo pipefail

: "${REPOSITORY:?REPOSITORY is required (owner/name)}"
: "${DEFAULT_BRANCH:?DEFAULT_BRANCH is required}"
: "${FALLBACK_SHA:?FALLBACK_SHA is required}"
wanted="${WANTED:-}"
output="${GITHUB_OUTPUT:-/dev/null}"

if [ -z "${wanted}" ]; then
  echo "Testing the chosen branch at ${FALLBACK_SHA}"
  echo "revision=${FALLBACK_SHA}" >>"${output}"
  exit 0
fi

# Git ref names never start with "-" nor contain "..".
if [[ ! "${wanted}" =~ ^[A-Za-z0-9._/][A-Za-z0-9._/-]*$ ]] || [[ "${wanted}" == *..* ]]; then
  echo "::error::ref '${wanted}' is not a valid branch, tag or commit name."
  exit 1
fi

name=''
if gh api "repos/${REPOSITORY}/git/ref/heads/${wanted}" >/dev/null 2>&1; then
  name="refs/heads/${wanted}"
elif gh api "repos/${REPOSITORY}/git/ref/tags/${wanted}" >/dev/null 2>&1; then
  name="refs/tags/${wanted}"
elif [[ "${wanted}" =~ ^[0-9a-f]{7,40}$ ]]; then
  # base...head: "ahead" or "identical" means the commit is an ancestor of
  # head, so it is already code of this repository on that branch.
  for head in "${DEFAULT_BRANCH}" "${FALLBACK_SHA}"; do
    status="$(gh api "repos/${REPOSITORY}/compare/${wanted}...${head}" --jq .status 2>/dev/null || true)"
    if [ "${status}" = ahead ] || [ "${status}" = identical ]; then
      name="${wanted}"
      break
    fi
  done
fi

if [ -z "${name}" ]; then
  echo "::error::ref '${wanted}' is neither a branch or tag of ${REPOSITORY} nor a commit on ${DEFAULT_BRANCH} or on the chosen branch (${FALLBACK_SHA})."
  exit 1
fi

revision="$(gh api "repos/${REPOSITORY}/commits/${name}" --jq .sha)"
if [[ ! "${revision}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error::could not resolve '${wanted}' to a commit (got '${revision}')."
  exit 1
fi
echo "Testing ${wanted} at ${revision}"
echo "revision=${revision}" >>"${output}"
