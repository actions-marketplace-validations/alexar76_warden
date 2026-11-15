# WARDEN 0.27.0 (rebuilt): MOMUS candidate passed, production on the evaluated image, live

2026-11-15. Release archive `../aimarket-warden-0.27.0.tgz` from `80a0d4068` (SHA-256 `525622b7…`, MOMUS build digest
`403842d70620a8dd805ae4b4386613dc4b5804608b801ef75d674248a16c9772`). It supersedes the first 0.27.0 build
(`../quality-superseded-0a2f06e4/`) after the reporter's follow-up on warden#14.

## Candidate

- Production at build time: histor-host, `/opt/histor`, `histor-histor:rfc8785-20261114` = `sha256:18df4412…`, WARDEN 0.26.1.
- `Dockerfile.candidate` builds FROM that image and replaces only `/app/scanner/node_modules/@aimarket/warden` (the archive)
  and `/opt/warden-source/src` (`git archive 80a0d4068 warden/src`), label `skopos.source.commit=80a0d4068…`.
- Image `histor-histor:warden-0.27.0b-prod` = `sha256:8dcade5371f42e4c16b5bcf5b04a083e15505b7b4a6aca8b53b454bbf1a83dee`, built on
  histor-host, `docker save | gzip | docker load` to admin-vps; same ID.
- `verify.log`: outside the two WARDEN folders nothing is missing, added or different; WARDEN 0.27.0, 71 dist files,
  build digest `403842d7…`; HISTOR's scanner imports it (ruleset 20).

## MOMUS

- Runs `20261115T055357` and `20261115T060726` failed on transport alone (`failed-runs-transport.log`): 48 and then 8
  development cases incomplete with `read ECONNRESET`, `ETIMEDOUT`, `socket hang up` and `aborted`; 0 missed, 0 false
  positives; holdout, behaviour and discovery passed. The measurement had no retry, and one dropped connection marked a
  batch of eight cases incomplete.
- Fix: `momus/momus/engine/coverage_semantic.mjs` asks a batch again on transport failure, up to three attempts (main
  `a238e9f49`, sha256 `81b6257d…`). The owner deployed it to admin-vps at 06:26Z; the original is kept as
  `coverage_semantic.mjs.pre-retry-20261115` (`371fd5b7…`).
- Run `20261115T062632` (unit `warden-release-quality-0270b3-prod-20261115`, 06:26:30–06:33:55Z) **passed**
  (`candidate-signed.json`): development 8,244 attacks and 362 benign, holdout 24 and 24, all with 0 missed, 0 false
  positives, 0 incomplete; behaviour 72 of 72; discovery complete. No retry was needed in that run.
- `skopos-warden-quality authorize sha256:8dcade53…` accepted the image.

## Production

- The 2026-11-14 crawl finished at 2026-11-15 05:47:35Z (8,000 observations, 337 changes); none was running at switch time.
- `switch.sh` on histor-host (`switch.log`): only the image line of `docker-compose.warden-image.yml` changed;
  `histor-histor-1` healthy on `sha256:8dcade53…`. Rollback in the script header.
- `skopos-warden-quality live sha256:8dcade53…` → LIVE_OK. Public receipt (`latest-signed-after.json`): run
  `20261115T062632`, status passed, phase live, build `403842d7…`, source `80a0d4068`, expires 2026-11-17 06:07Z
  (the daily run keeps it fresh from 2026-11-16 03:26Z).
- `check-quality-after.log`: `MOMUS release gate passed: 20261115T062632, 403842d7…`.

## Left

npm publish by the colleague (colleague-tasks §113), then the reply on warden#14.
