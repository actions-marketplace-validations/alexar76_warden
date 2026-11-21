#!/usr/bin/env bash
# Transient unit on the HISTOR host (owner «Yes, switch then», 2026-11-20): WARDEN 0.35.0 onto production once the
# other session's cosigned switch has run and passed its 15-minute check. Every 5 minutes until 2026-11-22 20:00Z
# (the MOMUS candidate receipt expires 20:53:54Z): needs after.log of /root/histor-cosigned-20261120 to end with
# "after 15 min: image=<c82f2e7f> health=healthy tracebacks=0", production on c82f2e7f and no open crawl; then
# switch.sh, check routes from outside the container, roll back on any failure. Skips if production is on anything
# else. Log: /root/wd035-prod-20261120/after.log.
set -uo pipefail
D=/root/wd035-prod-20261120
CO=/root/histor-cosigned-20261120/after.log
OLD=sha256:c82f2e7fc9f97cb95651b7dd2a09875663cf464e33a9ef68a4ca37f5b2569ed7
log() { echo "$(date -u +%FT%TZ) $*" >> "$D/after.log"; }
deadline=$(date -u -d '2026-11-22 20:00:00' +%s)
log "start"
while :; do
  [ "$(date -u +%s)" -ge "$deadline" ] && { log "SKIP: deadline passed"; exit 0; }
  if grep -qE "SKIP|ROLLED-BACK|ROLLBACK-FAILED|CHECK-FAILED|SWITCH-FAILED" "$CO" 2>/dev/null; then log "SKIP: the cosigned switch did not go through: $(tail -1 $CO)"; exit 0; fi
  if grep -q "after 15 min: image=$OLD health=healthy tracebacks=0" "$CO" 2>/dev/null; then
    live=$(docker inspect -f '{{.Image}}' histor-histor-1 2>/dev/null)
    [ "$live" = "$OLD" ] || { log "SKIP: running image is $live, not cosigned-20261120"; exit 0; }
    open=$(echo "SELECT count(*) FROM runs WHERE kind='crawl' AND finished_at IS NULL;" |
      docker exec -i histor-histor-postgres-1 sh -c 'psql -U ${POSTGRES_USER:-histor} -d ${POSTGRES_DB:-histor} -At' 2>/dev/null)
    if [ "$open" = 0 ]; then
      if bash "$D/switch.sh" >> "$D/after.log" 2>&1; then
        sleep 20
        # /api/v1/fingerprints answers 400 without naming a server (by design): the first run, 2026-11-21 05:12Z, checked
        # the bare path and rolled a healthy switch back. It names a server now.
        ok=1; for p in / /health /api/v1/stats '/api/v1/fingerprints?package=npm:@aimarket/warden' /api/v1/log/checkpoint/cosigned; do
          c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 --resolve histor.modelmarket.dev:443:127.0.0.1 "https://histor.modelmarket.dev$p"); log "route $p $c"; [ "$c" = 200 ] || ok=0; done
        v=$(docker exec histor-histor-1 node -e 'console.log(require("/app/scanner/node_modules/@aimarket/warden/package.json").version)' 2>&1); log "vendored warden $v"
        [ "$v" = 0.35.0 ] || ok=0
        if [ $ok = 1 ]; then
          log "SWITCH-OK"; sleep 900
          log "after 15 min: image=$(docker inspect -f '{{.Image}}' histor-histor-1) health=$(docker inspect -f '{{.State.Health.Status}}' histor-histor-1) tracebacks=$(docker logs --since 16m histor-histor-1 2>&1 | grep -c Traceback)"
        else
          log "CHECK-FAILED: rolling back"; bash "$D/switch.sh" rollback >> "$D/after.log" 2>&1 && log "ROLLED-BACK" || log "ROLLBACK-FAILED"
        fi
      else
        log "SWITCH-FAILED"
        grep -q "image: histor-histor:warden-0.35.0-prod" /opt/histor/docker-compose.warden-image.yml &&
          { bash "$D/switch.sh" rollback >> "$D/after.log" 2>&1 && log "ROLLED-BACK" || log "ROLLBACK-FAILED"; }
      fi
      exit 0
    fi
  fi
  sleep 300
done
