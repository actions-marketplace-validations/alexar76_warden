# WARDEN 0.30.0 — prepared 2026-11-17, MOMUS gate passed 2026-11-18

Built from a clean checkout of aicom `49e1c6b39` (`npm ci --ignore-scripts`, `npm run build`, then `npm pack`, whose
`prepare` builds again; the tree was unchanged after the build). The release adds `warden-mcp gateway` (OpenWebUI and
other platforms without agent hooks), the malware gate's checks of every package a launch line installs, the corrected
key-name rule of the flow guard and `blockAtSeverity` in the verdict. Rulesets are unchanged (23), the malware list is
0.29.0's. `dist/` gains the gateway modules, so the MOMUS build digest is new and the release needs its own run.

0.29.1 was prepared before this (launch-package checks only, tarball
`artifacts/ecosystem-p1-remediation-2026-11-17/warden/aimarket-warden-0.29.1.tgz`, MOMUS candidate run
`20261117T202244`). It was never published and must not be: it carries the first key-name narrowing, under which
`vnc_key`, `Key-Tool`, `key_toggle`, `key_event`, `mac_key`, `remote_key` and `puppeteer_key` are no longer treated as
keyboard input after outside text (0.29.0 and 0.30.0 treat them as keyboard input).

## Artifact

| | |
|---|---|
| Tarball | `aimarket-warden-0.30.0.tgz` (this folder) |
| sha256 | `83b7b8086fb00358e97c3e6966fbe9043782367e5fce9da835ead29665c7ea90` |
| npm shasum | `2c43b950f5284fd8215de7f6b409a9fe1d880d68` |
| integrity | `sha512-8jQOkrJr3k0T5xAJxOOgj20KbbRn8mSOepf4uBLbs1L8Q8WA5XZbdfCrsajm2RE9gJJr3DqSHXTJGqq/E+oGDQ==` |
| Files / size | 470 files, 3,708,725 bytes packed, 6,872,908 unpacked (0.29.0: 429 files, 3,560,321 bytes) |
| MOMUS build digest | `73c618fbc7e75ce7d506d17a7c5b061e8ad9fd75fb81b728fc5829f6a255218d` (same from the clean tree and from the tarball; 79 `dist/*.js`) |
| Ruleset | v23 `sha256-J12lNmUUNTNkzbkKeYxmAHSVgmUlrWt3+NvDp4+9i1g=` |
| Malware list | `sha256:b656eb8a15d8b2d0ad9d54a4f02606f9fd28a460d90dbc8d91968ffc38b80526`, 237,594 package lines (unchanged) |

## Checks

| Check | Result | Log |
|---|---|---|
| Build, typecheck | pass | `build.log`, `typecheck.log`, `pack.log` |
| Tests | 2036 of 2036 (`--maxWorkers=3`) | `tests.log` |
| Red team, Claude Code profile | 0 of 28 delivered, 2 answer-only noted; field regressions 0 of 4 | `redteam.log` |
| Red team, Codex / OpenCode | `all`: 0 of 28; `data`: 3 of 28 (`mcp-push-without-credential`, `unlabeled-invite-email`, `unlabeled-collaborator`, the same three as 0.26.0–0.29.0); field 0 of 4 in every profile | `redteam-*.log` |
| Ruleset vs registry | pass before publication (0.30.0 is not on npm yet) | `ruleset.log` |
| Version references, release mode | pass | `versions.log` |
| Clean consumer | the tarball installs into an empty project with `--ignore-scripts`; main, `/codex` and `/opencode` import; `--package` and `npm:` launches resolve to the installed package and a listed one is blocked; keyboard tools stay keyboard input, data keys do not; `warden-mcp gateway` starts, answers health (details only with the token) and refuses `/v1/pre` without a token | `clean-consumer.log` |
| Malware corpus (`../malware-list-2026-11-17/corpus.mjs`) | same counts as 0.29.0: pinned 3 block, 1 + 2 advisory; unpinned 22 + 2 advisory | — |
| OpenWebUI live checks (v0.11.4) | native 11/11, legacy 4/4, OpenAPI 7/7, browser 7/7 after the second review round | `../../openwebui.md#live-check` |
| Quality gate (MOMUS) | **passed**, run `20261118T041219` on HISTOR image `d75d0fe1…` (this tarball vendored): development 8,244 / 362, holdout 24 / 24, candidates 25, behaviour 72 of 72, 0 missed, 0 false positives; live on HISTOR since 07:05Z, `live` 08:02Z; this tarball's `check-quality-gate.mjs` passes | `quality/` |

## Before `npm publish`

**Hold note.** 16baae29c (2026-11-18 05:52Z, another session) wrote here "HARD STOP (owner 2026-11-18): do not
`npm publish` 0.30.0 until the colleague hold is lifted" and pinned the public installs back to 0.29.0. Its source is
not recorded (not in the colleague tasks; the ARGUS session did not write it). The owner then asked, ~08:05Z, to
prepare everything for 0.30 («подготовь везде все под 30»): the public pins, HISTOR's vendored scanner, okx-a2mcp and
the profile README are on 0.30.0 again, and they answer 404 until npm has 0.30.0. Publish when the owner confirms the
hold is lifted.

1. MOMUS: done 2026-11-18 (`quality/README.md`); the gate passes for build `73c618fb…` until 2026-11-20 04:12Z
   unless a daily run renews the receipt.
2. Publish this tarball (shasum `2c43b950…`), not a rebuild; check the registry shasum after.
3. Mirror, tag `v0.30.0` with `scripts/release-notes/v0.30.0/warden.md`, MCP registry.
