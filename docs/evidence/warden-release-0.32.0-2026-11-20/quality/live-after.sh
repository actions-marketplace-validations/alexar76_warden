#!/usr/bin/env bash
# One-shot on admin-vps (unit warden-032-live): once the HISTOR host reports the WARDEN 0.32.0 image as live, record
# it with MOMUS (`skopos-warden-quality live`), so the public receipt becomes phase live for build 0a046db5….
# Does nothing for any other image. Gives up at 2026-11-20 18:00Z.
set -uo pipefail
D=/root/wd032-prod-20261120
NEW=sha256:7fa51dbf5dea26df1adedf90c2324ce371f81d4d803eb198553bae965c5d6c54
log() { echo "$(date -u +%FT%TZ) $*" >> "$D/live.log"; }
deadline=$(date -u -d '2026-11-20 18:00:00' +%s)
log "start"
while :; do
  live=$(curl -s --max-time 20 --resolve histor.modelmarket.dev:443:@HISTOR_HOST@ https://histor.modelmarket.dev/.well-known/aicom-histor-runtime.json \
         | python3 -c 'import json,sys; print(json.load(sys.stdin).get("imageDigest",""))' 2>/dev/null)
  if [ "$live" = "$NEW" ]; then
    sleep 120
    if /usr/local/sbin/skopos-warden-quality live "$NEW" >> "$D/live.log" 2>&1; then log "LIVE-OK"; else log "LIVE-FAILED"; fi
    exit 0
  fi
  if [ "$(date -u +%s)" -ge "$deadline" ]; then log "SKIP: live image is ${live:-unknown} at 18:00Z"; exit 0; fi
  sleep 300
done
