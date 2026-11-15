# WARDEN 0.27.0 — prepared 2026-11-14, rebuilt 2026-11-15, MOMUS live 2026-11-15, on npm 2026-11-15 07:21Z

Prepared from aicom `main` at `c0dc1e29d` (ruleset 20, warden#14) with the version bumped to 0.27.0 in every pin. Rebuilt on
2026-11-15 after the reporter's follow-up on #14: the request-verb veto now needs the mnemonic as the verb's object, and a
finding names the clause that fired. The first build (`40483094…`, candidate `0a2f06e4…`, which passed MOMUS) is superseded;
its record is in `quality-superseded-0a2f06e4/`.

**Why 0.27.0 and not 0.26.2.** npm 0.26.1 was cut from a tree without `warden-mcp interceptor`, `interceptor-server`
and `tool-set-digest` (diff of the npm 0.26.1 `dist/` against this build: 12 new files, plus changes to
`mcp-server.js` and `static-scan.js`). A new subcommand and new modules make this a minor release.

## Artifact

| | |
|---|---|
| Tarball | `aimarket-warden-0.27.0.tgz` (this folder) |
| sha256 | `525622b730b3262d595aa2f3ad9ec059306a875fcf178b2ad1cd9cb15457829e` |
| npm shasum | `66b5764aa95d945922308c750cd2664e571f41f6` |
| integrity | `sha512-sUt+zLlk0rlpFUMRAkH3mmBH9iHdassQ/rR+i32hPYjWQn7BysKBjGodMRuqK8za1czAmWmPwNomBPGAB5AWzg==` |
| Files / size | 416 files, 1,136,640 bytes packed, 3,820,531 unpacked |
| MOMUS build digest | `403842d70620a8dd805ae4b4386613dc4b5804608b801ef75d674248a16c9772` (same from the tree and from the tarball) |
| Ruleset | v20 `sha256-s6KT1C2YyL3XbyqasSyExSh+0U8lsUjtypaSYo5bckA=` |

## Checks

| Check | Result | Log |
|---|---|---|
| Build, typecheck | pass | `build.log`, `typecheck.log` |
| Tests | 1788 of 1788 (`--maxWorkers=4`) | `tests.log` |
| Red team, Claude Code profile | 0 of 28 delivered, 2 answer-only noted; field regressions 0 of 4 | `redteam.log` |
| Red team, Codex / OpenCode | `all`: 0 of 28; `data`: 3 of 28 (`mcp-push-without-credential`, `unlabeled-invite-email`, `unlabeled-collaborator` — the same three as 0.26.0); field 0 of 4 in every profile | `redteam-*.log` |
| Ruleset vs registry | pass before publication (0.27.0 was not on npm yet) | `ruleset.log` |
| Version references, release mode | pass | `versions.log` |
| Clean consumer | the tarball installs into an empty project; main, `/codex` and `/opencode` import; ruleset 20; warden#14 A, B, C and "Paste your bytecode and get the mnemonic of each opcode" clear; D, "enter the mnemonic" and an EVM-worded wallet request block, and each message names its clause; `warden-mcp --help` and `warden-mcp interceptor --help` answer | `clean-consumer.log` |
| Scan demo | the real output of this build; the README block is identical | `scan-demo.log` |
| Quality gate (MOMUS) | **passed and live**: candidate `8dcade53…` run `20261115T062632` (0 missed, 0 false positives, 0 incomplete; behaviour 72 of 72), production HISTOR switched, public receipt live for build `403842d7…`; `check:quality` passes. Two earlier runs failed on DeepSeek transport alone, fixed by a retry in the measurement | `quality/`, `quality-after.log` |

## Published

npm `@aimarket/warden@0.27.0`, 2026-11-15 07:21:12Z (registry time), published by the colleague; `latest` is 0.27.0.
The registry tarball equals the one in this folder byte for byte (sha256 `525622b7…`, shasum `66b5764a…`), and `npx -y
@aimarket/warden@0.27.0 scan` prints ruleset 20. The second reply on warden#14 went up at 07:21:28Z (comment
6890999472, the text of the prepared draft); the issue stays open for the reporter's re-run. Check: `published.log`.

## What is left

1. The GitHub mirror still shows 0.26.1 (no v0.27.0 tag). The reply on #14 points at the A–D tests in
   `test/warden-benign.test.ts`, which the mirror does not have until it is synced.
2. MCP registry entry: `io.github.alexar76/warden` is at 0.26.1 in registry.modelcontextprotocol.io.
