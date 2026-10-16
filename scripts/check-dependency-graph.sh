#!/usr/bin/env bash
# Check that the repository's Dependency graph is enabled, which
# actions/dependency-review-action needs to compare two commits.
#
# The setting is a repository switch only a maintainer can flip, so:
#   DEPENDENCY_GRAPH_MODE=warn    -- pull requests: annotate, write
#                                    enabled=false and exit 0, so the review
#                                    step is skipped without blocking the PR.
#   DEPENDENCY_GRAPH_MODE=require -- default branch: fail with the exact
#                                    setting to enable until it is on.
# Any answer other than success or HTTP 403 fails closed in both modes.
set -euo pipefail

: "${REPOSITORY:?REPOSITORY is required (owner/name)}"
: "${HEAD_SHA:?HEAD_SHA is required}"

mode="${DEPENDENCY_GRAPH_MODE:-require}"
base_sha="${BASE_SHA:-}"
output="${GITHUB_OUTPUT:-/dev/null}"
verbose="${DEPENDENCY_GRAPH_VERBOSE:-0}"
settings_url="https://github.com/${REPOSITORY}/settings/security_analysis"
instruction="Enable it at ${settings_url} (Settings -> Advanced Security -> Dependency graph -> Enable), then re-run this workflow."

trace() { [ "${verbose}" = "1" ] && echo "[dependency-graph] $*" >&2 || true; }

case "${mode}" in
  warn | require) ;;
  *)
    echo "::error::DEPENDENCY_GRAPH_MODE must be warn or require, got '${mode}'."
    exit 2
    ;;
esac

if [ -z "${base_sha}" ]; then
  base_sha="$(gh api "repos/${REPOSITORY}/commits/${HEAD_SHA}" --jq '.parents[0].sha // empty')"
  # A root commit has no parent; comparing it with itself still needs the graph.
  base_sha="${base_sha:-${HEAD_SHA}}"
fi
trace "mode=${mode} base=${base_sha} head=${HEAD_SHA}"

stderr_file="$(mktemp)"
trap 'rm -f "${stderr_file}"' EXIT

if gh api "repos/${REPOSITORY}/dependency-graph/compare/${base_sha}...${HEAD_SHA}" >/dev/null 2>"${stderr_file}"; then
  echo "Dependency graph is enabled for ${REPOSITORY}."
  echo "enabled=true" >>"${output}"
  exit 0
fi

trace "gh api stderr: $(cat "${stderr_file}")"
if ! grep -q 'HTTP 403' "${stderr_file}"; then
  echo "::error::Could not query the dependency graph of ${REPOSITORY}: $(cat "${stderr_file}")"
  exit 1
fi

echo "enabled=false" >>"${output}"
if [ "${mode}" = "warn" ]; then
  echo "::warning::Dependency graph is disabled for ${REPOSITORY}, so dependency review is skipped on this pull request. ${instruction}"
  exit 0
fi
echo "::error::Dependency graph is disabled for ${REPOSITORY}, so pull requests skip dependency review. A maintainer must act: ${instruction}"
exit 1
