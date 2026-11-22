#!/usr/bin/env bash
# Production HISTOR onto the MOMUS-evaluated image histor-histor:warden-0.37.1-prod (sha256:cf11d410c06ee1ef073f2d0afc1485f9d399e8f012faee4cfc40a8833c46ee63)
# = histor-histor:faq-20261122 (sha256:3704bf35…, production since 2026-11-22 14:06Z) plus WARDEN 0.37.1. It switches only
# FROM faq-20261122 and only with no open crawl. Rollback: ./switch.sh rollback -> back to faq-20261122.
# After either direction, on admin-vps: forward `skopos-warden-quality live sha256:cf11d410c06ee1ef073f2d0afc1485f9d399e8f012faee4cfc40a8833c46ee63`,
# rollback `skopos-warden-quality rebind sha256:3704bf350d4cdcc32519ed2a78cabf27d56e0b4fc8e2a8bbf2f04bdaa32c490a`.
set -euo pipefail
D=/root/wd0371-prod-20261122
NEW=sha256:cf11d410c06ee1ef073f2d0afc1485f9d399e8f012faee4cfc40a8833c46ee63
OLD=sha256:3704bf350d4cdcc32519ed2a78cabf27d56e0b4fc8e2a8bbf2f04bdaa32c490a
OLDTAG=histor-histor:faq-20261122
NEWTAG=histor-histor:warden-0.37.1-prod
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
  [ "$(docker inspect -f '{{.Image}}' histor-histor-1)" = "$OLD" ] || { echo "production does not run faq-20261122; not switching" >&2; exit 1; }
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
