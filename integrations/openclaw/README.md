# WARDEN for OpenClaw

Credentials (and, when you turn it on, personal data) are masked in what OpenClaw writes to its transcript, restored
only for allowed tools, and the WARDEN flow guard checks every tool call. Tested with OpenClaw 2026.11.6. How it works
and its limits: [docs/masking.md](../../docs/masking.md).

**Limit.** Within one agent run the model reads a tool's raw result: OpenClaw has no hook that rewrites a result before
the model sees it (`tool_result_persist` rewrites what is stored and replayed later). For in-run protection, put MCP
servers behind `warden-mcp wrap`; the flow guard still refuses a call that would send a recognised secret out.

## Install

```bash
npm install -g @aimarket/warden@0.38.1
cp -r "$(npm root -g)/@aimarket/warden/integrations/openclaw/warden" ~/openclaw-warden
cd ~/openclaw-warden && npm install --omit=dev          # pulls @aimarket/warden 0.37.0 or later
sudo chown -R root:root .                                # OpenClaw refuses plugin files not owned by root
openclaw plugins install --link "$PWD" --force --accept-capabilities
openclaw plugins enable warden
```

Plugin config (`plugins.entries.warden.config` in `openclaw.json`): `personal` (`gdpr`, `us`, `ru-152fz`, `pci`,
`custom`, `off`), `maskConfig` (path of a WARDEN mask file), `flowGuard` (default `true`). The `WARDEN_MASK*`
environment works too.

## Seams used

`before_tool_call` (placeholders become values; flow guard: `block` or OpenClaw's approval), `after_tool_call` (the flow
guard records the raw result), `tool_result_persist` and `before_message_write` (stored and replayed messages masked),
`message_sending` (the reply shows personal data again).

Tests: `integrations/openclaw/run-tests.sh` after `npm run build`.
