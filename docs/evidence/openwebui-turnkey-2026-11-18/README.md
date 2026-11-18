# `warden-mcp openwebui setup` on a fresh OpenWebUI — 2026-11-18

`scripts/openwebui-turnkey-check.sh` from this checkout (gateway from `npm pack` of the same tree, so the code the
command ships with), on macOS with Docker Desktop:

- a throw-away OpenWebUI `v0.11.4-slim` (the deployed chat's release) with its MCP and OpenAPI tool servers connected
  directly, as a person sets them up, and `ENABLE_FORWARD_USER_INFO_HEADERS` off; the demo tool servers and the
  scripted model of `scripts/openwebui-live/fixtures.mjs` on the same Docker network;
- one `setup` command (admin e-mail and password), then `check`, labels for the demo tools and the guarded Python
  tool `mail` (`drive.py bootstrap`, which found the Filter and the connections already in place), the scenarios, and
  `undo`.

| Step | Result |
|---|---|
| setup | found the container and its network; 3 servers planned, 0 skipped; gateway healthy; OpenWebUI verified all 3 through the gateway; Filter installed (active, global); connections switched |
| check (inside setup and on its own) | 8 lines, 0 problems: gateway (mode audit), Filter, 3 servers reached through the gateway, injected page "would be refused (unnamed_destination)", own request allowed |
| native S1–S9, A1 | 10 / 10 |
| legacy L1–L6 | 4 / 4 |
| OpenAPI O1–O7 | 7 / 7 |
| undo | the 3 original connections back, Filter off, gateway stopped |

The first run of the day failed at setup: `npx -y /pkg/<file>.tgz` takes a tarball path for a command, so the gateway
never started; setup then stopped before changing OpenWebUI, as it should. The command is now
`npx -y --package=<spec> warden-mcp gateway`, and the script stops when setup fails. The second run passed every step.
Two small changes followed (an earlier gateway address is recognised on a re-run, so the gateway never proxies to
itself; a clearer message when `docker ps` finds no OpenWebUI), and the third run, on the code as committed, passed
every step again. `turnkey-check.log` is that third run, work paths replaced by `<work>`; it contains no token or key.
