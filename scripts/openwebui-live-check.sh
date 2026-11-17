#!/usr/bin/env bash
# Live check of the WARDEN gateway in front of a real OpenWebUI, on a throw-away copy of the local stack.
#
#   scripts/openwebui-live-check.sh [--keep] [--tag v0.11.4-slim]
#
# Deploys examples/openwebui/docker-compose.yml into a temporary folder (project warden-owui-check, OpenWebUI on
# 127.0.0.1:18080), with the scripted model only, and runs drive.py native (S1-S7, native function calling), drive.py openapi (O1-O7) and
# drive.py legacy (L1-L6, "Default" function calling). Exit 0 only if every scenario ends as expected.
# Real models and the browser check run against the persistent stack: see docs/openwebui.md.
set -euo pipefail
cd "$(dirname "$0")/.."
KEEP=0; TAG=v0.11.4-slim
while [[ $# -gt 0 ]]; do case "$1" in --keep) KEEP=1; shift ;; --tag) TAG="$2"; shift 2 ;; *) echo "unknown argument $1" >&2; exit 2 ;; esac; done
DIR="$(mktemp -d "${TMPDIR:-/tmp}/warden-owui-check.XXXXXX")"
cleanup() { [[ $KEEP == 1 ]] || docker compose -p warden-owui-check --project-directory "$DIR" -f "$DIR/docker-compose.yml" down -v >/dev/null 2>&1 || true; }
trap cleanup EXIT
scripts/openwebui-local-deploy.sh --dir "$DIR" --port 18080 --fixtures-port 19102 --tag "$TAG" --project warden-owui-check --models ""
status=0
for suite in native legacy openapi; do
  python3 scripts/openwebui-live/drive.py "$suite" --owui http://127.0.0.1:18080 --state "$DIR/state" --env "$DIR/.env" \
    --admin "$DIR/admin.json" --fixtures http://127.0.0.1:19102 --report "$DIR/report-$suite.json" || status=1
done
echo "reports: $DIR/report-native.json $DIR/report-legacy.json"
exit $status
