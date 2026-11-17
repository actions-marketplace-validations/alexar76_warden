# MOMUS release gate for WARDEN 0.29.0

| | |
|---|---|
| Candidate image | `histor-histor:warden-0.29.0-prod` = `sha256:fbf1b2e906eb503be0124a15b513b14a0c1bfcd64a57ef5db897b3fbfcdec9bb` |
| Built from | the running production image `histor-histor:warden-0.28.0-prod` (`sha256:c936f1ce…`, WARDEN 0.28.0) with the vendored WARDEN replaced by `../aimarket-warden-0.29.0.tgz` and the WARDEN source of `90fcf7a51` (`Dockerfile.candidate`, `build.log`) |
| Image check | every file outside the two WARDEN folders equals production (10,995 files in production, 11,011 in the candidate: the new modules and the packed list); vendored package 0.29.0, 74 `dist/*.js`, build digest `fbc9f734…`; the HISTOR scanner imports ruleset 23 `sha256-J12lNmUU…`; the bundled list loads inside the image as its runtime user, 237,594 packages, `sha256:b656eb8a…`, in 325 ms (`verify.log`, `verify_candidate.py`) |
| What changes in HISTOR | nothing it runs: the scanner imports `StaticScanGate` only, and the list is read the first time something asks for it, so production never loads it |
| Same image on admin-vps | `docker save` on the HISTOR host, `docker load` on admin-vps: same ID |
| Run | `skopos-warden-quality candidate sha256:fbf1b2e9…` (unit `warden-release-quality-029-prod-20261117`), 2026-11-17 08:56:11–09:04:27Z, run `20261117T085628` |
| Result | **passed**, policy `zero-regressions-v1`. development 8,244 attacks / 362 benign, holdout 24 / 24, candidates 14: 0 missed, 0 false positives, 0 incomplete in each. Behaviour 72 of 72 on this image (observer `bf8fe5b8…`). Discovery complete (round 64). Baseline build `25e77ff9…` (0.28.0) |
| Receipt | `candidate-signed.json` (from `histor.modelmarket.dev/security-quality/candidate.json`); WARDEN's own `checkEvidence` accepts it with `scripts/quality-public-key.pem` for this build |
| Expires | 2026-11-19 08:56:28Z |
| `authorize` | done 2026-11-17 09:05:03Z |

## Production (2026-11-17, owner's yes)

- 09:16Z `switch.sh` on the HISTOR host (no crawl was running; the last one ended 05:56Z): `histor-histor-1` healthy on
  `sha256:fbf1b2e9…` at 09:16:34Z (`switch.log`). Only the image line of `docker-compose.warden-image.yml` changed;
  rollback `./switch.sh rollback` → `warden-0.28.0-prod`, then `skopos-warden-quality rebind sha256:c936f1ce…` on
  admin-vps.
- 09:16:59Z `skopos-warden-quality live sha256:fbf1b2e9…` on admin-vps; the public receipt
  (`histor.modelmarket.dev/security-quality/latest.json`, saved as `latest-signed-after.json`) is phase `live` for
  build `fbc9f734…`, source `90fcf7a51`, and the release archive's own `check-quality-gate.mjs` passes
  (`check-quality-after.log`).
- After the switch the landing page and `/api/v1/check` answer 200, remote checks keep running, and the container log
  has no errors. HISTOR's pattern set names the WARDEN package and version (`@aimarket/warden@0.29.0`), so it changed
  with the image (`sha256-oC3GMnEU…`; 0.28.0's was `sha256-9zykUm7c…`) although the rules did not. Scans are cached
  per pattern set, so until the next crawl (daily, ~18:25Z) `/api/v1/check` answers `patternScan: not-scanned`, as
  after every release.
