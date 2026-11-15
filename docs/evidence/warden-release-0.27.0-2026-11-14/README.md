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

## GitHub mirror, tag, MCP registry (2026-11-15)

The owner pushed the mirror; the tag and the registry entries followed the same day. Checked by Claude from a
fresh clone of github.com/alexar76/warden:

- Mirror commit `d48ca87` (pushed 10:39Z by GitHub's clock): `package.json` 0.27.0; `src/`, `test/`, `docs/` and
  `scripts/` equal the monorepo export of `7932d1609` file for file (the README badge header, LICENSE, CONTRIBUTING and
  community files differ by the mirror's design); `verify_mirror_secrets.sh` passes on the clone; the four evidence files
  that name the HISTOR host are absent. CI, CI macOS, npm dependency security and Pages passed.
- Tag `v0.27.0` (annotated) points at `d48ca87`; the GitHub release (13:13:31Z) carries
  `scripts/release-notes/v0.27.0/warden.md` unchanged. The release-triggered "Publish to MCP Registry" workflow was
  cancelled before any step ran; the registry was published from the checkout instead.
- Official MCP registry: `io.github.alexar76/warden` 0.27.0 (13:32:43Z) and `io.github.alexar76/aimarket-oracle-gateway`
  0.3.3 (13:32:41Z), both active and latest.

## What is left

Glama still showed 0.26.1 at the check; it reads the GitHub repo and refreshes on its own schedule. PulseMCP takes the
official registry by itself and refuses scripted requests, so it is checked in a browser.

Checked again 2026-11-15 ~16:10Z (server clock):
- Glama: https://glama.ai/mcp/servers/alexar76/warden still shows 0.26.1.
- PulseMCP (browser, search `alexar76`): four of our entries, none of them `io.github.alexar76/warden`. They are
  argus3 0.3.6 (= registry latest; its card describes the WARDEN firewall inside ARGUS-3), "AIMarket Gateway"
  (aimarket-mcp), "AIMarket Oracle Gateway" still 0.3.2 (registry 0.3.3 since 13:32Z) and "AIMarket Packager".
  WARDEN, HISTOR, the hub and attested-memory are not listed. A banner says new submissions and listing changes are
  paused while PulseMCP reworks ingestion, so there is nothing to submit; look again after it reopens.
- warden#14: no new comment after Reply 2 (07:21:28Z); the issue is open, waiting for the author's A–D re-run.
