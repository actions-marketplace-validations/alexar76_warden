# WARDEN 0.33.0 — prepared 2026-11-20, MOMUS gate passed, live on HISTOR

Built from aicom `19506f6bd`. Open Terminal under OpenWebUI Integrations now goes through the Filter and the
WARDEN gateway (approval scoped to the terminal connection, chat, user and arguments). Rulesets unchanged (23).

## Artifact

| | |
|---|---|
| Tarball | `aimarket-warden-0.33.0.tgz` (this folder) |
| sha256 | `31de2475d64a8d600203ea05714f035e3ff18daa6a6ed5c2111844b9c8b8f4c2` |
| npm shasum | `3b294f00dbf6d1e0f5d7cb295696eb9b629dd726` |
| integrity | `sha512-HISI0F9xx9uZOY1+e5Tf5V2oKMo7N5skHybQJ7f5rixet0mpSTKnxksrKIHgKsmy4n4oiBheQxADb7KoL8zYKg==` |
| MOMUS build digest | `64ae3d653e8cba0b89e6c52ca28e38ad4c1ea275ff44a3c0cd7f3fe5febac4ae` (80 `dist/*.js`) |
| Ruleset | v23 `sha256-J12lNmUUNTNkzbkKeYxmAHSVgmUlrWt3+NvDp4+9i1g=` |

## Checks

| Check | Result |
|---|---|
| Tests | 2,123 across 84 files |
| Open WebUI 0.11.4 regressions | 21 / 21 |
| Clean consumer install of this tarball | pass |
| `check-quality-gate.mjs` on this tarball | `MOMUS release gate passed: 20261120T082759, 64ae3d65…` |

## MOMUS release gate

| | |
|---|---|
| Candidate image | `histor-histor:warden-0.33.0-prod` = `sha256:d7b493ab2e201ec687202a25e751a9d27b10f9544b5d27844d535ae36e0ef7ee` |
| Built from | `histor-histor:warden-0.32.0-prod` = `sha256:7fa51dbf…`, vendored WARDEN replaced by this tarball and source of `19506f6bd` (`quality/Dockerfile.candidate`). Built on admin-vps |
| Image check | outside WARDEN folders equal; vendored 0.33.0, 80 `dist/*.js`, build digest `64ae3d65…` (`quality/verify.log`) |
| Run | `skopos-warden-quality candidate sha256:d7b493ab…` (unit `warden-release-quality-033-prod-20261120`), run `20261120T082759` |
| Result | **passed**, policy `zero-regressions-v1`. development 8,244 / 362, holdout 24 / 24, behaviour 72 / 72, 0 missed, 0 false positives, 0 incomplete. Discovery complete. Baseline build `0a046db5…` (0.32.0) |
| Receipt | `quality/candidate-signed.json` |
| Expires | ~2026-11-22 08:27Z |
| `authorize` | done 2026-11-20 ~08:35Z |

## Production HISTOR (owner publish 2026-11-20)

- Image transferred admin-vps → HISTOR host (`docker save | docker load`), same ID `sha256:d7b493ab…`.
- 08:37:26Z `histor-histor-1` healthy on `sha256:d7b493ab…` (`quality/switch.sh`). Only the image line of `docker-compose.warden-image.yml` changed.
- `skopos-warden-quality live sha256:d7b493ab…` → LIVE_OK. Public receipt phase `live`, status `passed`, build `64ae3d65…`, run `20261120T082759`.
- Rollback: HISTOR host `/root/wd033-prod-20261120/switch.sh rollback`, then admin-vps `skopos-warden-quality rebind sha256:7fa51dbf5dea26df1adedf90c2324ce371f81d4d803eb198553bae965c5d6c54`.

Published to npm from this recorded tarball (`npm publish …/aimarket-warden-0.33.0.tgz --access public`), not via `publish_warden.sh`.
