#!/usr/bin/env bash
# Production HISTOR onto the MOMUS-evaluated image histor-histor:warden-0.32.0-prod (sha256:7fa51dbf…)
# = histor-histor:signed-fingerprints-20261119 (sha256:d81ba087…) plus WARDEN 0.32.0 (ruleset 23, malware list
# unchanged; the flow-guard change is in modules HISTOR does not load). Only the image line of the override changes;
# HISTOR's own code and the database are untouched (no migration).
# Refuses while a crawl is running, and unless HISTOR runs signed-fingerprints-20261119.
# Rollback: ./switch.sh rollback -> back to signed-fingerprints-20261119.
# After either direction, on admin-vps: forward `skopos-warden-quality live sha256:7fa51dbf…`,
# rollback `skopos-warden-quality rebind sha256:d81ba087…`.
set -euo pipefail
D=/root/wd032-prod-20261120
NEW=sha256:7fa51dbf5dea26df1adedf90c2324ce371f81d4d803eb198553bae965c5d6c54
OLD=sha256:d81ba087c9b3f99749458be8bf1f2c8e12b9dce62f3fc364c5ef5afb8eebd524
C="docker compose -p histor -f docker-compose.yml -f docker-compose.postgres.yml -f docker-compose.warden-image.yml"
cd /opt/histor
crawls_running() {
  echo "SELECT count(*) FROM runs WHERE kind='crawl' AND finished_at IS NULL;" |
    docker exec -i histor-histor-postgres-1 sh -c 'psql -U ${POSTGRES_USER:-histor} -d ${POSTGRES_DB:-histor} -At'
}
if [ "${1:-}" = rollback ]; then
  grep -q 'image: histor-histor:warden-0.32.0-prod' docker-compose.warden-image.yml
  [ "$(docker image inspect -f '{{.Id}}' histor-histor:signed-fingerprints-20261119)" = "$OLD" ]
  sed -i 's#image: histor-histor:warden-0.32.0-prod#image: histor-histor:signed-fingerprints-20261119#' docker-compose.warden-image.yml
  WANT=$OLD
else
  [ "$(docker image inspect -f '{{.Id}}' histor-histor:warden-0.32.0-prod)" = "$NEW" ]
  grep -q 'image: histor-histor:signed-fingerprints-20261119' docker-compose.warden-image.yml
  [ "$(docker inspect -f '{{.Image}}' histor-histor-1)" = "$OLD" ]
  [ "$(crawls_running)" = 0 ] || { echo "a crawl is running; not switching" >&2; exit 1; }
  cp -a docker-compose.warden-image.yml "$D/docker-compose.warden-image.yml.pre"
  sed -i 's#image: histor-histor:signed-fingerprints-20261119#image: histor-histor:warden-0.32.0-prod#' docker-compose.warden-image.yml
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
