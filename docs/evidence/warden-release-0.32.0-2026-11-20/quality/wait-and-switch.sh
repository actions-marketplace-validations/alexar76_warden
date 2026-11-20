#!/usr/bin/env bash
# Runs on the HISTOR host as a transient unit (histor-warden032-switch); owner's yes 2026-11-20 («Да, переводи»).
# Waits until the signed-fingerprints switch of this night has finished its own checks (after-crawl.log has
# SWITCH-OK and its last line "errors in the log since switch"), HISTOR runs that image and no crawl is open; then
# ./switch.sh. If that switch was skipped, failed or rolled back, this does nothing. If HISTOR is not healthy on the
# new image, it rolls back to signed-fingerprints-20261119 at once. Gives up at 17:00Z, before the next daily crawl.
set -uo pipefail
cd /root/wd032-prod-20261120
A=/root/histor-signed-fingerprints-20261119/after-crawl.log
OLD=sha256:d81ba087c9b3f99749458be8bf1f2c8e12b9dce62f3fc364c5ef5afb8eebd524
crawls_running() {
  echo "SELECT count(*) FROM runs WHERE kind='crawl' AND finished_at IS NULL;" |
    docker exec -i histor-histor-postgres-1 sh -c 'psql -U ${POSTGRES_USER:-histor} -d ${POSTGRES_DB:-histor} -At'
}
echo "$(date -u +%FT%TZ) waiting for the signed-fingerprints switch and its checks"
while :; do
  if grep -q 'SKIP\|SWITCH-FAILED\|ROLLBACK' "$A"; then echo "$(date -u +%FT%TZ) the signed-fingerprints switch did not hold; not switching"; exit 3; fi
  if grep -q 'SWITCH-OK' "$A" && grep -q 'errors in the log since switch: 0$' "$A" && grep -q 'health: 200$' "$A" \
     && [ "$(docker inspect -f '{{.Image}}' histor-histor-1)" = "$OLD" ] && [ "$(crawls_running)" = 0 ]; then break; fi
  if grep -q 'errors in the log since switch: [1-9]' "$A"; then echo "$(date -u +%FT%TZ) errors after the signed-fingerprints switch; not switching"; exit 3; fi
  if [ "$(date -u +%H%M)" -ge 1700 ]; then echo "$(date -u +%FT%TZ) not ready at 17:00Z; not switching"; exit 3; fi
  sleep 60
done
echo "$(date -u +%FT%TZ) ready; switching"
./switch.sh > switch.log 2>&1; rc=$?
cat switch.log
if [ "$rc" = 0 ]; then echo "$(date -u +%FT%TZ) switched"; exit 0; fi
echo "$(date -u +%FT%TZ) switch failed (rc=$rc); rolling back"
./switch.sh rollback > rollback.log 2>&1; rrc=$?
cat rollback.log
echo "$(date -u +%FT%TZ) rollback rc=$rrc"
exit 4
