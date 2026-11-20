#!/usr/bin/env bash
# Production HISTOR onto the MOMUS-evaluated image histor-histor:warden-0.35.0-prod (sha256:ef3e5cb4b31278cc91d1d88c72fa3f3ed1aac8cd533280b09f4d6129c8f68903)
# = histor-histor:cosigned-20261120 (sha256:c82f2e7f…) plus WARDEN 0.35.0. It switches only FROM cosigned-20261120: while
# production still runs warden-0.34.0-prod (the cosigned switch of another session waits for a crawl), it refuses.
# Rollback: ./switch.sh rollback -> back to cosigned-20261120.
# After either direction, on admin-vps: forward `skopos-warden-quality live sha256:ef3e5cb4b31278cc91d1d88c72fa3f3ed1aac8cd533280b09f4d6129c8f68903`,
# rollback `skopos-warden-quality rebind sha256:c82f2e7fc9f97cb95651b7dd2a09875663cf464e33a9ef68a4ca37f5b2569ed7`.
set -euo pipefail
D=/root/wd035-prod-20261120
NEW=sha256:ef3e5cb4b31278cc91d1d88c72fa3f3ed1aac8cd533280b09f4d6129c8f68903
OLD=sha256:c82f2e7fc9f97cb95651b7dd2a09875663cf464e33a9ef68a4ca37f5b2569ed7
OLDTAG=histor-histor:cosigned-20261120
NEWTAG=histor-histor:warden-0.35.0-prod
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
  [ "$(docker inspect -f '{{.Image}}' histor-histor-1)" = "$OLD" ] || { echo "production does not run cosigned-20261120; not switching" >&2; exit 1; }
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
