# WARDEN for Hermes Agent

Credentials (and, when you turn it on, personal data) never reach the model; the WARDEN flow guard checks every tool
call. Hermes 0.19 or later. How it works and its limits: [docs/masking.md](../../docs/masking.md).

## Install

```bash
npm install -g @aimarket/warden@0.38.0                       # provides warden-mcp (agent-guard)
cp -r "$(npm root -g)/@aimarket/warden/integrations/hermes/warden" ~/.hermes/plugins/warden
hermes plugins enable warden
```

Restart the Hermes gateway (`systemctl restart hermes-gateway`, or start `hermes` again). The plugin starts one
`warden-mcp agent-guard` child; `WARDEN_AGENT_GUARD_CMD` overrides the command (for example
`/usr/bin/node /opt/warden/dist/mcp-server.js agent-guard`). Put settings in `~/.hermes/.env`:

| Variable | Effect |
|---|---|
| `WARDEN_MASK_PERSONAL=gdpr` | Mask personal data too (`gdpr`, `us`, `ru-152fz`, `pci`, `custom`) |
| `WARDEN_MASK=/path/mask.json` | The whole masking policy as a file |
| `WARDEN_HERMES_FLOW=off` | Turn the flow guard off (masking stays on) |
| `WARDEN_STATE_DIR=/root/.hermes/warden-state` | Where the flow guard keeps session state |

Hermes' own `security.redact_secrets` (on by default) cuts known token formats one way inside its tools. Keep it if the
agent never needs to use a secret; set it to `false` to let WARDEN mask reversibly, so the agent can still pass a
placeholder to the tool that needs the value.

## Seams used

`llm_request` (every provider request masked), `tool_execution` (placeholders become values when the tool runs),
`transform_tool_result` (results masked before the session store), `pre_tool_call` / `post_tool_call` (flow guard;
`ask` becomes Hermes' own approval prompt), `transform_llm_output` (the person sees personal data again).

Tests: `python3 -m unittest discover -s integrations/hermes/tests` after `npm run build`.
