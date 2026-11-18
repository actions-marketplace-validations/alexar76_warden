#!/usr/bin/env bash
# Runs on the HISTOR host as a transient unit (histor-warden030-switch): waits until no crawl is running, then
# ./switch.sh. If HISTOR is not healthy on the new image, it rolls back to warden-0.29.0-prod at once (MOMUS stays
# bound to 0.29.0 then, nothing to rebind). Gives up without switching if a crawl is still running at 17:00Z, before
# the next daily crawl (~18:25Z).
set -uo pipefail
cd /root/wd030-prod-20261118
crawls_running() {
  echo "SELECT count(*) FROM runs WHERE kind='crawl' AND finished_at IS NULL;" |
    docker exec -i histor-histor-postgres-1 sh -c 'psql -U ${POSTGRES_USER:-histor} -d ${POSTGRES_DB:-histor} -At'
}
echo "$(date -u +%FT%TZ) waiting for the running crawl to finish"
while [ "$(crawls_running)" != 0 ]; do
  if [ "$(date -u +%H%M)" -ge 1700 ]; then echo "$(date -u +%FT%TZ) crawl still running at 17:00Z; not switching"; exit 3; fi
  sleep 60
done
echo "$(date -u +%FT%TZ) no crawl running; switching"
./switch.sh > switch.log 2>&1; rc=$?
cat switch.log
if [ "$rc" = 0 ]; then echo "$(date -u +%FT%TZ) switched"; exit 0; fi
echo "$(date -u +%FT%TZ) switch failed (rc=$rc); rolling back"
./switch.sh rollback > rollback.log 2>&1; rrc=$?
cat rollback.log
echo "$(date -u +%FT%TZ) rollback rc=$rrc"
exit 4
