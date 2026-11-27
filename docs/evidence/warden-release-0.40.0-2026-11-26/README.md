# WARDEN 0.40.0 release (prepared, not published)

The stdio MCP server (`warden-mcp`) answers MCP 2026-07-28 beside the `initialize` handshake:
`server/discover`, per-request `_meta`, `resultType`, `ttlMs` / `cacheScope` on the lists, `-32022` with the
versions spoken for an unsupported version. Handshake clients are answered as in 0.39.2.

| Artifact | Value |
| --- | --- |
| npm package | `aimarket-warden-0.40.0.tgz` (516 files, 3.9 MB) |
| SHA-256 | `76739d2093945f982c0b86c6f53d1db75f7905374b5f3291d57825b55a7a83bd` |
| npm shasum | `0e89814bb321fab7414c8af2899017b8bc57fa1b` |
| Build digest (`dist/*.js`, what MOMUS signs) | `3a9d31899784256c6f1bebcce04b995dfbd5f6e28de123db110b483001c84f7f` |
| Source commit | `657e55b30` (the change itself: `9886575bc`) |

Built in a clean export of the commit (`git archive 657e55b30 warden`): `npm ci`, build, typecheck, the full
suite, `npm pack`. Logs beside this file.

## Checks

- Full suite on the clean export: 92 files, 2253 tests passed. Typecheck clean.
- Red team gate: 28 scenarios, 0 delivered; 4 field regressions, 0 delivered.
- `check-doc-versions.mjs --release`: every install pin is 0.40.0.
- Against the published 0.39.2 (both installed from their tarballs): in `dist/` only `mcp-rpc.js` and
  `mcp-rpc.d.ts` differ. Static scan ruleset v24, digest `sha256-Zopy0S98Rea7ozLSCa82BNsFO1ttse9ck6b/B4LrD9A=`,
  unchanged.
- `warden-mcp` from the installed tarball, driven over stdio: handshake still 2025-03-26 with serverInfo 0.40.0;
  `server/discover` lists `2026-07-28, 2025-03-26`; the 9 tools are byte-identical to 0.39.2's in both eras.
  0.39.2 answers `server/discover` with `-32601 method not found`.

## Not done

- **MOMUS quality gate.** `npm run check:quality` says "This exact WARDEN build has not passed", as it must
  for a new build digest. The owner runs MOMUS before npm, as for 0.39.1 and 0.39.2.
- npm publish, the GitHub mirror and tag, the MCP registry entry, the Marketplace release.
- The ERC-8004 feedback job stays pinned to 0.39.2 (`deploy/erc-8004/feedback.py`); the scanner did not change.
