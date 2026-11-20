# WARDEN 0.32.0 — prepared 2026-11-20, MOMUS candidate gate passed, HISTOR switch scheduled

Built from a clean export of aicom `cfa591b38` (`git archive … warden`; `npm ci --ignore-scripts`, `npm run build`,
then `npm pack`, whose `prepare` builds again; `dist/` was the same before and after the pack), Node 22.22.1,
npm 10.9.4. One flow-guard verdict change: after outside text, shell code that reads a credential from the environment
(a credential-like variable, a whole-environment dump, `/proc/<pid>/environ`) is a credential send
(`credential_egress`, sensitive). Rulesets are unchanged (23), the malware list is 0.30.0's, the scan is as in 0.31.0.
Three `dist/*.js` files differ from 0.31.0 (`flow-guard-classify.js`, `flow-guard-pre.js`, `flow-guard-post.js`), so
the MOMUS build digest is new and the release needs its own run.

## Artifact

| | |
|---|---|
| Tarball | `aimarket-warden-0.32.0.tgz` (this folder) |
| sha256 | `112c01a81276276f94d308696583640bd8b3d5e1852ebe51d04c9db57b7f443d` |
| npm shasum | `11804c92e38cd563173fac15b56a9753f04c28f6` |
| integrity | `sha512-HBkcnm7981fXaE6LwRxSJtuRM58GgmcKKZfHVIO90rWEEfcrYfazkR4yW7DKBBURMFx8jOGgxCViuWPATcPnXg==` |
| Files / size | 475 files, 3,767,088 bytes packed, 7,064,458 unpacked (0.31.0: 475 files, 3,760,663 bytes) |
| MOMUS build digest | `0a046db5462f7a4112e3a879915cb964d60804f54f87c2b93e4a40f5dd29bb4d` (80 `dist/*.js`) |
| Ruleset | v23 `sha256-J12lNmUUNTNkzbkKeYxmAHSVgmUlrWt3+NvDp4+9i1g=` |
| Malware list | `sha256:b656eb8a15d8b2d0ad9d54a4f02606f9fd28a460d90dbc8d91968ffc38b80526`, 237,594 package lines (unchanged) |

## Checks

| Check | Result | Log |
|---|---|---|
| Build, typecheck | pass | `build.log`, `typecheck.log`, `pack.log` |
| Tests | 2120 of 2120 (`--maxWorkers=3`), 84 files | `tests.log` |
| Red team, Claude Code profile | 0 of 28 delivered, 2 answer-only noted; field regressions 0 of 4 | `redteam.log` |
| Red team, Codex / OpenCode | `all`: 0 of 28; `data`: 3 of 28 (`mcp-push-without-credential`, `unlabeled-invite-email`, `unlabeled-collaborator`, the same three as 0.26.0–0.31.0; `--check` exits 1 for these profiles in `data`) | `redteam-codex-*.log`, `redteam-opencode-*.log` |
| Ruleset vs registry | pass before publication (0.32.0 is not on npm yet) | `ruleset.log` |
| Version references, release mode | pass (GitHub Action pins stay `v0.31.0` until the tag exists) | `versions.log` |
| Clean consumer | the tarball installs into an empty project with `--ignore-scripts`; main, `/codex` and `/opencode` import; on the installed `dist/`: our agents' six ordinary flows pass, five attacks denied; environment sends 11 of 11 denied in `data` mode, `gh api …` and `tg-send "…"` pass, `curl -H "Authorization: Bearer $GH_TOKEN"` after outside text denied | `clean-consumer.log` |
| The change itself | 75 tests in `test/flow-guard-env-credentials.test.ts`; on 0.31.0 the same 11 sends passed (`artifacts/multica-warden-guard-2026-11-19/`) | `tests.log` |

## MOMUS release gate

| | |
|---|---|
| Candidate image | `histor-histor:warden-0.32.0-prod` = `sha256:7fa51dbf5dea26df1adedf90c2324ce371f81d4d803eb198553bae965c5d6c54` |
| Built from | `histor-histor:signed-fingerprints-20261119` = `sha256:d81ba087…`, the image HISTOR production moves to on 2026-11-20 after the crawl (`artifacts/histor-signed-fingerprints-rollout-2026-11-19/`), with the vendored WARDEN replaced by this folder's tarball and the WARDEN source of `cfa591b38` (`quality/Dockerfile.candidate`). Built on admin-vps 04:11Z. At that time production was still on `warden-0.31.0-prod` with a crawl open, so the base was not live yet |
| Image check | every file outside the two WARDEN folders equals the base image (11,066 files in each); vendored package 0.32.0, 80 `dist/*.js`, build digest `0a046db5…` (this tarball's) (`quality/verify-and-build.log`) |
| Run | `skopos-warden-quality candidate sha256:7fa51dbf…` (unit `warden-release-quality-032-prod-20261120`), 2026-11-20 04:12:07–04:20Z, run `20261120T041217` |
| Result | **passed**, policy `zero-regressions-v1`. development 8,244 attacks / 362 benign, holdout 24 / 24, candidates 22: 0 missed, 0 false positives, 0 incomplete in each. Behaviour 72 of 72 (observer `bf8fe5b8…`). Discovery complete (round 67, 13 of 22 allowed). Baseline build `eac16bef…` (0.31.0) |
| Receipt | `quality/candidate-signed.json` |
| Expires | 2026-11-22 04:12Z |
| `authorize` | done 2026-11-20 04:21:04Z |

## Production HISTOR (owner's yes, 2026-11-20: «Да, переводи»)

Scheduled, not done at the time of writing (04:21Z):

- The candidate image went from admin-vps to the HISTOR host with `docker save | docker load`: same ID
  `sha256:7fa51dbf…`. `quality/switch.sh` and `quality/wait-and-switch.sh` (sha256 `87d1293f…`, `3d2cb1b1…`, the same
  on the host) in `/root/wd032-prod-20261120`.
- 04:21:05Z `wait-and-switch.sh` runs as the transient unit `histor-warden032-switch` on the HISTOR host. It waits
  until the signed-fingerprints switch has held (its log has `SWITCH-OK`, `health: 200` and
  `errors in the log since switch: 0`), HISTOR runs `sha256:d81ba087…` and no crawl is open, then switches; only the
  image line of `docker-compose.warden-image.yml` changes. If that earlier switch was skipped, failed or rolled back
  it does nothing; it gives up at 17:00Z. An unhealthy HISTOR on the new image is rolled back at once.
- 04:21:13Z `quality/live-after.sh` runs as the unit `warden-032-live` on admin-vps (log
  `/root/wd032-prod-20261120/live.log`): once HISTOR reports `sha256:7fa51dbf…` it runs
  `skopos-warden-quality live sha256:7fa51dbf…`. In the repository the HISTOR address in that script is a placeholder.
- Rollback after the switch: on the HISTOR host `/root/wd032-prod-20261120/switch.sh rollback` (back to
  `signed-fingerprints-20261119`, no database change), then on admin-vps
  `skopos-warden-quality rebind sha256:d81ba087c9b3f99749458be8bf1f2c8e12b9dce62f3fc364c5ef5afb8eebd524`. The rollback of
  the signed-fingerprints release itself (`/root/histor-signed-fingerprints-20261119/switch.sh rollback`) expects the
  override to name `signed-fingerprints-20261119`, so run this folder's rollback first.

The tarball must not be published until the public receipt is phase `live` for build `0a046db5…`.

## In use before publication

The 22 flow-guard files of our own unattended OpenCode agents on attested were replaced on 2026-11-19 21:01Z with the
build of `da259d3c3`. All 22 are byte-equal to this tarball's `dist/` files (checked against
`artifacts/multica-warden-guard-2026-11-19/install.sha256`).
