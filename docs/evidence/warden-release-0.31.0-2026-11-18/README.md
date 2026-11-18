# WARDEN 0.31.0 — prepared 2026-11-18

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

## Production HISTOR (owner's step)

Not switched yet. The candidate image is on admin-vps; production HISTOR still runs `d75d0fe1…` (0.30.0). The switch
needs the owner's yes and the HISTOR host, which this session could not reach. `quality/switch.sh` and
`quality/wait-and-switch.sh` are the 0.30.0 scripts with the images moved one release on (forward: 0.30.0 → 0.31.0
only when no crawl runs; rollback: `./switch.sh rollback`, then `skopos-warden-quality rebind sha256:d75d0fe1…` on
admin-vps). Steps: `docs/distribution/colleague-tasks.md` §133. After the switch: `skopos-warden-quality live
sha256:2604a2f6…` on admin-vps, then this tarball's `check-quality-gate.mjs` must pass before `npm publish`.

Publication needs the live receipt for this build: `prepublishOnly` runs `check:quality`, which accepts only a passing,
fresh receipt whose build digest is this tarball's, and that receipt becomes `live` only after HISTOR production runs
the candidate image (`skopos-warden-quality live`). Until then npm keeps 0.30.0 as `latest`.

