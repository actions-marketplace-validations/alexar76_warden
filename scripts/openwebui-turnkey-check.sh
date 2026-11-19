#!/usr/bin/env bash
# Live check of `warden-mcp openwebui setup` as a stranger would meet it: a plain OpenWebUI that already talks to its
# tool servers directly, no WARDEN anywhere. Then one setup command, check, the attack scenarios, undo.
#
#   scripts/openwebui-turnkey-check.sh [--keep] [--tag v0.11.4-slim]
#
# Throw-away stack (project warden-turnkey, OpenWebUI on 127.0.0.1:18090, one Docker network): OpenWebUI + the demo
# tool servers and scripted model of scripts/openwebui-live/fixtures.mjs, with OpenWebUI's MCP and OpenAPI
# connections pointing straight at them and ENABLE_FORWARD_USER_INFO_HEADERS left off. The gateway runs from
# `npm pack` of this checkout. Steps:
#   1. setup (finds the container and its network, starts the gateway, verifies, installs the Filter, switches over)
#   2. check (exit 0 expected)
#   3. labels for the demo tools, as a person would add them after `gateway labels`; drive.py bootstrap adds only
#      the guarded Python tool `mail` (Filter and connections are already there)
#   4. drive.py native, legacy, openapi — every scenario must end as expected
#   5. undo: connections direct again, Filter off, gateway stopped
set -euo pipefail
cd "$(dirname "$0")/.."
KEEP=0; TAG=v0.11.4-slim
while [[ $# -gt 0 ]]; do case "$1" in --keep) KEEP=1; shift ;; --tag) TAG="$2"; shift 2 ;; *) echo "unknown argument $1" >&2; exit 2 ;; esac; done
WORK="$(mktemp -d "${TMPDIR:-/tmp}/warden-turnkey.XXXXXX")"; chmod 700 "$WORK"
STACK="$WORK/stack"; DIR="$WORK/warden-openwebui"; mkdir -p "$STACK/fixtures"
OWUI=http://127.0.0.1:18090; FX=http://127.0.0.1:19105
cleanup() {
  [[ $KEEP == 1 ]] && { echo "kept: $WORK"; return; }
  docker compose -p warden-turnkey-gw --project-directory "$DIR" -f "$DIR/docker-compose.yml" down -v >/dev/null 2>&1 || true
  docker compose -p warden-turnkey --project-directory "$STACK" -f "$STACK/docker-compose.yml" down -v >/dev/null 2>&1 || true
}
trap cleanup EXIT

npm run build >/dev/null
TGZ="$(npm pack --pack-destination "$WORK" --silent 2>/dev/null | tail -1)"
cp scripts/openwebui-live/fixtures.mjs scripts/openwebui-live/mail_tool.py "$STACK/fixtures/"
cat > "$STACK/docker-compose.yml" <<YAML
name: warden-turnkey
networks: { owui: {} }
services:
  fixtures:
    image: node:22-bookworm-slim
    command: ["node", "/fx/fixtures.mjs"]
    volumes: ["./fixtures:/fx:ro"]
    networks: { owui: { aliases: [fakes] } }
    ports: ["127.0.0.1:19105:9104"]
  open-webui:
    image: ghcr.io/open-webui/open-webui:${TAG}
    networks: [owui]
    ports: ["127.0.0.1:18090:8080"]
    environment:
      WEBUI_SECRET_KEY: "$(openssl rand -hex 32)"
      ENABLE_OLLAMA_API: "false"
      OPENAI_API_BASE_URLS: "http://fakes:9100/v1"
      OPENAI_API_KEYS: "scripted"
      TOOL_SERVER_CONNECTIONS: >-
        [{"type":"mcp","url":"http://fixtures:9101/mcp","path":"","auth_type":"none","key":"","config":{"enable":true},"info":{"id":"chat","name":"chat"}},
         {"type":"mcp","url":"http://fixtures:9101/mcp-web","path":"","auth_type":"none","key":"","config":{"enable":true},"info":{"id":"web","name":"web"}},
         {"type":"openapi","url":"http://fixtures:9103","path":"openapi.json","auth_type":"none","key":"","config":{"enable":true},"info":{"id":"notes","name":"notes"}}]
      ENABLE_WEB_SEARCH: "true"
      WEB_SEARCH_ENGINE: external
      EXTERNAL_WEB_SEARCH_URL: http://fakes:9102/search
      BYPASS_WEB_SEARCH_WEB_LOADER: "true"
      BYPASS_EMBEDDING_AND_RETRIEVAL: "true"
      RAG_EMBEDDING_MODEL_AUTO_UPDATE: "false"
      OFFLINE_MODE: "true"
YAML
docker compose -p warden-turnkey --project-directory "$STACK" -f "$STACK/docker-compose.yml" up -d >/dev/null
echo "waiting for OpenWebUI ($TAG) on $OWUI …"
for _ in $(seq 1 150); do curl -fsS "$OWUI/health" >/dev/null 2>&1 && break; sleep 2; done
curl -fsS "$OWUI/health" >/dev/null

# The first account becomes the admin, as on any new OpenWebUI.
python3 - "$WORK/admin.json" "$OWUI" <<'PY'
import json, os, secrets, sys, urllib.request
path, owui = sys.argv[1], sys.argv[2]
cred = {"email": f"admin-{secrets.token_hex(3)}@example.test", "password": secrets.token_urlsafe(18)}
req = urllib.request.Request(f"{owui}/api/v1/auths/signup", data=json.dumps({"name": "Admin", **cred}).encode(), headers={"content-type": "application/json"})
urllib.request.urlopen(req, timeout=60).read()
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f: json.dump(cred, f)
PY
EMAIL="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['email'])" "$WORK/admin.json")"
export OPENWEBUI_PASSWORD="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['password'])" "$WORK/admin.json")"

status=0
echo; echo "== 1. setup"
node dist/mcp-server.js openwebui setup --url "$OWUI" --email "$EMAIL" --container warden-turnkey-open-webui-1 \
  --dir "$DIR" --package "$WORK/$TGZ" --project warden-turnkey-gw --port 18788 || { echo "turnkey check: setup FAILED"; exit 1; }
echo; echo "== 2. check"
node dist/mcp-server.js openwebui check --dir "$DIR" --email "$EMAIL" || status=1

echo; echo "== 3. labels for the demo tools + the guarded Python tool"
python3 - "$DIR/state/flow-policy.json" <<'PY'
import json, os, sys
path = sys.argv[1]; p = json.load(open(path))
p["labels"].update({"mcp__chat__send_message": ["outbound"], "mcp__chat__delete_records": ["destructive"], "mcp__chat__read_api_key": ["private"],
  "mcp__chat__lookup": [], "mcp__web__fetch_page": ["untrusted"], "mcp__mail__send_email": ["outbound"], "mcp__mail__read_newsletter": ["untrusted"],
  "mcp__notes__send_note": ["outbound"], "mcp__notes__delete_notes": ["destructive"], "mcp__notes__read_secret": ["private"], "mcp__notes__get_weather": []})
tmp = path + ".tmp"; json.dump(p, open(tmp, "w"), indent=1); os.replace(tmp, path)
PY
python3 scripts/openwebui-live/drive.py bootstrap --owui "$OWUI" --state "$DIR/state" --env "$DIR/.env" --admin "$WORK/admin.json" \
  --fixtures "$FX" --models "" >/dev/null

echo; echo "== 4. scenarios"
for suite in native legacy openapi; do
  python3 scripts/openwebui-live/drive.py "$suite" --owui "$OWUI" --state "$DIR/state" --env "$DIR/.env" --admin "$WORK/admin.json" \
    --fixtures "$FX" --report "$WORK/report-$suite.json" | grep -E '^(PASS|FAIL)' || status=1
  python3 -c "import json,sys;r=json.load(open(sys.argv[1]));print(f\"{r['suite']}: {r['passed']}/{r['total']}\");sys.exit(0 if r['passed']==r['total'] else 1)" "$WORK/report-$suite.json" || status=1
done

echo; echo "== 5. undo"
node dist/mcp-server.js openwebui undo --dir "$DIR" --email "$EMAIL" || status=1
python3 - "$OWUI" "$WORK/admin.json" <<'PY' || status=1
import json, sys, urllib.request
owui, cred = sys.argv[1], json.load(open(sys.argv[2]))
def call(method, path, body=None, token=None):
    req = urllib.request.Request(owui + path, data=json.dumps(body).encode() if body is not None else None, method=method,
                                 headers={"content-type": "application/json", **({"authorization": f"Bearer {token}"} if token else {})})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())
t = call("POST", "/api/v1/auths/signin", cred)["token"]
urls = [c["url"] for c in call("GET", "/api/v1/configs/tool_servers", token=t)["TOOL_SERVER_CONNECTIONS"]]
f = call("GET", "/api/v1/functions/id/warden_filter", token=t)
ok = urls == ["http://fixtures:9101/mcp", "http://fixtures:9101/mcp-web", "http://fixtures:9103"] and not f["is_active"] and not f["is_global"]
print(("PASS" if ok else "FAIL") + f"  undo: connections {urls}; Filter active={f['is_active']} global={f['is_global']}")
sys.exit(0 if ok else 1)
PY
echo; [[ $status == 0 ]] && echo "turnkey check: all passed" || echo "turnkey check: FAILED"
exit $status
