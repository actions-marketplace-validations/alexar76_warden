#!/usr/bin/env bash
# Production HISTOR onto the MOMUS-evaluated image histor-histor:warden-0.37.0-prod (sha256:d888324c6e3a5d40722a824896d0223cc395dbb9f07cdb7bca3d3a9c001b592f)
# = histor-histor:warden-0.36.0-prod (sha256:3e2b70a5…, production since 2026-11-21 18:00Z) plus WARDEN 0.37.0. It switches only
# FROM warden-0.36.0-prod and only with no open crawl. Rollback: ./switch.sh rollback -> back to warden-0.36.0-prod.
# After either direction, on admin-vps: forward `skopos-warden-quality live sha256:d888324c6e3a5d40722a824896d0223cc395dbb9f07cdb7bca3d3a9c001b592f`,
# rollback `skopos-warden-quality rebind sha256:3e2b70a5f17e46677afddf6c5a01142a94b040ccd072727a1513906c3913ba16`.
set -euo pipefail
D=/root/wd037-prod-20261122
NEW=sha256:d888324c6e3a5d40722a824896d0223cc395dbb9f07cdb7bca3d3a9c001b592f
OLD=sha256:3e2b70a5f17e46677afddf6c5a01142a94b040ccd072727a1513906c3913ba16
OLDTAG=histor-histor:warden-0.36.0-prod
NEWTAG=histor-histor:warden-0.37.0-prod
C="docker compose -p histor -f docker-compose.yml -f docker-compose.postgres.yml -f docker-compose.warden-image.yml"
cd /opt/histor
crawls_running() {
  echo "SELECT count(*) FROM runs WHERE kind='crawl' AND finished_at IS NULL;" |
    docker exec -i histor-histor-postgres-1 sh -c 'psql -U ${POSTGRES_USER:-histor} -d ${POSTGRES_DB:-histor} -At'
}
if [ "${1:-}" = rollback ]; then
  grep -q "image: $NEWTAG" docker-compose.warden-image.yml
  [ "$(docker image inspect -f '{{.Id}}' $OLDTAG)" = "$OLD" ]
  sed -i "s#image: $NEWTAG#image: $OLDTAG#" docker-compose.warden-image.yml
  WANT=$OLD
else
  [ "$(docker image inspect -f '{{.Id}}' $NEWTAG)" = "$NEW" ]
  grep -q "image: $OLDTAG" docker-compose.warden-image.yml || { echo "compose does not name $OLDTAG; not switching" >&2; exit 1; }
  [ "$(docker inspect -f '{{.Image}}' histor-histor-1)" = "$OLD" ] || { echo "production does not run warden-0.36.0-prod; not switching" >&2; exit 1; }
  [ "$(crawls_running)" = 0 ] || { echo "a crawl is running; not switching" >&2; exit 1; }
  mkdir -p "$D"; cp -a docker-compose.warden-image.yml "$D/docker-compose.warden-image.yml.pre"
  sed -i "s#image: $OLDTAG#image: $NEWTAG#" docker-compose.warden-image.yml
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
