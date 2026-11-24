# WARDEN 0.37.3 release candidate

This candidate contains the Open Terminal integration fixes for AI-37. The Filter passes structured results to the
gateway. Verified diagnostic output and process acknowledgements stay separate from arbitrary command output.
Process IDs and default per-user home prefixes are handled only in their routing fields. Setup also detects
rootless Docker and uses its daemon-owner mapping for the gateway's private mounts.

| Artifact | Value |
| --- | --- |
| npm package | `aimarket-warden-0.37.3.tgz` |
| SHA-256 | `6b0d1e8c3d79b4c00189f2208b8a6a55047e86e5f904b7a3d1c424fa145bdda6` |
| MOMUS build digest | `8f685dd818a52e09b0b9a029bf25ec333edda8355499570905017d23e87bc6b2` |
| Ruleset | v23, `sha256-J12lNmUUNTNkzbkKeYxmAHSVgmUlrWt3+NvDp4+9i1g=` |

Build, typecheck, release-version checks and 88 targeted tests passed on the 0.37.3 candidate. The ruleset check
confirmed that the version was available for release. The red-team regression run recorded 0 of 28 deliveries and
0 of 4 field regressions. Installation in a clean project verified the package version, exact build digest,
library import, OpenWebUI CLI and the updated Filter.

The Open WebUI 0.11.4 slim and Open Terminal 0.14.0 run on the integration patch passed all six audit, deny and ask
scenarios. See [the terminal report](terminal-check.json). The rootless Compose UID selection passed its test.
Starting on a real rootless engine remains to be verified.

The public MOMUS receipt does not cover this digest yet. Run the HISTOR candidate and live procedure for this exact
archive and verify `npm run check:quality` before publishing the same archive. [Previous release procedure](../warden-release-0.37.2-2026-11-22)
