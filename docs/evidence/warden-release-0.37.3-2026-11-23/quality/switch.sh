#!/usr/bin/env bash
# Production HISTOR onto MOMUS-evaluated histor-histor:warden-0.37.3-prod
# (sha256:8c799d1d1bb48b6142fd3099b38b0c7feb8ca48c993d774e3a79460309830314).
# Same WARDEN buildDigest 8f685dd8… as the earlier prelabel image 1d2438b1…, but with
# skopos.source.commit=496284972fb4db7bddcd485317c4879b5a211ba7 (40-hex) so live can enroll.
# Relabel hop: compose already names warden-0.37.3-prod; retag the name to NEW and
# `up -d --no-deps histor`. Keep the prelabel digest as histor-histor:warden-0.37.3-prelabel.
# After forward, on admin-vps:
#   skopos-warden-quality live sha256:8c799d1d1bb48b6142fd3099b38b0c7feb8ca48c993d774e3a79460309830314
# Rollback then (addresses still available):
#   skopos-warden-quality rebind sha256:c44951f59d00dd8d0a13d2d5d12093a945526d0e70a193b1e49c51d2a1959f90
set -euo pipefail
D=/root/wd0373-relabel-20261123
NEW=sha256:8c799d1d1bb48b6142fd3099b38b0c7feb8ca48c993d774e3a79460309830314
PRELABEL=sha256:1d2438b149acaada9b85184208ae7b1493be93e430f1e0d1420dff924bb03cc9
OLD=sha256:c44951f59d00dd8d0a13d2d5d12093a945526d0e70a193b1e49c51d2a1959f90
OLDTAG=histor-histor:addresses-20261122
NEWTAG=histor-histor:warden-0.37.3-prod
PRELABELTAG=histor-histor:warden-0.37.3-prelabel
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
elif [ "${1:-}" = relabel ]; then
  # Compose already names NEWTAG; only retag and recreate when running PRELABEL.
  [ "$(docker inspect -f '{{.Image}}' histor-histor-1)" = "$PRELABEL" ] || {
    echo "production is not on prelabel $PRELABEL; not relabeling" >&2; exit 1
  }
  [ "$(crawls_running)" = 0 ] || { echo "a crawl is running; not switching" >&2; exit 1; }
  [ "$(docker image inspect -f '{{.Id}}' "$NEW" 2>/dev/null || true)" = "$NEW" ] || {
    echo "NEW image $NEW missing locally" >&2; exit 1
  }
  mkdir -p "$D"; cp -a docker-compose.warden-image.yml "$D/docker-compose.warden-image.yml.pre"
  docker tag "$PRELABEL" "$PRELABELTAG" || true
  docker tag "$NEW" "$NEWTAG"
  WANT=$NEW
else
  [ "$(docker image inspect -f '{{.Id}}' $NEWTAG)" = "$NEW" ]
  grep -q "image: $OLDTAG" docker-compose.warden-image.yml || { echo "compose does not name $OLDTAG; not switching" >&2; exit 1; }
  [ "$(docker inspect -f '{{.Image}}' histor-histor-1)" = "$OLD" ] || { echo "production does not run addresses-20261122; not switching" >&2; exit 1; }
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
