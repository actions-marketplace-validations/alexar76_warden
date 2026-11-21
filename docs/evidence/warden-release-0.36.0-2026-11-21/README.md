# WARDEN 0.36.0 — prepared 2026-11-21

Built from a clean export of aicom `bcd830766` (`git archive … warden`; `npm ci --ignore-scripts`, `npm run build`,
then `npm pack`, whose `prepare` builds again; `dist/` was the same before and after the pack), Node and npm in
`versions.log`. One change: `TOOL_HINT_CONTRADICTS_DESCRIPTION` carries `evidence: { claim, matchedPhrase,
quotedSentence }` in `--json` and in `hintContradictionFindings`, and `hintContradictions` adds `phrase` and
`sentence` (asked on DEV, 2026-11-21, under the readOnlyHint article). The message is unchanged. No verdict changes:
rulesets are 23, the malware list and the flow guard are 0.35.0's. `dist/hint-claims.js` changed, so the MOMUS build
digest is new and the release needs its own run.

## Artifact

| | |
|---|---|
| Tarball | `aimarket-warden-0.36.0.tgz` (this folder) |
| sha256 | `28544c38d4cc4862ec97015cd0f8b3f262e7b2f8b8a8d60d7c7c1bac62250d2e` |
| npm shasum | `9b6077068dc76ba445d0b3b61862395d0068b412` |
| integrity | `sha512-aZS11xbPGFZBwV+JY5GVF9757n6kOIWT5EoxoNEnR03oYPoFTG4TCNYRN1XUHPvZsWJupBfQNYjujPm0IOzikA==` |
| Files / size | 479 files, 3,783,229 bytes packed, 7,120,890 unpacked |
| MOMUS build digest | `5654940ad487dd66cabcf7b703f96cd03ea7dd2cc1e1a0890269b70db0253936` (81 `dist/*.js`) |
| Ruleset | v23 `sha256-J12lNmUUNTNkzbkKeYxmAHSVgmUlrWt3+NvDp4+9i1g=` |

## Checks

| Check | Result | Log |
|---|---|---|
| Build, typecheck | pass | `build.log`, `typecheck.log`, `pack.log` |
| Tests | 2137 of 2137, 85 files (`--maxWorkers=3`) | `tests.log`, `load.log` |
| Red team, Claude Code profile | 0 of 28 delivered; field regressions 0 of 4; the same log as 0.35.0 | `redteam.log` |
| Red team, Codex / OpenCode | `all`: 0 of 28; `data`: the same three as 0.26.0–0.35.0 (`--check` exits 1 for these profiles in `data`); each log equal to 0.35.0's apart from the version and the folder | `redteam-codex-*.log`, `redteam-opencode-*.log` |
| Ruleset vs registry | pass before publication (0.36.0 is not on npm yet) | `ruleset.log` |
| Version references, release mode | pass | `versions-check.log` |
| Clean consumer | installs into an empty project with `--ignore-scripts`; `hintContradictions` returns `phrase` and `sentence`, `hintContradictionFindings` sets `evidence`; the installed `warden-mcp scan --project --json` on one stdio server with two contradicted tools gives both rows through the documented `jq` line; the text output is unchanged and exits 0 | `clean-consumer.log` |

In the source tree before the export, the first full run had 2 failures in 2 files that were not identified and did
not repeat; the second run and this clean export passed all 2137.

## MOMUS release gate

| | |
|---|---|
| Candidate image | `histor-histor:warden-0.36.0-prod` = `sha256:3e2b70a5f17e46677afddf6c5a01142a94b040ccd072727a1513906c3913ba16` |
| Built from | `histor-histor:subregistry-20261121` = `sha256:02011e75…`, the image HISTOR production runs since 2026-11-21 10:27Z, with vendored WARDEN replaced by this tarball and the source of `bcd830766` (`quality/Dockerfile.candidate`). Built on admin-vps; context sent with `COPYFILE_DISABLE=1 tar --no-xattrs` (no `._*` files) |
| Image check | 11,073 files in the base and in the candidate, none different, added or removed outside the WARDEN folders; vendored 0.36.0, 81 `dist/*.js`, build digest `5654940a…` (`quality/verify.log`) |
| Run | `skopos-warden-quality candidate sha256:3e2b70a5…`, unit `warden-release-quality-036-prod-20261121`, started 2026-11-21 17:50:13Z |
| Result | **passed**, evaluated 2026-11-21 17:50:19Z, run `20261121T175019`, policy `zero-regressions-v1`; development 8,244 attacks / 362 benign, holdout 24 / 24, candidates 16, behaviour 72 / 72 and smoke 72 / 72, 0 missed, 0 false positives, 0 incomplete; discovery complete (round 68). Baseline build `9106a6d8…` (0.35.0). The unit ended 17:57:55Z |
| Receipt | `quality/candidate-signed.json`, expires 2026-11-23 17:50:19Z; the package's own `checkEvidence` accepts it for this build |
| `authorize` | done 2026-11-21 17:58:39Z (`skopos-warden-quality authorize sha256:3e2b70a5…`; it prints nothing when it accepts) |

Open alerts read before the switch (skopos-vps alerter, last 24 h): only "The disk of attested is filling up" was
open; HISTOR's disk alert closed 05:12Z and the host had 19 GB free.

## Production HISTOR (owner «все сделай задеплой», 2026-11-21)

- Candidate image copied from admin-vps (`docker save | docker load`), same ID `3e2b70a5…`.
- `histor-wd036-switch` (`quality/after.sh` → `quality/switch.sh`, sha256 `5cfd8312…` and `70a5a842…`, the same on the
  host) started 17:59:31Z with no open crawl: 18:00:00Z `histor-histor-1` healthy on `sha256:3e2b70a5…`; `/`, `/health`,
  `/api/v1/stats`, `/api/v1/fingerprints?package=npm:@aimarket/warden` and `/api/v1/log/checkpoint/cosigned` answer
  200; vendored WARDEN 0.36.0; `SWITCH-OK` 18:00:25Z (`/root/wd036-prod-20261121/after.log`). Only the image line of
  `docker-compose.warden-image.yml` changed (`.pre` copy kept in that folder).
- 18:00:56Z on admin-vps: `skopos-warden-quality live sha256:3e2b70a5…` accepted. Public receipt
  (`quality/latest-signed-after.json`): phase `live`, status `passed`, build `5654940a…`, run `20261121T175019`. This
  tarball's own `check-quality-gate.mjs` passes (`quality/check-quality-after.log`).
- Rollback: HISTOR host `/root/wd036-prod-20261121/switch.sh rollback`, then admin-vps
  `skopos-warden-quality rebind sha256:02011e75cf644c5164126f6ea03503d627787586203c6b3f1d87675b0e50fd65`.
- `histor/scanner` in main now vendors this tarball (`vendor/warden-build.json`); the installed `package.json` has the
  same sha256 as production's (`b95d389c…`); `npm test` there passes (5).

Seen on the HISTOR host while switching, not changed: `histor-witness-push` exits 1 on every run because one of seven
witnesses (witness.gdbsecurity.com) answers 429 (144 requests a day); the other six cosignatures are stored.
`histor-peers` failed at 12:11Z: scraperwatch's `changes.json` is larger than its 64 MB limit.

## npm, GitHub, MCP registry

Not published yet: colleague task §147 (npm from this tarball, mirror, tag v0.36.0, Marketplace, MCP registry).
