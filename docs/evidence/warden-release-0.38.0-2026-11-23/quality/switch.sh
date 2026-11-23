#!/usr/bin/env bash
# Production HISTOR onto MOMUS-evaluated histor-histor:warden-0.38.0-prod
# (sha256:d1bcacad96239aca1d48ee720e49f893459b1c7fb94e48f60ec4b6584f2b5075).
# WARDEN buildDigest cbb3a54f… . After forward, on admin-vps:
#   skopos-warden-quality live sha256:d1bcacad96239aca1d48ee720e49f893459b1c7fb94e48f60ec4b6584f2b5075
# Rollback:
#   skopos-warden-quality rebind sha256:8c799d1d1bb48b6142fd3099b38b0c7feb8ca48c993d774e3a79460309830314
set -euo pipefail
D=/root/wd0380-switch-20261123
NEW=sha256:d1bcacad96239aca1d48ee720e49f893459b1c7fb94e48f60ec4b6584f2b5075
OLD=sha256:8c799d1d1bb48b6142fd3099b38b0c7feb8ca48c993d774e3a79460309830314
OLDTAG=histor-histor:warden-0.37.3-prod
NEWTAG=histor-histor:warden-0.38.0-prod
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
  [ "$(docker inspect -f '{{.Image}}' histor-histor-1)" = "$OLD" ] || { echo "production does not run warden-0.37.3-prod; not switching" >&2; exit 1; }
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
