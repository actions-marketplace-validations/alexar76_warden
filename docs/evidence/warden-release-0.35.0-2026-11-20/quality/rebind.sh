#!/usr/bin/env bash
# Transient unit on admin-vps: once the cosigned MOMUS rebind unit has finished, every 5 minutes until 2026-11-22
# 20:30Z try `skopos-warden-quality live` for the 0.35.0 image; it refuses until HISTOR runs that image. Log: rebind.log.
set -uo pipefail
D=/root/wd035-candidate-20261120; NEW=sha256:ef3e5cb4b31278cc91d1d88c72fa3f3ed1aac8cd533280b09f4d6129c8f68903
log() { echo "$(date -u +%FT%TZ) $*" >> "$D/rebind.log"; }
deadline=$(date -u -d '2026-11-22 20:30:00' +%s); log start
while :; do
  [ "$(date -u +%s)" -ge "$deadline" ] && { log "SKIP: deadline passed"; exit 0; }
  if ! systemctl is-active -q histor-cosigned-rebind.service; then
    if out=$(skopos-warden-quality live $NEW 2>&1); then log "LIVE-OK $out"; exit 0; fi
  fi
  sleep 300
done
