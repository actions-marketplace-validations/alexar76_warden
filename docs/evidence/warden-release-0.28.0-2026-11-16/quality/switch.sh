#!/usr/bin/env bash
# Production HISTOR onto the MOMUS-evaluated image histor-histor:warden-0.28.0-prod (sha256:c936f1ce5c6f…)
# = the running image histor-histor:crawlretry-20261116 (sha256:fce417bc5ef6…) plus WARDEN 0.28.0 (ruleset 23).
# Only the image line of the override changes; no migration (the database stays at 24).
# Refuses while a crawl is running (runs.kind='crawl' with finished_at NULL).
# Rollback: ./switch.sh rollback -> back to crawlretry-20261116.
# After either direction, on admin-vps: forward `skopos-warden-quality live sha256:c936f1ce…`,
# rollback `skopos-warden-quality rebind sha256:fce417bc…`.
set -euo pipefail
D=/root/wd028-prod-20261116
NEW=sha256:c936f1ce5c6fd9761a1a2b51210c9888959a0ced57326184b966e986227967e3
OLD=sha256:fce417bc5ef6d1316e3549be7ff1a0243fe97299571f393cd23b225ed1b083f4
C="docker compose -p histor -f docker-compose.yml -f docker-compose.postgres.yml -f docker-compose.warden-image.yml"
cd /opt/histor
crawls_running() {
  echo "SELECT count(*) FROM runs WHERE kind='crawl' AND finished_at IS NULL;" |
    docker exec -i histor-histor-postgres-1 sh -c 'psql -U ${POSTGRES_USER:-histor} -d ${POSTGRES_DB:-histor} -At'
}
if [ "${1:-}" = rollback ]; then
  grep -q 'image: histor-histor:warden-0.28.0-prod' docker-compose.warden-image.yml
  [ "$(docker image inspect -f '{{.Id}}' histor-histor:crawlretry-20261116)" = "$OLD" ]
  sed -i 's#image: histor-histor:warden-0.28.0-prod#image: histor-histor:crawlretry-20261116#' docker-compose.warden-image.yml
  WANT=$OLD
else
  [ "$(docker image inspect -f '{{.Id}}' histor-histor:warden-0.28.0-prod)" = "$NEW" ]
  grep -q 'image: histor-histor:crawlretry-20261116' docker-compose.warden-image.yml
  [ "$(docker inspect -f '{{.Image}}' histor-histor-1)" = "$OLD" ]
  [ "$(crawls_running)" = 0 ] || { echo "a crawl is running; not switching" >&2; exit 1; }
  cp -a docker-compose.warden-image.yml "$D/docker-compose.warden-image.yml.pre"
  sed -i 's#image: histor-histor:crawlretry-20261116#image: histor-histor:warden-0.28.0-prod#' docker-compose.warden-image.yml
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
