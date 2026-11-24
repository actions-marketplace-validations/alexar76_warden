# WARDEN 0.39.0 release candidate

Built from monorepo main `23fcfe28d` (≥ `9abd8f5ff`). Static scan ruleset 24 adds advisory
`TOOL_DEF_SHORT_LINK` (URL shorteners in tool prose). No blocking rule changed.

| Artifact | Value |
| --- | --- |
| npm package | `aimarket-warden-0.39.0.tgz` |
| SHA-256 | `e87e2adbdbcf9e08654353b3ba8a4301f6d73157dc1806022597b2d294b32d2b` |
| npm shasum | `28b8ff87d6ee30f27450591d94fd24810bfa3328` |
| MOMUS build digest | `18221b0084f1f800d0ef916b9613d0ebfd61853d35b1726cc05106ab03c88c0c` |
| Ruleset | v24, `sha256-Zopy0S98Rea7ozLSCa82BNsFO1ttse9ck6b/B4LrD9A=` |
| Source commit | `23fcfe28d85e8fedd4125a400f3ba6e3c1d45961` |

Build, typecheck and release-version checks passed. Full suite: 2234 of 2243 locally (9 wrap TTY
cases failed with macOS `out of pty devices`); wrap re-ran on the operator host: **124 of 124**. The other
named timeout set (persistent-pins, action, annotation-review, pin-review-origin) passed locally
at `--testTimeout=60000`. Ruleset-v24 + benign: **65 of 65**. Red-team: 0 of 28 deliveries and 0 of
4 field regressions. Terminal egress: exit 0. Ruleset check: pre-release OK.

HISTOR base for the MOMUS candidate must be `histor-histor:shortlinks-20261124` =
`sha256:2c44c3dfb004fe3b58adcb82dea58dae6a9c29f04065114ad4fa9f25a3c33ed3` (live 2026-11-24).

## Production (2026-11-24)

| | |
|---|---|
| Candidate image | `histor-histor:warden-0.39.0-prod` = `sha256:c5f3faf199da2f199daf2440364286ccaf33f9772f8a1441f9b656184c31b7dc` |
| Built FROM | `histor-histor:shortlinks-20261124` = `sha256:2c44c3df…` |
| MOMUS candidate | **passed**, run `20261124T103702`, policy `zero-regressions-v1`; buildDigest `18221b00…` |
| HISTOR switch | `SWITCH-OK` 10:43:10Z on the HISTOR host; short links still `['bit.ly']`; vendored WARDEN **0.39.0** |
| `/opt/histor` scanner | vendor + package.json/lock updated to 0.39.0 (previous in `/root/wd0390-switch-20261124/opt-prev-scanner`) |
| Live | `skopos-warden-quality live` OK; `/.well-known/aicom-histor-runtime.json` and `/security-quality/latest.json` name digest `18221b00…` / image `c5f3faf1…` |

Not yet: npm publish (needs `@aimarket` auth), mirror, tag v0.39.0, Marketplace, MCP registry (§163 approve).
