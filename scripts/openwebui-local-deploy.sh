#!/usr/bin/env bash
# Deploy OpenWebUI behind the WARDEN gateway as a local Docker stack (examples/openwebui/docker-compose.yml).
#
#   scripts/openwebui-local-deploy.sh [--dir DIR] [--port 3000] [--fixtures-port 19101] [--tag v0.11.4-slim]
#                                     [--project warden-openwebui] [--openrouter-key-file FILE] [--models a,b]
#
# DIR (default ~/warden-openwebui-local) gets the gateway build, the demo tool servers, state/ (gateway.json,
# flow-policy.json in "audit", chat state) and .env with fresh tokens (kept on later runs). Then `docker compose up`
# and drive.py bootstrap: first admin (credentials in DIR/admin.json, mode 600), WARDEN Filter, the guarded `mail`
# tool, the OpenRouter model allow-list. Running it again updates the gateway and the adapter in place.
set -euo pipefail
cd "$(dirname "$0")/.."
DIR="${WARDEN_OWUI_DIR:-$HOME/warden-openwebui-local}"; PORT=3000; FXPORT=19101; TAG=v0.11.4-slim
PROJECT=warden-openwebui; KEYFILE=""; MODELS="qwen/qwen3.8-27b,minimax/minimax-m3"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;; --port) PORT="$2"; shift 2 ;; --fixtures-port) FXPORT="$2"; shift 2 ;;
    --tag) TAG="$2"; shift 2 ;; --project) PROJECT="$2"; shift 2 ;; --openrouter-key-file) KEYFILE="$2"; shift 2 ;;
    --models) MODELS="$2"; shift 2 ;; *) echo "unknown argument $1" >&2; exit 2 ;;
  esac
done
[[ -f dist/mcp-server.js ]] || npm run build >/dev/null
mkdir -p "$DIR"/warden/integrations "$DIR"/fixtures "$DIR"/state; chmod 700 "$DIR"
rsync -a --delete dist "$DIR/warden/"; cp package.json "$DIR/warden/"
rsync -a --delete integrations/openwebui "$DIR/warden/integrations/"
cp scripts/openwebui-live/fixtures.mjs scripts/openwebui-live/mail_tool.py "$DIR/fixtures/"
cp examples/openwebui/docker-compose.yml "$DIR/docker-compose.yml"

set_env() {  # set_env NAME VALUE — replace or append one line of DIR/.env without printing it
  local f="$DIR/.env"; touch "$f"; chmod 600 "$f"
  grep -v "^$1=" "$f" > "$f.tmp" || true; printf '%s=%s\n' "$1" "$2" >> "$f.tmp"; mv "$f.tmp" "$f"; chmod 600 "$f"
}
grep -q '^WARDEN_GATEWAY_TOKEN=' "$DIR/.env" 2>/dev/null || set_env WARDEN_GATEWAY_TOKEN "$(openssl rand -hex 24)"
grep -q '^WARDEN_APPROVE_TOKEN=' "$DIR/.env" 2>/dev/null || set_env WARDEN_APPROVE_TOKEN "$(openssl rand -hex 24)"
grep -q '^WEBUI_SECRET_KEY=' "$DIR/.env" 2>/dev/null || set_env WEBUI_SECRET_KEY "$(openssl rand -hex 32)"
if [[ -n "$KEYFILE" ]]; then set_env OPENROUTER_API_KEY "$(sed -n 's/^OPENROUTER_API_KEY=//p' "$KEYFILE" | head -1 | tr -d '"'"'"' ')"; fi
grep -q '^OPENROUTER_API_KEY=' "$DIR/.env" || set_env OPENROUTER_API_KEY unset
set_env OWUI_PORT "$PORT"; set_env OWUI_TAG "$TAG"; set_env FIXTURES_PORT "$FXPORT"

[[ -f "$DIR/state/gateway.json" ]] || cat > "$DIR/state/gateway.json" <<JSON
{ "listen": { "host": "0.0.0.0", "port": 8787 }, "approveTokenEnv": "WARDEN_APPROVE_TOKEN", "stateDir": "/state", "servers": [] }
JSON
[[ -f "$DIR/state/flow-policy.json" ]] || echo '{ "mode": "audit", "labels": {} }' > "$DIR/state/flow-policy.json"
# The demo servers and their labels are added if missing; anything else in the files is left as it is.
python3 - "$DIR/state" <<'PY'
import json, os, sys
state = sys.argv[1]
g = json.load(open(os.path.join(state, "gateway.json")))
for srv in ({"name": "chat", "type": "mcp-http", "url": "http://fixtures:9101/mcp"}, {"name": "web", "type": "mcp-http", "url": "http://fixtures:9101/mcp-web"},
            {"name": "notes", "type": "openapi", "url": "http://fixtures:9103/"}):
    if not any(s.get("name") == srv["name"] for s in g["servers"]):
        g["servers"].append(srv)
json.dump(g, open(os.path.join(state, "gateway.json"), "w"), indent=1)
p = json.load(open(os.path.join(state, "flow-policy.json")))
labels = {"mcp__chat__send_message": ["outbound"], "mcp__chat__delete_records": ["destructive"], "mcp__chat__read_api_key": ["private"],
          "mcp__chat__lookup": [], "mcp__web__fetch_page": ["untrusted"], "mcp__mail__send_email": ["outbound"], "mcp__mail__read_newsletter": ["untrusted"],
          "mcp__notes__send_note": ["outbound"], "mcp__notes__delete_notes": ["destructive"], "mcp__notes__read_secret": ["private"],
          "mcp__notes__get_weather": [],
          # OpenWebUI's built-in tools, as the Filter's guard_builtin_tools names them (search_web/fetch_url are WebSearch/WebFetch).
          "mcp__owui__write_note": ["destructive"], "mcp__owui__replace_note_content": ["destructive"],
          "mcp__owui__view_note": ["private"], "mcp__owui__search_notes": ["private"],
          "mcp__owui__add_memory": ["destructive"], "mcp__owui__update_memory": ["destructive"],
          "mcp__owui__replace_memory_content": ["destructive"], "mcp__owui__delete_memory": ["destructive"],
          "mcp__owui__execute_code": ["outbound", "destructive"], "mcp__owui__notify": ["outbound"],
          "mcp__owui__create_calendar_event": ["destructive"], "mcp__owui__update_calendar_event": ["destructive"],
          "mcp__owui__delete_calendar_event": ["destructive"], "mcp__owui__search_calendar_events": ["private"],
          "mcp__owui__get_current_timestamp": [], "mcp__owui__calculate_timestamp": [], "mcp__owui__ask_user": []}
p["labels"] = {**labels, **p.get("labels", {})}
json.dump(p, open(os.path.join(state, "flow-policy.json"), "w"), indent=1)
PY

docker compose -p "$PROJECT" --project-directory "$DIR" -f "$DIR/docker-compose.yml" up -d --force-recreate warden-gateway fixtures >/dev/null
docker compose -p "$PROJECT" --project-directory "$DIR" -f "$DIR/docker-compose.yml" up -d >/dev/null
echo "waiting for OpenWebUI ($TAG) on 127.0.0.1:$PORT …"
for _ in $(seq 1 150); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 2; done
curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null
python3 scripts/openwebui-live/drive.py bootstrap --owui "http://127.0.0.1:$PORT" --state "$DIR/state" --env "$DIR/.env" \
  --admin "$DIR/admin.json" --fixtures "http://127.0.0.1:$FXPORT" --models "$MODELS"
echo "OpenWebUI: http://localhost:$PORT  (admin credentials: $DIR/admin.json)  gateway state: $DIR/state  mode: $(python3 -c "import json;print(json.load(open('$DIR/state/flow-policy.json'))['mode'])")"
