# WARDEN 0.33.0 release candidate

The Open WebUI Filter checks model calls to Open Terminal configured under Integrations. Requests and results go
through the existing WARDEN gateway. Approval is scoped to the terminal connection, chat, user and arguments.

| Artifact | Value |
| --- | --- |
| npm tarball | `aimarket-warden-0.33.0.tgz` |
| SHA-256 | `31de2475d64a8d600203ea05714f035e3ff18daa6a6ed5c2111844b9c8b8f4c2` |
| MOMUS build digest | `64ae3d653e8cba0b89e6c52ca28e38ad4c1ea275ff44a3c0cd7f3fe5febac4ae` |
| Ruleset | v23, `sha256-J12lNmUUNTNkzbkKeYxmAHSVgmUlrWt3+NvDp4+9i1g=` |

The full test suite passed 2,123 tests across 84 files. Terminal coverage checks the Filter adapter and the gateway's
`audit`, `deny` and `ask` decisions. The Docker regression run on Open WebUI 0.11.4 passed all 21 existing scenarios
and verified setup, check and undo. The packed archive installed in an empty directory with lifecycle scripts
disabled. Its version, exported library, CLI, terminal Filter and build digest were verified.

The release check requires a fresh signed MOMUS receipt for the build digest above. The current receipt is for a
different build. Follow the HISTOR candidate and live procedure recorded for [0.32.0](../warden-release-0.32.0-2026-11-20)
and rerun `npm run check:quality` against this artifact before publishing it. The Open Terminal integration itself
uses the Open WebUI Filter and WARDEN gateway.
