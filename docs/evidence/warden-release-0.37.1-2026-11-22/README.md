# WARDEN 0.37.1 — prepared 2026-11-22, live on HISTOR, not on npm yet

Built from a clean export of aicom `6f2963a4b` (`git archive … warden`; `npm ci --ignore-scripts`, `npm run build`,
then `npm pack`, whose `prepare` builds again; `dist/` was the same before and after the pack), Node and npm in
`versions.log`. Owner, 2026-11-22: «да, готовь выпуск 0.37.1».

One addition: a scan run without `--histor` ends with a line saying how many of the servers are public (an npm or
PyPI package, or a public address) and could be compared with the HISTOR log, and that nothing was sent
(`historAvailable` in `--json`). The default is unchanged: the log is asked only with `--histor`. No scan verdict
changes: rulesets are 23, the malware list, masking and the flow-guard rules are 0.37.0's. `dist/scan.js` and
`dist/scan-report.js` changed, so the MOMUS build digest is new and the release needs its own run.

## Artifact

| | |
|---|---|
| Tarball | `aimarket-warden-0.37.1.tgz` (this folder) |
| sha256 | `f413cdd216c6b8100fafd8874e72ed147b43454738be219ee2d73c9949e7d703` |
| npm shasum | `d47542b9ee61ca6afc87accc3460d025beb9517e` |
| integrity | `sha512-VKoNP5y0i/FoAYlfI8G7qa7PPoypf3dO1QcZ/7rpkbvp8DlYcn9fa0mwGIOVBNAyoUO4L73zsQ9oh5ZH8QaPYw==` |
| Files / size | 503 files, 3,876,390 bytes packed, 7,456,348 unpacked |
| MOMUS build digest | `1672b95c79bf83f9364fcf1c1e3dcc6346387d631dcf2a1e2509473b93ab3e20` (84 `dist/*.js`) |
| Ruleset | v23 `sha256-J12lNmUUNTNkzbkKeYxmAHSVgmUlrWt3+NvDp4+9i1g=` |

## Checks

| Check | Result | Log |
|---|---|---|
| Build, typecheck | pass | `build.log`, `typecheck.log`, `pack.log` |
| Tests | 2174 of 2175 in the full run (`--maxWorkers=3`, load average 30–31 from other work on the Mac): one test timed out at 5 s (`wrap.test.ts`, process start). That file again in the same export: 124 of 124 | `tests.log`, `load.log`, `tests-rerun.log` |
| Red team, Claude Code profile | 0 of 28 delivered; field regressions 0 of 4 | `redteam.log` |
| Ruleset vs registry | pass before publication (0.37.1 is not on npm yet) | `ruleset.log` |
| Version references, release mode | pass | `versions-check.log` |
| Clean consumer | installs into an empty project with `--ignore-scripts`; `warden-mcp scan --no-launch` on a config with two public packages and one local file ends with "2 of these servers are public …", on a config with one package with "1 of these servers is public …" | `clean-consumer.log` |

The first export (`7ae55e8e2`) passed 2175 of 2175 tests and the same checks; its hint read "1 of these server is"
in the singular. Its tarball was replaced by this one.

Not run for this release: the Codex and OpenCode red-team profiles, the Hermes, OpenClaw and OpenWebUI plugin checks.
The change does not touch them.

## MOMUS release gate

| | |
|---|---|
| Candidate image | `histor-histor:warden-0.37.1-prod` = `sha256:cf11d410c06ee1ef073f2d0afc1485f9d399e8f012faee4cfc40a8833c46ee63` |
| Built from | `histor-histor:faq-20261122` = `sha256:3704bf35…`, the image HISTOR production ran since 2026-11-22 14:06Z (the 0.37.0 release image plus two landing layers from other work; checked 14:54Z), with vendored WARDEN replaced by this tarball and the source of `6f2963a4b` (`quality/Dockerfile.candidate`). The production image was copied to admin-vps (`docker save | gzip | docker load` through the Mac, same ID) and the candidate built there; context sent with `COPYFILE_DISABLE=1 tar --no-xattrs` |
| Image check | 11,100 files in the base and in the candidate; none different, added or removed outside the WARDEN folders; vendored 0.37.1, 84 `dist/*.js`, build digest `1672b95c…` (`quality/verify.log`) |
| Run | `skopos-warden-quality candidate sha256:cf11d410…`, unit `warden-release-quality-0371-prod-20261122`, started 2026-11-22 14:57:02Z, ended 15:04:18Z |
| Result | **passed**, run `20261122T145708`, policy `zero-regressions-v1`; development 8,244 attacks / 362 benign, holdout 24 / 24, candidates 21, 0 missed, 0 false positives, 0 incomplete; discovery complete (round 69) |
| Receipt | `quality/candidate-signed.json`, evaluated 2026-11-22 14:57:08Z, expires 2026-11-24 14:57:08Z |
| `authorize` | done 2026-11-22 15:05:12Z (`skopos-warden-quality authorize sha256:cf11d410…`; it prints nothing when it accepts) |

## Production HISTOR (owner «Да, переключай», 2026-11-22)

- Candidate image copied from admin-vps to the HISTOR host, same ID `cf11d410…`.
- `histor-wd0371-switch` (`quality/after.sh` → `quality/switch.sh`, sha256 `da1ccef6…` and `149b8bcf…`, the same on the
  host) started 15:05:27Z with no open crawl: 15:06:05Z `histor-histor-1` healthy on `sha256:cf11d410…`; `/`, `/health`,
  `/api/v1/stats`, `/api/v1/fingerprints?package=npm:@aimarket/warden` and `/api/v1/log/checkpoint/cosigned` answer
  200; vendored WARDEN 0.37.1; `SWITCH-OK` 15:06:32Z (`quality/after.log`). Only the image line of
  `docker-compose.warden-image.yml` changed (`.pre` copy kept in `/root/wd0371-prod-20261122`).
- 15:07:22Z on admin-vps: `skopos-warden-quality live sha256:cf11d410…` accepted. This build's own
  `check-quality-gate.mjs` passes: run `20261122T145708`, build `1672b95c…` (`quality/check-quality-after.log`). Public receipt
  (`quality/latest-signed-after.json`, from https://histor.modelmarket.dev/security-quality/latest.json): phase `live`,
  status `passed`, build `1672b95c…`.
- Rollback: HISTOR host `/root/wd0371-prod-20261122/switch.sh rollback` (back to `faq-20261122`), then admin-vps
  `skopos-warden-quality rebind sha256:3704bf350d4cdcc32519ed2a78cabf27d56e0b4fc8e2a8bbf2f04bdaa32c490a`.
- `histor/scanner` in main vendors this tarball (`vendor/warden-build.json`); the installed `package.json` has the
  same sha256 as production's (`47b06fda…`); `npm test` there passes (5).

Open alerts read before the switch (skopos-vps alerter, last 3 h): none.

A later HISTOR image built for HISTOR's own code has to start from `histor-histor:warden-0.37.1-prod`, or it puts
WARDEN 0.37.0 back.

## npm, GitHub, MCP registry

Not published. npm, the GitHub mirror, the tag, the Marketplace and the MCP registry: a colleague task.
