#!/usr/bin/env bash
# One-shot on admin-vps (unit warden-033-live): once the HISTOR host reports the WARDEN 0.33.0 image as live, record
# it with MOMUS (`skopos-warden-quality live`).
# Does nothing for any other image. Gives up at 2026-11-20 18:00Z.
set -uo pipefail
D=/root/wd033-prod-20261120
NEW=sha256:d7b493ab2e201ec687202a25e751a9d27b10f9544b5d27844d535ae36e0ef7ee
log() { echo "$(date -u +%FT%TZ) $*" >> "$D/live.log"; }
deadline=$(date -u -d '2026-11-20 18:00:00' +%s)
log "start"
while :; do
  live=$(curl -s --max-time 20 https://histor.modelmarket.dev/.well-known/aicom-histor-runtime.json \
         | python3 -c 'import json,sys; print(json.load(sys.stdin).get("imageDigest",""))' 2>/dev/null)
  if [ "$live" = "$NEW" ]; then
    sleep 120
    if /usr/local/sbin/skopos-warden-quality live "$NEW" >> "$D/live.log" 2>&1; then log "LIVE-OK"; else log "LIVE-FAILED"; fi
    exit 0
  fi
  if [ "$(date -u +%s)" -ge "$deadline" ]; then log "SKIP: live image is ${live:-unknown} at 18:00Z"; exit 0; fi
  sleep 60
done
