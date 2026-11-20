# WARDEN 0.34.0 — prepared 2026-11-20, MOMUS gate passed, live on HISTOR

Built from a clean export of aicom `1099f30ba` (`git archive … warden`; `npm ci --ignore-scripts`, `npm run build`,
then `npm pack`, whose `prepare` builds again; `dist/` was the same before and after the pack), Node and npm in
`versions.log`. One reviewer-facing change: when a reviewed tool's behaviour hint moves, the re-approval text and the
`scan --lock` report name the hint and its direction (`widens` / `narrows`); the package entry exports `hintMoves`,
`describeHintMoves` and the `HintMove` type. No verdict changes: rulesets are 23, the malware list and the flow guard
are 0.33.0's. Four `dist/*.js` files carry the change (`review-diff.js`, `scan-lock.js`, `scan-report.js`,
`index.js`), so the MOMUS build digest is new and the release needs its own run.

The first tarball of this version (`b2fafb36…`, from `282e63201`) did not export `hintMoves`; the clean-consumer check
found it. It was never published and is not kept; this tarball replaces it.

## Artifact

| | |
|---|---|
| Tarball | `aimarket-warden-0.34.0.tgz` (this folder) |
| sha256 | `ec33980e333a32006f67920b641a6fb4c936876bf3913053884e4f7c06bab641` |
| npm shasum | `44f00696df6004067c6ed1e59a3b0d3b37123c38` |
| integrity | `sha512-ZRYuBVKIPrmiGhi5T4NwJoImupv/JzMPkvUCTgB6mRZyihEvyUjXEge60qaytRZ5G5v7ZPwKZulT1vMiB5RtKQ==` |
| Files / size | 475 files, 3,770,871 bytes packed, 7,079,505 unpacked |
| MOMUS build digest | `6617a3ffa931be4789e13bcbda2a85cf828cb8e87dc43a6a4758eda4481fe5f2` (80 `dist/*.js`) |
| Ruleset | v23 `sha256-J12lNmUUNTNkzbkKeYxmAHSVgmUlrWt3+NvDp4+9i1g=` |

## Checks

| Check | Result | Log |
|---|---|---|
| Build, typecheck | pass | `build.log`, `typecheck.log`, `pack.log` |
| Tests | 2127 of 2127, 84 files (`--maxWorkers=3`) | `tests.log` |
| Red team, Claude Code profile | 0 of 28 delivered; field regressions 0 of 4 | `redteam.log` |
| Red team, Codex / OpenCode | `all`: 0 of 28; `data`: the same three as 0.26.0–0.33.0 (`mcp-push-without-credential`, `unlabeled-invite-email`, `unlabeled-collaborator`; `--check` exits 1 for these profiles in `data`) | `redteam-codex-*.log`, `redteam-opencode-*.log` |
| Ruleset vs registry | pass before publication (0.34.0 is not on npm yet) | `ruleset.log` |
| Version references, release mode | pass | `versions-check.log` |
| Clean consumer | installs into an empty project with `--ignore-scripts`; `hintMoves` imports from the package entry; a `readOnlyHint` true → false prints "Read first: behaviour hints moved … it now says it does more" | `clean-consumer.log` |

## MOMUS release gate

| | |
|---|---|
| Candidate image | `histor-histor:warden-0.34.0-prod` = `sha256:aef2d1c7a1d538c583c6d1c64c78385bec63d918f2ee22ba6fd7d7a477ba65a0` |
| Built from | the live `histor-histor:warden-0.33.0-prod` = `sha256:d7b493ab…`, vendored WARDEN replaced by this tarball and the source of `1099f30ba` (`quality/Dockerfile.candidate`). Built on admin-vps |
| Image check | 11,066 files on both sides, none different outside the WARDEN folders; vendored 0.34.0, 80 `dist/*.js`, build digest `6617a3ff…` (`quality/verify.log`). A first build copied macOS resource-fork files (`._*`, 160 `dist/*.js`); it was removed and the context re-sent with `COPYFILE_DISABLE=1` |
| Run | `skopos-warden-quality candidate sha256:aef2d1c7…`, unit `warden-release-quality-034-prod-20261120`, started 2026-11-20 17:00:49Z |
| Result | **passed** 2026-11-20 17:07Z, run `20261120T170055`, policy `zero-regressions-v1`; development 8,244 / 362, holdout 24 / 24, candidates 26, behaviour 72 / 72 and smoke 72 / 72, 0 missed, 0 false positives, 0 incomplete; discovery complete (round 67). Baseline build `64ae3d65…` (0.33.0) |
| Receipt | `quality/candidate-signed.json`, expires 2026-11-22 17:00:55Z |
| `authorize` | done 2026-11-20 17:08:15Z |

## Production HISTOR (owner «Switch now», 2026-11-20)

- Image transferred admin-vps → HISTOR host (`docker save | docker load`), same ID `sha256:aef2d1c7…`. No crawl open,
  no open alert for HISTOR.
- 17:55:15Z `histor-histor-1` healthy on `sha256:aef2d1c7…` (`quality/switch.sh`, in `/root/wd034-prod-20261120`). Only
  the image line of `docker-compose.warden-image.yml` changed. The landing, `/health`, `/api/v1/check` and
  `/api/v1/fingerprints` answer 200; vendored WARDEN 0.34.0; no traceback in the log.
- 17:55:30Z `skopos-warden-quality live sha256:aef2d1c7…`. Public receipt (`quality/latest-signed-after.json`): phase
  `live`, status `passed`, build `6617a3ff…`, run `20261120T170055`. This tarball's own `check-quality-gate.mjs`
  passes (`quality/check-quality-after.log`).
- Rollback: HISTOR host `/root/wd034-prod-20261120/switch.sh rollback`, then admin-vps
  `skopos-warden-quality rebind sha256:d7b493ab2e201ec687202a25e751a9d27b10f9544b5d27844d535ae36e0ef7ee`.

Publication: the owner publishes this tarball (`npm publish …/aimarket-warden-0.34.0.tgz --access public`, after checking
its sha256), not `publish_warden.sh`, which rebuilds.
