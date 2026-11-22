# WARDEN 0.37.0 — prepared 2026-11-22

Built from a clean export of aicom `0b57e7c4d` (`git archive … warden`; `npm ci --ignore-scripts`, `npm run build`,
then `npm pack`, whose `prepare` builds again; `dist/` was the same before and after the pack), Node and npm in
`versions.log`. Owner, 2026-11-22: «Да, готовь релиз».

One feature: masking. Credentials in what a tool returns are replaced by random placeholders before the model reads
them and put back only for the place they came from (on by default in `wrap` and the gateway); personal data by
profile (`gdpr`, `us`, `ru-152fz`, `pci`, `custom`, off by default); `warden-mcp agent-guard` and plugins for Hermes and
OpenClaw; `docs/masking*.md` in five languages. No scan verdict changes: rulesets are 23, the malware list and the
flow-guard rules are 0.36.0's. `dist/` gained `mask.js`, `mask-detect.js` and `agent-guard.js` (84 files), so the MOMUS
build digest is new and the release needs its own run.

## Artifact

| | |
|---|---|
| Tarball | `aimarket-warden-0.37.0.tgz` (this folder) |
| sha256 | `ef9ae648e1b3511321dbb0ba59f6993702d2162ca356716657609a046e6b68cc` |
| npm shasum | `dcd3ac172a66c78e09c9336c80d3751adcaabaee` |
| integrity | `sha512-AlWZ8hRzFtOlUjE7B9CJ02gpLmpt0qzBqeogJfKqtHX7a6XfZAMDLzmGLQFzC3Oc+Yf8hJzDRDSU/Yo/oL6FSg==` |
| Files / size | 503 files, 3,874,912 bytes packed, 7,451,667 unpacked |
| MOMUS build digest | `2f358b17d431a8638b1e90f3a24d68c74b4df86200667541d835ea8d610d2bac` (84 `dist/*.js`) |
| Ruleset | v23 `sha256-J12lNmUUNTNkzbkKeYxmAHSVgmUlrWt3+NvDp4+9i1g=` |

## Checks

| Check | Result | Log |
|---|---|---|
| Build, typecheck | pass | `build.log`, `typecheck.log`, `pack.log` |
| Tests | 2173 of 2174 in the full run (`--maxWorkers=3`, load average 28–31 from other work on the Mac): one test timed out at 5 s (`persistent-pins.test.ts`, process restarts). That file and `wrap.test.ts` again in the same export: 126 of 126 | `tests.log`, `load.log`, `tests-rerun.log` |
| Plugins and adapters | Hermes plugin 5 of 5 (against the real `agent-guard`), OpenClaw plugin 5 of 5, OpenWebUI adapters 30 of 30 | `plugins.log` |
| Red team, Claude Code profile | 0 of 28 delivered; field regressions 0 of 4; the same log as 0.36.0 apart from the version | `redteam.log` |
| Red team, Codex / OpenCode | `all`: 0 of 28; `data`: the same three as 0.26.0–0.36.0 (`--check` exits 1 for these profiles in `data`); each log equal to 0.36.0's apart from the version and the folder | `redteam-codex-*.log`, `redteam-opencode-*.log` |
| Ruleset vs registry | pass before publication (0.37.0 is not on npm yet) | `ruleset.log` |
| Version references, release mode | pass | `versions-check.log` |
| Clean consumer | installs into an empty project with `--ignore-scripts`; the masking guide (five languages) and both plugins are in the package; the library example of the release notes, run verbatim: masked, restored into a local shell call (`1 true`), refused for `web/web_extract`; `warden-mcp agent-guard --mask-personal gdpr` answers `config`; the installed `warden-mcp wrap --id crm --mask-personal gdpr -- node crm-server.mjs`, driven as an MCP client: the model text holds `warden_email_…@mask.invalid` and `WARDEN_SECRET_…` with the note, neither raw value; `send_mail` with both placeholders reached the server with the real address and token; WARDEN's stderr names kinds and counts, never the token; the OpenClaw plugin copied from the installed package imports with its dependency | `clean-consumer.log` |

The first export (`a5cc4e1c9`, before the Hermes and OpenClaw sections of the guide) also passed everything except two
timeouts in `persistent-pins.test.ts` and `wrap.test.ts`, which passed alone. Its tarball was replaced by this one.

## MOMUS release gate

| | |
|---|---|
| Candidate image | `histor-histor:warden-0.37.0-prod` = `sha256:d888324c6e3a5d40722a824896d0223cc395dbb9f07cdb7bca3d3a9c001b592f` |
| Built from | `histor-histor:warden-0.36.0-prod` = `sha256:3e2b70a5…`, the image HISTOR production runs since 2026-11-21 18:00Z (checked 2026-11-22 09:49Z), with vendored WARDEN replaced by this tarball and the source of `0b57e7c4d` (`quality/Dockerfile.candidate`). Built on admin-vps; context sent with `COPYFILE_DISABLE=1 tar --no-xattrs` (no `._*` files) |
| Image check | 11,073 files in the base, 11,100 in the candidate; none different, added or removed outside the WARDEN folders; vendored 0.37.0, 84 `dist/*.js`, build digest `2f358b17…` (`quality/verify.log`) |
| Run | `skopos-warden-quality candidate sha256:d888324c…`, unit `warden-release-quality-037-prod-20261122`, started 2026-11-22 10:04:14Z, ended 10:11:56Z |
| Result | **passed**, run `20261122T100420`, policy `zero-regressions-v1`; development 8,244 attacks / 362 benign, holdout 24 / 24, candidates 21, behaviour 72 / 72 and smoke 72 / 72, 0 missed, 0 false positives, 0 incomplete; discovery complete (round 69). Baseline build `5654940a…` (0.36.0) |
| Receipt | `quality/candidate-signed.json`, evaluated 2026-11-22 10:04:20Z, expires 2026-11-24 10:04:20Z; the package's own `checkEvidence` accepts it for this build |
| `authorize` | done 2026-11-22 10:12:42Z (`skopos-warden-quality authorize sha256:d888324c…`; it prints nothing when it accepts) |

## Production HISTOR (owner «Да, переключай», 2026-11-22)

- Candidate image copied from admin-vps (`docker save | gzip | docker load` through the Mac), same ID `d888324c…`.
- `histor-wd037-switch` (`quality/after.sh` → `quality/switch.sh`, sha256 `db5c7cec…` and `6a6898ce…`, the same on the
  host) started 10:24:21Z with no open crawl: 10:25:00Z `histor-histor-1` healthy on `sha256:d888324c…`; `/`, `/health`,
  `/api/v1/stats`, `/api/v1/fingerprints?package=npm:@aimarket/warden` and `/api/v1/log/checkpoint/cosigned` answer
  200; vendored WARDEN 0.37.0; `SWITCH-OK` 10:25:27Z (`quality/after.log`). Only the image line of
  `docker-compose.warden-image.yml` changed (`.pre` copy kept in `/root/wd037-prod-20261122`).
- 10:25:50Z on admin-vps: `skopos-warden-quality live sha256:d888324c…` accepted. Public receipt
  (`quality/latest-signed-after.json`, from https://histor.modelmarket.dev/security-quality/latest.json): phase `live`,
  status `passed`, build `2f358b17…`, run `20261122T100420`. This build's own `check-quality-gate.mjs` passes
  (`quality/check-quality-after.log`).
- Rollback: HISTOR host `/root/wd037-prod-20261122/switch.sh rollback`, then admin-vps
  `skopos-warden-quality rebind sha256:3e2b70a5f17e46677afddf6c5a01142a94b040ccd072727a1513906c3913ba16`.
- `histor/scanner` in main now vendors this tarball (`vendor/warden-build.json`); the installed `package.json` has the
  same sha256 as production's (`fe05443e…`); `npm test` there passes (5).

Open alerts read before the switch (skopos-vps alerter, last 24 h): "The disk of histor-vps is filling up" (since
01:01Z; 17 GB free, 86 %; the candidate added one WARDEN layer of about 10 MB) and "The disk of pingblip is filling up".
Neither was touched.

15 minutes after the switch (10:40:27Z): `image=sha256:d888324c… health=healthy tracebacks=0`.

## npm, GitHub, MCP registry

npm: 0.37.0 published 2026-11-22 10:25:39Z (registry `time`, `latest`); the registry's tarball is byte-identical to
`aimarket-warden-0.37.0.tgz` (`cmp`, sha256 `ef9ae648…`, shasum `dcd3ac17…`). Mirror, tag, Marketplace and MCP registry:
colleague task §148.
