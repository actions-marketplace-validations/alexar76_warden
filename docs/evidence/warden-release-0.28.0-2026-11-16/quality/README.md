# MOMUS release gate for WARDEN 0.28.0

| | |
|---|---|
| Candidate image | `histor-histor:warden-0.28.0-prod` = `sha256:c936f1ce5c6fd9761a1a2b51210c9888959a0ced57326184b966e986227967e3` |
| Built from | the running production image `histor-histor:crawlretry-20261116` (`sha256:fce417bc…`, WARDEN 0.27.0) with the vendored WARDEN replaced by `../aimarket-warden-0.28.0.tgz` and the WARDEN source of `3e11a0697` (`Dockerfile.candidate`, `build.log`) |
| Image check | every file outside the two WARDEN folders equals production; vendored package 0.28.0, 71 `dist/*.js`, build digest `25e77ff9…`; the HISTOR scanner imports ruleset 23 `sha256-J12lNmUU…` (`verify.log`, `verify_candidate.py`) |
| Same image on admin-vps | `docker save` on the HISTOR host, `docker load` on admin-vps: same ID |
| Run | `skopos-warden-quality candidate sha256:c936f1ce…` (unit `warden-release-quality-028-prod-20261116`), 2026-11-16 14:59:49–15:01:54Z, run `20261116T145955` |
| Result | **passed**, policy `zero-regressions-v1`. development 8,244 attacks / 362 benign, holdout 24 / 24, candidates 22: 0 missed, 0 false positives, 0 incomplete in each. Behaviour 72 of 72 on this image (observer `bf8fe5b8…`). Discovery complete (round 63). Baseline build `403842d7…` (0.27.0) |
| Receipt | `candidate-signed.json`; WARDEN's own `checkEvidence` accepts it with `scripts/quality-public-key.pem` for this build |
| Expires | 2026-11-18 14:47:52Z. The corpus evaluation is shared with run `20261116T144752`, which judged the same build in the never-published 0.27.1 image (`sha256:2979a3d1…`) |
| `authorize` | done 2026-11-16 ~15:03Z |

## Production (2026-11-16, owner's yes)

- 15:15:16Z `switch.sh` on the HISTOR host (no crawl was running; the last one started 2026-11-15 18:21Z):
  `histor-histor-1` healthy on `sha256:c936f1ce…` at 15:15:37Z (`switch.log`). Only the image line of
  `docker-compose.warden-image.yml` changed; rollback `./switch.sh rollback` → `crawlretry-20261116`, then
  `skopos-warden-quality rebind sha256:fce417bc…` on admin-vps.
- 15:16:00Z `skopos-warden-quality live sha256:c936f1ce…` on admin-vps; the public receipt
  (`histor.modelmarket.dev/security-quality/latest.json`, saved as `latest-signed-after.json`) is phase `live` for
  build `25e77ff9…`, and `npm run check:quality` passes (`check-quality-after.log`).
- HISTOR's pattern set changed with the image (`sha256-9zykUm7c…`; ruleset 20's was `sha256-WCfFdCe…`). Scans are
  cached per pattern set, so until the next crawl (daily, ~18:2xZ) `/api/v1/check` answers `patternScan:
  not-scanned` for an endpoint whose set was not scanned with the new rules.
