#!/usr/bin/env bash
# Run the plugin tests against this checkout's build: a throwaway copy whose node_modules links @aimarket/warden here.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; WARDEN="$(cd "$HERE/../.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
cp -R "$HERE/warden" "$HERE/test" "$T/"
mkdir -p "$T/node_modules/@aimarket"; ln -s "$WARDEN" "$T/node_modules/@aimarket/warden"
node --test "$T"/test/*.test.mjs
