# WARDEN 0.27.0: MOMUS candidate — passed, production not switched yet

2026-11-14. Release archive `../aimarket-warden-0.27.0.tgz` from `f1a0e2d8a` (SHA-256 `7a5992aa…`, MOMUS build digest
`40483094096f6f09e2430e22ad23868201ca29ad7ee6604b083b705aae3fb79c`).

## Candidate

- Production at build time: histor-host, `/opt/histor`, `histor-histor:rfc8785-20261114` = `sha256:18df4412…`, WARDEN 0.26.1.
- `Dockerfile.candidate` builds FROM that image and replaces only `/app/scanner/node_modules/@aimarket/warden` (the archive)
  and `/opt/warden-source/src` (`git archive f1a0e2d8a warden/src`), label `skopos.source.commit=f1a0e2d8a…`.
- Image `histor-histor:warden-0.27.0-prod` = `sha256:0a2f06e449251fa584d8bd1ea8285267e79fc199a912404c304e10366a697dae`, built on
  histor-host, `docker save | gzip | docker load` to admin-vps; same ID.
- `verify.log` (`verify_candidate.py`): 10,979 production files against 10,994; outside the two WARDEN folders nothing is
  missing, added or different; WARDEN 0.27.0, 71 dist files, build digest `40483094…`; HISTOR's scanner imports it (ruleset 20).

## MOMUS

- The live daily receipt was `failed` (run `20261114T033000`): the sandbox observer had been patched on 2026-11-13 and MOMUS
  still pinned the old hash, so 3 of 3 live sandbox cases were incomplete. Pin updated to `f5f4fcf3…`; run
  `20261114T193457` passed (72 of 72). `latest-signed-before.json` is that passing receipt for the old build `08b21736…`.
- Candidate run `20261114T194635`, unit `warden-release-quality-0270-prod-20261114`, 19:46:30–about 19:49Z, exit 0;
  `candidate-signed.json`: status passed, full; development 8,244 attacks and 362 benign, holdout 24 and 24, all with
  0 missed, 0 false positives, 0 incomplete; 15 discovery candidates (0 inconclusive); behaviour 72 of 72; smoke passed.
  Expires 2026-11-16 19:46Z.
- `skopos-warden-quality authorize sha256:0a2f06e4…` accepts the image.

## Left

`switch.sh` on histor-host after the crawl (owner's yes), then `skopos-warden-quality live sha256:0a2f06e4…`, then
`npm run check:quality`, then npm publish (colleague-tasks §113).
