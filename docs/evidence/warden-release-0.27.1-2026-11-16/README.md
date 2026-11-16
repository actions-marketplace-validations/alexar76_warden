# WARDEN 0.27.1 — prepared 2026-11-16, not published

**Superseded, never published.** On 2026-11-16 the owner had this release renumbered to 0.28.0 (same source and build digest). See `../warden-release-0.28.0-2026-11-16/`.

Prepared from aicom `main` at `3cf70797c` (static-scan ruleset 23) with the version bumped to 0.27.1 in every pin.
A patch release: rulesets 21–23 and a link in the Markdown report footer; no new commands, options or modules
(`warden/src` since 0.27.0 differs only in `static-scan.ts` and `scan-report.ts`).

## Artifact

| | |
|---|---|
| Tarball | `aimarket-warden-0.27.1.tgz` (this folder) |
| sha256 | `1946fddd8dcf131865fffdd2a7bae965d7560bcd5e62fbd21c594a456d7b1b15` |
| npm shasum | `8efeb22e6f1cc2d50f0e734f54c3ad8844411b81` |
| integrity | `sha512-zVwCrajc40jCof+tnawTUlbaz0e0dH14xiAp2W0IrBsf5F5AZ090loTF1y2EMfktJ4oVvdUpmg9lGQ2r6bG+EA==` |
| Files / size | 416 files, 1,143,416 bytes packed, 3,842,044 unpacked |
| MOMUS build digest | `25e77ff9c307fd9bf65296985b8137e831d6ee6a6d966e33b53c326f6fbf41c7` (same from the tree, from the tarball and after a rebuild) |
| Ruleset | v23 `sha256-J12lNmUUNTNkzbkKeYxmAHSVgmUlrWt3+NvDp4+9i1g=` |

## Checks

| Check | Result | Log |
|---|---|---|
| Build, typecheck | pass | `build.log`, `typecheck.log` |
| Tests | 1891 of 1891 (`--maxWorkers=4`) | `tests.log` |
| Red team, Claude Code profile | 0 of 28 delivered, 2 answer-only noted; field regressions 0 of 4 (log identical to 0.27.0) | `redteam.log` |
| Red team, Codex / OpenCode | `all`: 0 of 28; `data`: 3 of 28 (`mcp-push-without-credential`, `unlabeled-invite-email`, `unlabeled-collaborator`, the same three as 0.26.0 and 0.27.0); field 0 of 4 in every profile | `redteam-*.log` |
| Ruleset vs registry | pass before publication (0.27.1 is not on npm yet) | `ruleset.log` |
| Version references, release mode | pass | `versions.log` |
| Clean consumer | the tarball installs into an empty project; main, `/codex` and `/opencode` import; ruleset 23; warden#14 A, C, E, J clear and D, G, K block, each message naming its clause; the ruleset 21 seed-phrase checksum clears and "No API key needed" gives no credential advisory; three ruleset 23 bypasses block and two honest warnings ("Under no circumstances, share …", "Never — under any circumstances — share …") clear; `warden-mcp --help` and `warden-mcp interceptor --help` answer | `clean-consumer.log` |
| Scan demo | the real output of this build; only the header line differs from 0.27.0 (version and ruleset), and the READMEs carry it | `scan-demo.log` |
| Field corpus 2026-10-01 | 1,027 servers, 16,231 tools: every blocking and advisory verdict of ruleset 23 equals ruleset 22 (and 22 equals 21) | commit `3cf70797c` |
| Quality gate (MOMUS) | blocked before the run, as expected: "This exact WARDEN build has not passed" | `quality-before.log` |

## Left

MOMUS candidate on the production HISTOR image, then (owner's yes) the production switch and `live`; then npm by the
colleague (colleague-tasks §119).
