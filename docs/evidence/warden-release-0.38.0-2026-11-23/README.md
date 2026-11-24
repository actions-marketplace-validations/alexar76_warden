# WARDEN 0.38.0 release candidate

Built from monorepo main `9443d42e6` (≥ `29917ab08`). A token sent back to its issuer is asked about
(`secret_issuer`); the interceptor refuses a payload with `tools` next to `result` (`TSD-TOOL`).

| Artifact | Value |
| --- | --- |
| npm package | `aimarket-warden-0.38.0.tgz` |
| SHA-256 | `b4b647989dc28ba480c2fa17d55072e3bc27026528f8543f286f22386d06c8f6` |
| npm shasum | `0ed5248a65882b4d136805d342dcd985d85117e3` |
| MOMUS build digest | `cbb3a54fa345fca64aff9c2d54349c3fe9dee2b4e1b429fd6df161efd29c110b` |
| Ruleset | v23, `sha256-J12lNmUUNTNkzbkKeYxmAHSVgmUlrWt3+NvDp4+9i1g=` |
| Source commit | `9443d42e64323dca17db17b36144f257e616cf04` |

Build, typecheck, release-version checks and the full suite passed on this candidate (2217 of 2226 at first
run under sandbox PTY pressure; the 9 wrap TTY cases plus the process-spawning set named in Claude 23.11 —
wrap, persistent-pins, publish-pr, pin-review-origin, server-info-validation, task-adapter, wrap-mask —
re-ran with `--testTimeout=60000` unsandboxed: **262 of 262**. Interceptor: **126 passed**. Red-team:
0 of 28 deliveries and 0 of 4 field regressions. Terminal egress: exit 0. Ruleset check: pre-release OK.

The public MOMUS receipt does not cover this digest yet. Run the HISTOR candidate and live procedure for this
exact archive before publishing the same archive.
