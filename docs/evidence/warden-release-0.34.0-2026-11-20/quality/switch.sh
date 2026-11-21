#!/usr/bin/env bash
# Production HISTOR onto the MOMUS-evaluated image histor-histor:warden-0.34.0-prod (sha256:aef2d1c7a1d538c583c6d1c64c78385bec63d918f2ee22ba6fd7d7a477ba65a0)
# = histor-histor:warden-0.33.0-prod (sha256:d7b493ab…) plus WARDEN 0.34.0.
# Rollback: ./switch.sh rollback -> back to warden-0.33.0-prod.
# After either direction, on admin-vps: forward `skopos-warden-quality live sha256:aef2d1c7a1d538c583c6d1c64c78385bec63d918f2ee22ba6fd7d7a477ba65a0`,
# rollback `skopos-warden-quality rebind sha256:d7b493ab2e201ec687202a25e751a9d27b10f9544b5d27844d535ae36e0ef7ee`.
set -euo pipefail
D=/root/wd034-prod-20261120
NEW=sha256:aef2d1c7a1d538c583c6d1c64c78385bec63d918f2ee22ba6fd7d7a477ba65a0
OLD=sha256:d7b493ab2e201ec687202a25e751a9d27b10f9544b5d27844d535ae36e0ef7ee
C="docker compose -p histor -f docker-compose.yml -f docker-compose.postgres.yml -f docker-compose.warden-image.yml"
cd /opt/histor
crawls_running() {
  echo "SELECT count(*) FROM runs WHERE kind='crawl' AND finished_at IS NULL;" |
    docker exec -i histor-histor-postgres-1 sh -c 'psql -U ${POSTGRES_USER:-histor} -d ${POSTGRES_DB:-histor} -At'
}
if [ "${1:-}" = rollback ]; then
  grep -q 'image: histor-histor:warden-0.34.0-prod' docker-compose.warden-image.yml
  [ "$(docker image inspect -f '{{.Id}}' histor-histor:warden-0.33.0-prod)" = "$OLD" ]
  sed -i 's#image: histor-histor:warden-0.34.0-prod#image: histor-histor:warden-0.33.0-prod#' docker-compose.warden-image.yml
  WANT=$OLD
else
  [ "$(docker image inspect -f '{{.Id}}' histor-histor:warden-0.34.0-prod)" = "$NEW" ]
  grep -q 'image: histor-histor:warden-0.33.0-prod' docker-compose.warden-image.yml
  [ "$(docker inspect -f '{{.Image}}' histor-histor-1)" = "$OLD" ]
  [ "$(crawls_running)" = 0 ] || { echo "a crawl is running; not switching" >&2; exit 1; }
  cp -a docker-compose.warden-image.yml "$D/docker-compose.warden-image.yml.pre"
  sed -i 's#image: histor-histor:warden-0.33.0-prod#image: histor-histor:warden-0.34.0-prod#' docker-compose.warden-image.yml
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
