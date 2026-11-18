# MOMUS release gate for WARDEN 0.30.0

| | |
|---|---|
| Candidate image | `histor-histor:warden-0.30.0-prod` = `sha256:d75d0fe1ff10ede62c1f4de9f85960bc47c961f2880864775d755f299feaa8f5` |
| Built from | the running production image `histor-histor:warden-0.29.0-prod` (`sha256:fbf1b2e9…`, WARDEN 0.29.0) with the vendored WARDEN replaced by `../aimarket-warden-0.30.0.tgz` and the WARDEN source of `49e1c6b39` (`Dockerfile.candidate`, `build.log`), 2026-11-18 ~04:09Z on the HISTOR host (`/root/wd030-prod-20261118`) |
| Image check | every file outside the two WARDEN folders equals production (11,011 files in production, 11,057 in the candidate: the gateway modules and the new source files); vendored package 0.30.0, 79 `dist/*.js`, build digest `73c618fb…` (the tarball's); the HISTOR scanner imports ruleset 23 `sha256-J12lNmUU…` and describes itself as `@aimarket/warden@0.30.0`; the bundled list loads inside the image as its runtime user, 237,594 packages, `sha256:b656eb8a…`, in 825 ms (`verify.log`, `verify_candidate.py`) |
| What changes in HISTOR | nothing it runs: the scanner imports `StaticScanGate` only; the gateway modules are in the package but HISTOR never loads them, and the list is read only when something asks for it |
| Same image on admin-vps | `docker save` on the HISTOR host, `docker load` on admin-vps (through the Mac; admin-vps has no outgoing ssh): same ID |
| Run | `skopos-warden-quality candidate sha256:d75d0fe1…` (unit `warden-release-quality-030-prod-20261118`), 2026-11-18 04:12:13–~04:20:40Z, run `20261118T041219` |
| Result | **passed**, policy `zero-regressions-v1`. development 8,244 attacks / 362 benign, holdout 24 / 24, candidates 25: 0 missed, 0 false positives, 0 incomplete in each. Behaviour 72 of 72 (observer `bf8fe5b8…`). Discovery complete (round 65, 13 of 25 allowed). Baseline build `fbc9f734…` (0.29.0) |
| Receipt | `candidate-signed.json` (from `histor.modelmarket.dev/security-quality/candidate.json`); WARDEN's own `checkEvidence` accepts it with `scripts/quality-public-key.pem` for build `73c618fb…` |
| Expires | 2026-11-20 04:12:19Z |
| `authorize` | done 2026-11-18 04:21:08Z |

This run replaced the candidate slot held by the unpublished 0.29.1 build (`5c98b936…`, run `20261117T202244`).

## Production (owner's yes, 2026-11-18)

- 04:21:20Z `switch.sh` refused: a crawl was running (run 409625, the cycle of 2026-11-17 18:29Z resumed after the
  host reboot at 19:54Z). Production stayed on `fbf1b2e9…`.
- 04:22:35Z `wait-and-switch.sh` started on the HISTOR host as the transient unit `histor-warden030-switch`: it waits
  until no crawl is running, runs `switch.sh`, and rolls back to `warden-0.29.0-prod` at once if HISTOR is not healthy
  on the new image; it gives up without switching if the crawl still runs at 17:00Z.
- 07:04:47Z the crawl finished (8,000 attempts); 07:04:59Z the waiter ran `switch.sh`: `histor-histor-1` healthy on
  `sha256:d75d0fe1…` at 07:05:29Z (`switch.log`). Only the image line of `docker-compose.warden-image.yml` changed;
  rollback `./switch.sh rollback` → `warden-0.29.0-prod`, then `skopos-warden-quality rebind sha256:fbf1b2e9…` on
  admin-vps.
- 08:02:33Z `skopos-warden-quality live sha256:d75d0fe1…` on admin-vps; the public receipt
  (`histor.modelmarket.dev/security-quality/latest.json`, saved as `latest-signed-after.json`) is phase `live` for
  build `73c618fb…`, source `49e1c6b39`, run `20261118T041219`, and the release archive's own
  `check-quality-gate.mjs` passes (`check-quality-after.log`). The gate accepts the receipt for 48 h from the
  evaluation (until 2026-11-20 04:12Z) unless a later daily run renews it.
- After the switch the landing page and `/api/v1/check` answer 200, remote checks keep running (205 in the first hour)
  and the container log has no errors. The scanner describes itself as `@aimarket/warden@0.30.0`, so HISTOR's pattern
  set changes with the image although the rules did not; until the next crawl (daily, ~18:25Z) `/api/v1/check` may
  answer `patternScan: not-scanned`, as after every release.
