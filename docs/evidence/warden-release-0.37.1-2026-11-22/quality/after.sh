#!/usr/bin/env bash
# Transient unit on the HISTOR host (owner «Да, переключай», 2026-11-22): WARDEN 0.37.1 onto production after its MOMUS
# candidate run passed and was authorized. Every 5 minutes until 2026-11-24 09:00Z (before the candidate receipt expires):
# production on faq-20261122 and no open crawl, then switch.sh, check routes from outside the container, roll back
# on any failure, and a 15-minute health check. Skips if production runs anything else. Log: /root/wd0371-prod-20261122/after.log.
set -uo pipefail
D=/root/wd0371-prod-20261122
OLD=sha256:3704bf350d4cdcc32519ed2a78cabf27d56e0b4fc8e2a8bbf2f04bdaa32c490a
log() { echo "$(date -u +%FT%TZ) $*" >> "$D/after.log"; }
deadline=$(date -u -d '2026-11-24 09:00:00' +%s)
log "start"
while :; do
  [ "$(date -u +%s)" -ge "$deadline" ] && { log "SKIP: deadline passed"; exit 0; }
  live=$(docker inspect -f '{{.Image}}' histor-histor-1 2>/dev/null)
  [ "$live" = "$OLD" ] || { log "SKIP: running image is $live, not faq-20261122"; exit 0; }
  open=$(echo "SELECT count(*) FROM runs WHERE kind='crawl' AND finished_at IS NULL;" |
    docker exec -i histor-histor-postgres-1 sh -c 'psql -U ${POSTGRES_USER:-histor} -d ${POSTGRES_DB:-histor} -At' 2>/dev/null)
  if [ "$open" = 0 ]; then
    if bash "$D/switch.sh" >> "$D/after.log" 2>&1; then
      sleep 20
      # /api/v1/fingerprints answers 400 without naming a server (by design), so the check names one.
      ok=1; for p in / /health /api/v1/stats '/api/v1/fingerprints?package=npm:@aimarket/warden' /api/v1/log/checkpoint/cosigned; do
        c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 --resolve histor.modelmarket.dev:443:127.0.0.1 "https://histor.modelmarket.dev$p"); log "route $p $c"; [ "$c" = 200 ] || ok=0; done
      v=$(docker exec histor-histor-1 node -e 'console.log(require("/app/scanner/node_modules/@aimarket/warden/package.json").version)' 2>&1); log "vendored warden $v"
      [ "$v" = 0.37.1 ] || ok=0
      if [ $ok = 1 ]; then
        log "SWITCH-OK"; sleep 900
        log "after 15 min: image=$(docker inspect -f '{{.Image}}' histor-histor-1) health=$(docker inspect -f '{{.State.Health.Status}}' histor-histor-1) tracebacks=$(docker logs --since 16m histor-histor-1 2>&1 | grep -c Traceback)"
      else
        log "CHECK-FAILED: rolling back"; bash "$D/switch.sh" rollback >> "$D/after.log" 2>&1 && log "ROLLED-BACK" || log "ROLLBACK-FAILED"
      fi
    else
      log "SWITCH-FAILED"
      grep -q "image: histor-histor:warden-0.37.1-prod" /opt/histor/docker-compose.warden-image.yml &&
        { bash "$D/switch.sh" rollback >> "$D/after.log" 2>&1 && log "ROLLED-BACK" || log "ROLLBACK-FAILED"; }
    fi
    exit 0
  fi
  sleep 300
done
