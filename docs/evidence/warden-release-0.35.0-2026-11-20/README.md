# WARDEN 0.35.0 — prepared 2026-11-20

Built from a clean export of aicom `5dba9049f` (`git archive … warden`; `npm ci --ignore-scripts`, `npm run build`,
then `npm pack`, whose `prepare` builds again; `dist/` was the same before and after the pack), Node and npm in
`versions.log`. One new finding: `scan` reports `TOOL_HINT_CONTRADICTS_DESCRIPTION` (advisory) when a tool's
`readOnlyHint: true` or `destructiveHint: false` is contradicted by its own description, shown in the text output, the
Markdown summary and `--json`; the package entry exports `hintContradictions`, `hintContradictionFindings` and the
`HintClaim` / `HintContradiction` types. No verdict changes: rulesets are 23, the malware list and the flow guard are
0.34.0's. One new `dist/hint-claims.js` and changed `scan.js`, `scan-report.js`, `index.js`, so the MOMUS build digest
is new and the release needs its own run. Calibration of the check:
`artifacts/hint-description-contradictions-2026-11-20` in the monorepo.

The first tarball of this version (`d8d9c5a8…`, from `f6997e58f`) put a second full stop after a quoted sentence in the
finding's message; the installed `scan` showed it. It was never published or evaluated and is not kept; this tarball
replaces it.

## Artifact

| | |
|---|---|
| Tarball | `aimarket-warden-0.35.0.tgz` (this folder) |
| sha256 | `aa6eae019ca12e11bf87421b44061005207be249dfc85716b1d14c86d1917cae` |
| npm shasum | `d3ba314d0f805a26b655702e3d23860c599e257b` |
| integrity | `sha512-lSG/0G2JznRgU2fRYOOHIEaMqBEttNYN4d+YUjzBzJLMOSVW7YObNYeFJpy22cgQYIzYSYlRGeq1GDZSl0Y6hA==` |
| Files / size | 479 files, 3,781,313 bytes packed, 7,114,971 unpacked |
| MOMUS build digest | `9106a6d8988d87788f013542d77e0616aa4daad31645232a08b6a68d369431f2` (81 `dist/*.js`) |
| Ruleset | v23 `sha256-J12lNmUUNTNkzbkKeYxmAHSVgmUlrWt3+NvDp4+9i1g=` |

## Checks

| Check | Result | Log |
|---|---|---|
| Build, typecheck | pass | `build.log`, `typecheck.log`, `pack.log` |
| Tests | 2135 of 2135, 85 files (`--maxWorkers=3`; the Mac's load average was 12–30, `load.log`) | `tests.log` |
| Red team, Claude Code profile | 0 of 28 delivered; field regressions 0 of 4; the same log as 0.34.0 | `redteam.log` |
| Red team, Codex / OpenCode | `all`: 0 of 28; `data`: the same three as 0.26.0–0.34.0 (`--check` exits 1 for these profiles in `data`); each log equal to 0.34.0's apart from the version and the folder | `redteam-codex-*.log`, `redteam-opencode-*.log` |
| Ruleset vs registry | pass before publication (0.35.0 is not on npm yet) | `ruleset.log` |
| Version references, release mode | pass | `versions-check.log` |
| Clean consumer | installs into an empty project with `--ignore-scripts`; `hintContradictions` imports from the package entry; the installed `warden-mcp scan --project` on one stdio server whose `update_issue_labels` says `destructiveHint: false` and "This replaces the current labels with the provided list" prints `⚠ hint vs description` and exits 0 | `clean-consumer.log` |

## MOMUS release gate

| | |
|---|---|
| Candidate image | `histor-histor:warden-0.35.0-prod` = `sha256:ef3e5cb4b31278cc91d1d88c72fa3f3ed1aac8cd533280b09f4d6129c8f68903` |
| Built from | `histor-histor:cosigned-20261120` = `sha256:c82f2e7f…`: the image another session built FROM the live 0.34.0 image and scheduled to switch to after the open crawl (`/root/histor-cosigned-20261120` on the HISTOR host). A candidate from `warden-0.34.0-prod` would have undone that change on switching. Vendored WARDEN replaced by this tarball and the source of `5dba9049f` (`quality/Dockerfile.candidate`). Built on admin-vps; context sent with `COPYFILE_DISABLE=1 tar --no-xattrs` (no `._*` files) |
| Image check | 11,067 files in the base, 11,072 in the candidate, none different, added or removed outside the WARDEN folders; vendored 0.35.0, 81 `dist/*.js`, build digest `9106a6d8…` (`quality/verify.log`) |
| Run | `skopos-warden-quality candidate sha256:ef3e5cb4…`, unit `warden-release-quality-035-prod-20261120`, started 2026-11-20 20:53:48Z |
| Result | **passed** 2026-11-20 20:53:54Z (evaluated), run `20261120T205354`, policy `zero-regressions-v1`; development 8,244 attacks / 362 benign, holdout 24 / 24, candidates 22, behaviour 72 / 72 and smoke 72 / 72, 0 missed, 0 false positives, 0 incomplete; discovery complete (round 67). Baseline build `6617a3ff…` (0.34.0) |
| Receipt | `quality/candidate-signed.json`, expires 2026-11-22 20:53:54Z |
| `authorize` | done 2026-11-20 21:01:50Z (`skopos-warden-quality authorize sha256:ef3e5cb4…`; it prints nothing when it accepts) |

## Production HISTOR (owner «Yes, switch then», 2026-11-20)

- The cosigned switch of the other session ran 2026-11-21 04:51:03Z (`SWITCH-OK`, healthy after 15 minutes,
  0 tracebacks).
- **First run of `histor-wd035-switch`, 05:11–05:12Z: a healthy switch rolled back by a wrong check of mine.** The
  image came up healthy on `ef3e5cb4…` with vendored WARDEN 0.35.0, but the waiter checked the bare
  `/api/v1/fingerprints`, which answers 400 by design when no server is named (it does so on every image). It rolled
  back to `cosigned-20261120` at 05:12:30Z (healthy). Production ran the cosigned image until the second run.
- **Second run (`histor-wd035-switch2`, route check names a server: `?package=npm:@aimarket/warden`):** 10:11:43Z
  `histor-histor-1` healthy on `sha256:ef3e5cb4…`; `/`, `/health`, `/api/v1/stats`, `/api/v1/fingerprints?package=…`
  and `/api/v1/log/checkpoint/cosigned` answer 200; vendored WARDEN 0.35.0 (`/root/wd035-prod-20261120/after.log`,
  `quality/after.sh`). Only the image line of `docker-compose.warden-image.yml` changed.
- 10:11:52Z `histor-wd035-live` on admin-vps: `skopos-warden-quality live sha256:ef3e5cb4…` accepted (`LIVE-OK`).
  Public receipt (`quality/latest-signed-after.json`): phase `live`, status `passed`, build `9106a6d8…`, run
  `20261120T205354`. This tarball's own `check-quality-gate.mjs` passes (`quality/check-quality-after.log`).
- Rollback: HISTOR host `/root/wd035-prod-20261120/switch.sh rollback`, then admin-vps
  `skopos-warden-quality rebind sha256:c82f2e7fc9f97cb95651b7dd2a09875663cf464e33a9ef68a4ca37f5b2569ed7`.
- `histor/scanner` in main now vendors this tarball (`vendor/warden-build.json`); the installed `package.json` has the
  same sha256 as production's (`35740a26…`); `npm test` there passes (5).

## npm

Published by the owner 2026-11-20 21:12:38Z (registry `time`). The registry's tarball is byte-identical to
`aimarket-warden-0.35.0.tgz` (`cmp`), shasum `d3ba314d…` and integrity as above; jsDelivr and unpkg serve 0.35.0.

## okx-a2mcp

- 2026-11-20 21:24:55Z production (modelmarket.dev/a2mcp, /tools) on WARDEN 0.35.0: `okx-a2mcp/deploy.sh` from
  `1ab42141c`, image `okx-a2mcp:prod-20261120-1ab42141c` built on the host from npm; healthy, 0 restarts, no error
  lines. `/health` reports warden 0.35.0; the installed `dist/hint-claims.js` has the same sha256 as this tarball's
  (`55398608…`). The public `warden-scan` blocks "Ignore previous instructions…", allows the clean tool, engine
  `@aimarket/warden@0.35.0`, ruleset 23. It runs the gate chain, not `scan`, so `TOOL_HINT_CONTRADICTS_DESCRIPTION`
  does not appear there. Rollback: the stopped `okx-a2mcp-prev` (`prod-20261120-bed23ef94`, WARDEN 0.33.0).

## GitHub mirror / tag / Marketplace / MCP registry

- Mirror, tag and release `v0.35.0` were already on GitHub when this path resumed
  (https://github.com/alexar76/warden/releases/tag/v0.35.0, published 2026-11-20 21:15:27Z). Package and
  `server.json` on the satellite tip name 0.35.0.
- GitHub Marketplace listing
  https://github.com/marketplace/actions/warden-by-aimarket-mcp-tool-firewall — `latestRelease` = `v0.35.0`
  (checked 2026-11-21). No Firefox/OTP step required this time.
- Official MCP Registry: release-triggered "Publish to MCP Registry" for `v0.35.0` was cancelled while waiting on
  the `release` environment (run
  https://github.com/alexar76/warden/actions/runs/44818701110) — same as §132; registry entries come from the CLI.
  Published 2026-11-21 08:23:23Z with `mcp-publisher login github -token $GH_PAT` then
  `./scripts/publish_mcp_registry.sh --publish --only warden`. Live:
  `io.github.alexar76/warden` **0.35.0** `[active]` `isLatest=true`
  (`/v0.1/servers/io.github.alexar76%2Fwarden/versions/latest`).
- Profile monorepo tip already names `@aimarket/warden@0.35.0` (publish-all exit 0 earlier this session).
