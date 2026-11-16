# WARDEN 0.28.0 — prepared 2026-11-16, MOMUS live 2026-11-16, not on npm yet

Built from a clean checkout of aicom `3e11a0697` (`npm ci --ignore-scripts`, then `npm pack`). It is the release
first prepared as 0.27.1 (`c10e0b614`, folder `../warden-release-0.27.1-2026-11-16/`), renumbered at the owner's
request: static-scan verdicts change, so it is a minor version. 0.27.1 was never published. The source differs from
0.27.1 only in the version strings. `dist/` carries no version, so the MOMUS build digest is the same (`25e77ff9…`)
and the MOMUS run started for 0.27.1 judges this build too.

## Artifact

| | |
|---|---|
| Tarball | `aimarket-warden-0.28.0.tgz` (this folder) |
| sha256 | `f5cfaa70b30ba85dce6b48c7c5f82696cdc68cd0e6219ac65c117c2065adb958` |
| npm shasum | `6b3752baae7821dcee3f599f2a8f40619c559906` |
| integrity | `sha512-JfOF6FrI/Z/WpM6doelCYACLyez7aCVM3pOZWA7meqn8CciIzxs0XZbIOoWL9WQwg0tCaYFGQRQpHccPiThYHw==` |
| Files / size | 416 files, 1,143,446 bytes packed, 3,842,149 unpacked |
| MOMUS build digest | `25e77ff9c307fd9bf65296985b8137e831d6ee6a6d966e33b53c326f6fbf41c7` (same from the clean tree and from the tarball; equal to 0.27.1) |
| Ruleset | v23 `sha256-J12lNmUUNTNkzbkKeYxmAHSVgmUlrWt3+NvDp4+9i1g=` |

## Checks

| Check | Result | Log |
|---|---|---|
| Build, typecheck | pass | `build.log`, `typecheck.log` |
| Tests | 1891 of 1891 (`--maxWorkers=4`) | `tests.log` |
| Red team, Claude Code profile | 0 of 28 delivered, 2 answer-only noted; field regressions 0 of 4 | `redteam.log` |
| Red team, Codex / OpenCode | `all`: 0 of 28; `data`: 3 of 28 (`mcp-push-without-credential`, `unlabeled-invite-email`, `unlabeled-collaborator`, the same three as 0.26.0 and 0.27.0); field 0 of 4 in every profile | `redteam-*.log` |
| Ruleset vs registry | pass before publication (0.28.0 is not on npm yet) | `ruleset.log` |
| Version references, release mode | pass | `versions.log` |
| Clean consumer | the tarball installs into an empty project; main, `/codex` and `/opencode` import; ruleset 23; warden#14 A and C clear, D and K block; the ruleset 21 checksum case and "No API key needed" clear with no credential advisory; two ruleset 22 and two ruleset 23 bypasses block; two honest warnings clear; `warden-mcp --help` and `warden-mcp interceptor --help` answer | `clean-consumer.log` |
| Scan demo | the real output of this build; equal to 0.27.1's apart from the version in the header, and the READMEs carry it | `scan-demo.log` |
| Field corpus 2026-10-01 | npm 0.27.0 against this tarball, 1,027 servers and 16,231 tools: blocks 0 lost, 0 gained; 378 advisory matches gone, 9 advisory matches now cite a later, real mention | `corpus-0.27.0-vs-0.28.0.log` |
| Quality gate (MOMUS) | blocked before the run, as expected: "This exact WARDEN build has not passed". Candidate `sha256:c936f1ce…` (0.28.0 vendored) **passed**, run `20261116T145955`, authorized; production HISTOR switched 15:15Z, `live` 15:16Z, `check:quality` passes | `quality-before.log`, `quality/` |

## Left

1. npm by the colleague (colleague-tasks §119 step 3), then the mirror, tag `v0.28.0` and the MCP registry (step 4).
   The mirror needs no new exclusions: an export of `warden/` at `af7413deb` trips the private-host check only on files
   the satellite map already leaves out (0.26.0 and 0.27.0 evidence, one scanner manifest).
2. The never-published 0.27.1 candidate (`histor-histor:warden-0.27.1-prod`, on the HISTOR host and admin-vps; kit
   `/root/wd0271-prod-20261116`) and the previous production image can be removed; the owner's call.
