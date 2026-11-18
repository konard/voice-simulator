#!/usr/bin/env bash
# Retain the existing entry point and optional fixture command.
exec bash "$(dirname "$0")/run-runtime-tests.sh" bun "$@"
