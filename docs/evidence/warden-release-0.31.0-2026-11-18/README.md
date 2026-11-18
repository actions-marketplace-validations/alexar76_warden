# WARDEN 0.31.0 — prepared 2026-11-18, MOMUS gate passed, live on HISTOR

Built from a clean export of aicom `3fa99ee26` (`git archive … warden`; `npm ci --ignore-scripts`, `npm run build`,
then `npm pack`, whose `prepare` builds again; `dist/` was the same before and after the pack), Node 22.22.1,
npm 10.9.4. The release adds `warden-mcp openwebui setup|check|undo` (an OpenWebUI that already runs, behind the 0.30.0
gateway, in one command) and `wouldRefuse` in the gateway's `audit` answers; docs/openwebui becomes the start page in
five languages. Rulesets are unchanged (23), the malware list is 0.30.0's, no verdict changes. `dist/` gains
`openwebui-setup.js` and `gateway-decide.js` changes, so the MOMUS build digest is new and the release needs its own
run.

The first build of the day (from `d575c1136`) passed every check too; its clean-consumer run showed that an
unreachable OpenWebUI was reported as a bare "fetch failed". `3fa99ee26` names the address and the reason
(`ECONNREFUSED`, `ENOTFOUND`, a bad port…), with a test; this folder is the rebuild.

## Artifact

| | |
|---|---|
| Tarball | `aimarket-warden-0.31.0.tgz` (this folder) |
| sha256 | `4927bf1825cc6409a63aa8640b67d281d7d91c3bfa7745ec79a12602c8c59b67` |
| npm shasum | `e72055562cd9632012d74f7b88442b3fca3d6439` |
| integrity | `sha512-9Yxwyx2ndkEVOG7JKakqftbL7AjYrcuOsJZae51ES+ceVDfjKeB+XJ3rtooZ9dP2Ro+VYnuwXUqky4/ybO/8hQ==` |
| Files / size | 475 files, 3,760,663 bytes packed, 7,043,669 unpacked (0.30.0: 470 files, 3,708,725 bytes) |
| MOMUS build digest | `eac16bef321d47847fdaf24d1d160db16fc70bf8e1f666967b50dd38a939001b` (80 `dist/*.js`; the same inside the candidate image) |
| Ruleset | v23 `sha256-J12lNmUUNTNkzbkKeYxmAHSVgmUlrWt3+NvDp4+9i1g=` |
| Malware list | `sha256:b656eb8a15d8b2d0ad9d54a4f02606f9fd28a460d90dbc8d91968ffc38b80526`, 237,594 package lines (unchanged) |

## Checks

| Check | Result | Log |
|---|---|---|
| Build, typecheck | pass | `build.log`, `typecheck.log`, `pack.log` |
| Tests | 2045 of 2045 (`--maxWorkers=3`) | `tests.log` |
| Red team, Claude Code profile | 0 of 28 delivered, 2 answer-only noted; field regressions 0 of 4 | `redteam.log` |
| Red team, Codex / OpenCode | `all`: 0 of 28; `data`: 3 of 28 (`mcp-push-without-credential`, `unlabeled-invite-email`, `unlabeled-collaborator`, the same three as 0.26.0–0.30.0; `--check` exits 1 for these profiles, as before); field 0 of 4 in every profile | `redteam-*.log` |
| Ruleset vs registry | pass before publication (0.31.0 is not on npm yet) | `ruleset.log` |
| Version references, release mode | pass | `versions.log` |
| Clean consumer | the tarball installs into an empty project with `--ignore-scripts`; main, `/codex` and `/opencode` import; the OpenWebUI files are in the package; `warden-mcp openwebui --help` works; `setup` against a closed port names it (`ECONNREFUSED`); `warden-mcp gateway` in `audit` answers `wouldRefuse: unnamed_destination` for an injected page and nothing for the person's own request; `/v1/pre` without a token is 401 | `clean-consumer.log` |
| OpenWebUI, one command (`scripts/openwebui-turnkey-check.sh`, fresh OpenWebUI v0.11.4, direct connections) | setup and check 8 / 8, native 10 / 10, legacy 4 / 4, OpenAPI 7 / 7, undo; the gateway reports 0.31.0 | `openwebui-turnkey.log` |

## MOMUS release gate

| | |
|---|---|
| Candidate image | `histor-histor:warden-0.31.0-prod` = `sha256:2604a2f6a4e005fd0268ac2ac047e662e70409bb16f7f804d842ed98c73e5a76` |
| Built from | the live HISTOR image `histor-histor:warden-0.30.0-prod` = `sha256:d75d0fe1…` (the image the public receipt names, phase `live`), with the vendored WARDEN replaced by this folder's tarball and the WARDEN source of `3fa99ee26` (`quality/Dockerfile.candidate`). Built on admin-vps, where that image ID is already loaded, in `/root/wd031-prod-20261118`: the HISTOR host was not reachable from this session |
| Image check | every file outside the two WARDEN folders equals the live image (11,057 files live, 11,063 in the candidate: the new module and source files); vendored package 0.31.0, 80 `dist/*.js`, build digest `eac16bef…` (this tarball's) (`quality/verify-and-build.log`) |
| Run | `skopos-warden-quality candidate sha256:2604a2f6…` (unit `warden-release-quality-031-prod-20261118`), 2026-11-18 14:58:20–15:06:00Z, run `20261118T145827` |
| Result | **passed**, policy `zero-regressions-v1`. development 8,244 attacks / 362 benign, holdout 24 / 24, candidates 23: 0 missed, 0 false positives, 0 incomplete in each. Behaviour 72 of 72 (observer `bf8fe5b8…`). Discovery complete (round 65, 14 of 23 allowed). Baseline build `73c618fb…` (0.30.0) |
| Receipt | `quality/candidate-signed.json` (from `histor.modelmarket.dev/security-quality/candidate.json`); WARDEN's own `checkEvidence` accepts it with `scripts/quality-public-key.pem` for build `eac16bef…` |
| Expires | 2026-11-20 14:58:27Z |
| `authorize` | done 2026-11-18 15:06:28Z |

## Production HISTOR (owner's yes, 2026-11-18)

- The owner allowed ssh to the HISTOR host («I'll allow your ssh»). 15:17Z: production on `d75d0fe1…` (0.30.0),
  healthy; no crawl running (the last ended 07:04:47Z); no open alert for HISTOR.
- The candidate image went from admin-vps to the HISTOR host with `docker save | docker load` through the Mac: same
  ID `sha256:2604a2f6…`. `quality/switch.sh` and `quality/wait-and-switch.sh` (sha256 `3a46da84…`, `c728ab04…`, the
  same on the host) in `/root/wd031-prod-20261118`.
- 15:19:08Z `wait-and-switch.sh` as the transient unit `histor-warden031-switch`: no crawl, switched; 15:19:40Z
  `histor-histor-1` healthy on `sha256:2604a2f6…`. Only the image line of `docker-compose.warden-image.yml` changed.
  Rollback: `./switch.sh rollback` → `warden-0.30.0-prod`, then `skopos-warden-quality rebind sha256:d75d0fe1…` on
  admin-vps.
- After the switch: the landing page, `/api/v1/check` and `/security-quality/latest.json` answer 200, no error lines
  in the container log, the vendored WARDEN inside the container is 0.31.0.
- 15:20:08Z `skopos-warden-quality live sha256:2604a2f6…` on admin-vps. The public receipt
  (`quality/latest-signed-after.json`) is phase `live` for build `eac16bef…`, run `20261118T145827`, and this tarball's
  own `check-quality-gate.mjs` passes (`quality/check-quality-after.log`). The gate accepts the receipt for 48 h from
  the evaluation (until 2026-11-20 14:58Z) unless a later daily run renews it.
- The HISTOR scanner in main now vendors this tarball (`histor/scanner/vendor/`, `check:build` verifies
  `eac16bef…`, its tests 5 / 5), so an ordinary build from main does not roll production back to 0.30.0.

Publication: the live receipt for this build is in place, so the owner can publish this tarball (colleague-tasks §133 step 2).

## Publication

- ~16:20Z checked over public HTTPS (no GitHub API): mirror `alexar76/warden` at 0.31.0 with `docs/openwebui.md` and
  `src/openwebui-setup.ts`, the `v0.31.0` release page, Marketplace and the profile README on 0.31.0, but npm still
  `latest` = 0.30.0 and the MCP registry entry 0.30.0, so the public `@aimarket/warden@0.31.0` commands answered 404.
  The owner's first `npm publish` of this tarball stopped at `ENEEDAUTH` (no npm login on that machine) after npm had
  printed shasum `e7205556…`; nothing was uploaded.
- 2026-11-18 16:39:39Z (npm time) the owner published this tarball after checking its sha256 (`4927bf18…`). The
  registry reports dist.shasum `e72055562cd9632012d74f7b88442b3fca3d6439`, integrity
  `sha512-9Yxwyx2ndkEVOG7JKakqftbL7AjYrcuOsJZae51ES+ceVDfjKeB+XJ3rtooZ9dP2Ro+VYnuwXUqky4/ybO/8hQ==`, `latest` = 0.31.0.
- ~16:40Z the registry tarball downloads (200, 3,760,663 bytes) and is byte for byte this folder's (`cmp`).
- GitHub Action pins in the READMEs and scan guides (5 languages) moved to `v0.31.0`; `check-doc-versions --release`
  passes. okx-a2mcp moved to 0.31.0 (registry URL + the integrity above): `npm ci` from the registry accepts the
  integrity, 87 / 87 tests.
- 16:44:54Z okx-a2mcp production (modelmarket.dev/a2mcp, /tools) on WARDEN 0.31.0: `okx-a2mcp/deploy.sh` from main
  `59848cbff`, image `okx-a2mcp:prod-20261118-59848cbff` built on the host from npm, 0 restarts, no error lines; no open
  alerts before the deploy. `/health` reports warden 0.31.0; the installed `dist/openwebui-setup.js` has the same
  sha256 as this tarball's. The public `warden-scan` blocks a description with "Ignore previous instructions" and
  allows the clean tool, engine `@aimarket/warden@0.31.0`, ruleset 23. Rollback: the stopped `okx-a2mcp-prev`
  (`prod-20261118-58933ccac`, WARDEN 0.30.0).
- Left: MCP registry 0.31.0 (colleague-tasks §133 step 5, after npm); the pin change reaches the mirror with its next
  sync.

