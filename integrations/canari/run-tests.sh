#!/usr/bin/env bash
# Run: ./integrations/canari/run-tests.sh
# Uses Node's built-in test runner: this integration has no dependencies, so it
# must not need `npm ci` to be checked.
set -euo pipefail
cd "$(dirname "$0")/../.."
node --test integrations/canari/test/verify-attestation.test.mjs
