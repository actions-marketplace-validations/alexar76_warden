# WARDEN 0.29.0 — prepared 2026-11-17, MOMUS live 2026-11-17

Built from a clean checkout of aicom `90fcf7a51` (`npm ci --ignore-scripts`, `npm run build`, then `npm pack`, whose
`prepare` builds again). The release adds the `malware-list` gate: an npm or PyPI package that OpenSSF lists as malware
is not started (`../malware-list-2026-11-17/` has the sources and the measurements). Rulesets are unchanged (23).
`dist/` gains three modules and the packed list, so the MOMUS build digest is new and the release needs its own run.

## Artifact

| | |
|---|---|
| Tarball | `aimarket-warden-0.29.0.tgz` (this folder) |
| sha256 | `d597feb3656eb3ece2d7cb17093a972528374a154465995d59e30121a7a6b531` |
| npm shasum | `26dd947570cb3844eda547498b041b6d85e5792d` |
| integrity | `sha512-nreNGWg7iPgvzmv2Kr/y/1kws/j/D3RE3EGgGxMxwUEa4tL037SeTCq2WslRs+MW6y2M/ccoxyPLFw72GvM6JA==` |
| Files / size | 429 files, 3,560,321 bytes packed, 6,325,256 unpacked (0.28.0: 416 files, 1,143,446 bytes); `dist/malware-list.tsv.gz` is 2,404,181 bytes of it |
| MOMUS build digest | `fbc9f734e08178a3b29377193a5baed445f5a63bafd557d7730408f42a056173` (same from the clean tree and from the tarball; 74 `dist/*.js`) |
| Ruleset | v23 `sha256-J12lNmUUNTNkzbkKeYxmAHSVgmUlrWt3+NvDp4+9i1g=` |
| Malware list | `sha256:b656eb8a15d8b2d0ad9d54a4f02606f9fd28a460d90dbc8d91968ffc38b80526`, 237,594 package lines; OpenSSF `f8c4d3d`, OpenSourceMalware.com via Vulnetix `c337489` |

## Checks

| Check | Result | Log |
|---|---|---|
| Build, typecheck | pass | `build.log`, `typecheck.log`, `pack.log` |
| Tests | 1908 of 1908 (`--maxWorkers=4`) | `tests.log` |
| Red team, Claude Code profile | 0 of 28 delivered, 2 answer-only noted; field regressions 0 of 4 | `redteam.log` |
| Red team, Codex / OpenCode | `all`: 0 of 28; `data`: 3 of 28 (`mcp-push-without-credential`, `unlabeled-invite-email`, `unlabeled-collaborator`, the same three as 0.26.0–0.28.0); field 0 of 4 in every profile | `redteam-*.log` |
| Ruleset vs registry | pass before publication (0.29.0 is not on npm yet) | `ruleset.log` |
| Version references, release mode | pass | `versions.log` |
| Clean consumer | the tarball installs into an empty project with `--ignore-scripts`; main, `/codex` and `/opencode` import; ruleset 23; the six new exports are there. `warden-mcp scan` on a project config, with a stand-in `npx` that records what it is asked to start: `flatmap-stream@0.1.1`, `postmark-mcp` (unpinned) and `@browserbasehq/mcp@2.1.1` are blocked with `KNOWN_MALICIOUS_PACKAGE` and never started; `@browserbasehq/mcp@3.0.0` is started (the stand-in exits, so it reads as not checked). The header says `malware list 2026-11-17`. `warden-mcp --help` and `warden-mcp interceptor --help` answer | `clean-consumer.log` |
| Quality gate (MOMUS) | blocked before the run, as expected: "This exact WARDEN build has not passed". Candidate `sha256:fbf1b2e9…` (0.29.0 vendored into the live HISTOR image) **passed**, run `20261117T085628`, authorized 09:05Z; production HISTOR switched 09:16Z, `live` 09:16:59Z, `check:quality` passes | `quality-before.log`, `quality/` |
