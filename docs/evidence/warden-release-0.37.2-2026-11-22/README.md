# WARDEN 0.37.2 — prepared 2026-11-22

Built from a clean export of aicom `7bfcbfa95` (`git archive … warden`; `npm ci --ignore-scripts`, `npm run build`,
`npm run typecheck`, vitest, red team, ruleset and version checks, then `npm pack`), Node and npm in `versions.log`.

Change: tool-set digests follow `mcp-tool-set-digest/1` section 12 — every level up to 512 (tools array = level 1)
is digested; past that `TSD-DEPTH` / `MTL-SUBJ-005` for the side that holds the value. Rulesets stay 23; malware list,
masking and flow-guard rules are unchanged from 0.37.1. `dist/*.js` changed, so the MOMUS build digest is new.

## Artifact

| | |
|---|---|
| Tarball | `aimarket-warden-0.37.2.tgz` (this folder) |
| sha256 | `510f299c0e8e620bd3d0545d432181730b2a6d80485efd97c97927d11521d2d6` |
| npm shasum | `5ee5d293a8a4ec684fa2c538009fe272e0a9cca9` |
| integrity | `sha512-aS+94deVd28YzkGYZUJhijWTtjsw5uAu3byF7UyxM5kSke/weXPBcWtRa5c96kjtobuw85DYeFUmTqNvmOGG7g==` |
| Files / size | 503 files, 3,877,986 bytes packed, 7,463,049 unpacked |
| MOMUS build digest | `721354e0c143ae39a2500a216c671b6668d574ffb0e767f0bf4bf9d47bec5738` (84 `dist/*.js`) |
| Ruleset | v23 `sha256-J12lNmUUNTNkzbkKeYxmAHSVgmUlrWt3+NvDp4+9i1g=` |

## Checks

| Check | Result | Log |
|---|---|---|
| Build, typecheck | pass | `build.log`, `typecheck.log`, `pack.log` |
| Tests | 2181 of 2181 (`--maxWorkers=3`, load ~30) | `tests.log`, `load.log`, `tests-rerun.log` |
| Red team, Claude Code profile | 0 of 28 delivered; field regressions 0 of 4 | `redteam.log` |
| Ruleset vs registry | pass before publication (0.37.2 is not on npm yet) | `ruleset.log` |
| Version references, release mode | pass | `versions-check.log` |
| Clean consumer | installs into an empty project with `--ignore-scripts`; `warden-mcp --help` runs | `clean-consumer.log` |

Not run for this release: the Codex and OpenCode red-team profiles, the Hermes, OpenClaw and OpenWebUI plugin checks.
The change does not touch them.

## MOMUS / production HISTOR

Filled in after the candidate run and switch (see `quality/`).
