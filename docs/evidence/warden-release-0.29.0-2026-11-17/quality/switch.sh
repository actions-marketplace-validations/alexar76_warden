#!/usr/bin/env bash
# Production HISTOR onto the MOMUS-evaluated image histor-histor:warden-0.29.0-prod (sha256:fbf1b2e906eb…)
# = the running image histor-histor:warden-0.28.0-prod (sha256:c936f1ce5c6f…) plus WARDEN 0.29.0 (ruleset 23,
# known-malicious package list 2026-11-17). Only the image line of the override changes; HISTOR's own code and the
# database are untouched (no migration).
# Refuses while a crawl is running (runs.kind='crawl' with finished_at NULL).
# Rollback: ./switch.sh rollback -> back to warden-0.28.0-prod.
# After either direction, on admin-vps: forward `skopos-warden-quality live sha256:fbf1b2e9…`,
# rollback `skopos-warden-quality rebind sha256:c936f1ce…`.
set -euo pipefail
D=/root/wd029-prod-20261117
NEW=sha256:fbf1b2e906eb503be0124a15b513b14a0c1bfcd64a57ef5db897b3fbfcdec9bb
OLD=sha256:c936f1ce5c6fd9761a1a2b51210c9888959a0ced57326184b966e986227967e3
C="docker compose -p histor -f docker-compose.yml -f docker-compose.postgres.yml -f docker-compose.warden-image.yml"
cd /opt/histor
crawls_running() {
  echo "SELECT count(*) FROM runs WHERE kind='crawl' AND finished_at IS NULL;" |
    docker exec -i histor-histor-postgres-1 sh -c 'psql -U ${POSTGRES_USER:-histor} -d ${POSTGRES_DB:-histor} -At'
}
if [ "${1:-}" = rollback ]; then
  grep -q 'image: histor-histor:warden-0.29.0-prod' docker-compose.warden-image.yml
  [ "$(docker image inspect -f '{{.Id}}' histor-histor:warden-0.28.0-prod)" = "$OLD" ]
  sed -i 's#image: histor-histor:warden-0.29.0-prod#image: histor-histor:warden-0.28.0-prod#' docker-compose.warden-image.yml
  WANT=$OLD
else
  [ "$(docker image inspect -f '{{.Id}}' histor-histor:warden-0.29.0-prod)" = "$NEW" ]
  grep -q 'image: histor-histor:warden-0.28.0-prod' docker-compose.warden-image.yml
  [ "$(docker inspect -f '{{.Image}}' histor-histor-1)" = "$OLD" ]
  [ "$(crawls_running)" = 0 ] || { echo "a crawl is running; not switching" >&2; exit 1; }
  cp -a docker-compose.warden-image.yml "$D/docker-compose.warden-image.yml.pre"
  sed -i 's#image: histor-histor:warden-0.28.0-prod#image: histor-histor:warden-0.29.0-prod#' docker-compose.warden-image.yml
  WANT=$NEW
fi
$C up -d --no-deps histor
for i in $(seq 1 60); do
  s="$(docker inspect -f '{{.State.Health.Status}}' histor-histor-1)"
  [ "$s" = healthy ] && break
  sleep 5
done
echo "$(date -u +%FT%TZ) health=$s image=$(docker inspect -f '{{.Image}}' histor-histor-1)"
[ "$s" = healthy ] && [ "$(docker inspect -f '{{.Image}}' histor-histor-1)" = "$WANT" ]
