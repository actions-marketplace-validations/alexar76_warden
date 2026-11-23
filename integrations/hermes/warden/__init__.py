"""WARDEN for Hermes Agent: credentials (and, when turned on, personal data) never reach the model; the flow guard
checks every tool call.

Install: copy this folder to ~/.hermes/plugins/warden/, then `hermes plugins enable warden` (see README.md).

What it does, through Hermes' plugin API (Hermes 0.19 or later):

- llm_request middleware: every request to the model provider goes out with credentials replaced by placeholders
  (WARDEN_SECRET_7Q2M9XD4RK), and personal data too when WARDEN_MASK_PERSONAL names a profile (gdpr, us, ru-152fz,
  pci). That covers the person's messages, tool results, the system prompt, memory and skills: everything the
  provider sees.
- transform_tool_result: tool results (shell output included) are masked before they enter the conversation, so the
  session store and logs hold placeholders too. post_tool_call has recorded the raw result for the flow guard first,
  so it still recognises a key the model never saw if a call tries to send it out.
- tool_execution middleware: when the model passes a placeholder in a tool's arguments, the tool runs with the real
  value, for the destinations the policy allows: by default the kind of place the value came from (this machine's
  files and shell, the web, one MCP server). Anywhere else the call is refused. Approval prompts and guardrails see
  the placeholder, not the value.
- pre_tool_call / post_tool_call: the WARDEN flow guard, as in the Claude Code plugin. A send or a destructive call
  after the model read someone else's text is refused or goes to Hermes' own approval prompt.
- transform_llm_output: the person reads the answer with personal data back in place of its placeholders.
  Credentials stay masked: a chat transcript is copied and forwarded.

The placeholder table lives in one `warden-mcp agent-guard` child process, in memory only. If the child cannot be
started or stops answering, tool results are withheld and calls with placeholders are refused (fail-closed).
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import shlex
import shutil
import subprocess
import threading
from typing import Any, Dict, Optional

logger = logging.getLogger("hermes.plugins.warden")

# Toolsets whose tools work on this machine: a value read by one may be used by another (a key read from .env, used
# in a shell command). The web and each MCP server are their own places.
LOCAL_TOOLSETS = {"file", "terminal", "code_execution", "memory", "skills", "todo", "session_search", "process",
                  "cronjob", "kanban", "delegation", "clarify", "computer_use"}
WEB_TOOLSETS = {"web", "browser", "browser-cdp", "x_search"}


class GuardUnavailable(Exception):
    """The agent-guard child could not be started or stopped answering."""


class Refused(Exception):
    """The masking policy keeps a value from this destination (agent-guard error -32001)."""


class AgentGuard:
    """One `warden-mcp agent-guard` child, shared by every session of this Hermes process."""

    def __init__(self, command: Optional[list] = None, timeout: float = 10.0):
        self.command = command or default_command()
        self.timeout = timeout
        self.proc: Optional[subprocess.Popen] = None
        self.lock = threading.Lock()
        self.seq = 0

    def _start(self) -> None:
        env = {k: v for k, v in os.environ.items()}
        try:
            self.proc = subprocess.Popen(self.command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                         stderr=subprocess.DEVNULL, text=True, bufsize=1, env=env)
        except OSError as e:
            self.proc = None
            raise GuardUnavailable(f"cannot start {' '.join(self.command)}: {e}") from None

    def call(self, method: str, params: Dict[str, Any]) -> Any:
        debug = os.environ.get("WARDEN_HERMES_DEBUG")
        if debug:  # method, session, origin and tool only: never the values
            with open(debug, "a") as f:
                f.write(json.dumps({k: params.get(k) for k in ("session", "origin", "server", "tool", "tool_name")} | {"method": method}) + "\n")
        with self.lock:
            for attempt in (1, 2):
                if self.proc is None or self.proc.poll() is not None:
                    self._start()
                self.seq += 1
                request_id = self.seq
                try:
                    self.proc.stdin.write(json.dumps({"id": request_id, "method": method, "params": params}, default=str) + "\n")
                    self.proc.stdin.flush()
                    line = _readline(self.proc, self.timeout)
                except (OSError, ValueError, TimeoutError) as e:
                    self._stop()
                    if attempt == 2:
                        raise GuardUnavailable(f"agent-guard did not answer: {e}") from None
                    continue
                answer = json.loads(line)
                if answer.get("id") != request_id:
                    self._stop()
                    raise GuardUnavailable("agent-guard answered out of order")
                if "error" in answer:
                    err = answer["error"] or {}
                    if err.get("code") == -32001:
                        raise Refused(str(err.get("message")))
                    raise GuardUnavailable(str(err.get("message")))
                return answer.get("result")
        raise GuardUnavailable("unreachable")

    def _stop(self) -> None:
        if self.proc is not None:
            try:
                self.proc.kill()
                self.proc.wait(timeout=3)
            except Exception:
                pass
            for stream in (self.proc.stdin, self.proc.stdout):
                try:
                    stream.close()
                except Exception:
                    pass
        self.proc = None

    def close(self) -> None:
        with self.lock:
            if self.proc is not None and self.proc.stdin:
                try:
                    self.proc.stdin.close()
                    self.proc.wait(timeout=3)
                    self.proc.stdout.close()
                except Exception:
                    self._stop()
            self.proc = None


def _readline(proc: subprocess.Popen, timeout: float) -> str:
    result: Dict[str, str] = {}

    def read() -> None:
        result["line"] = proc.stdout.readline()

    t = threading.Thread(target=read, daemon=True)
    t.start()
    t.join(timeout)
    if t.is_alive():
        raise TimeoutError(f"no answer within {timeout} s")
    line = result.get("line", "")
    if not line:
        raise OSError("agent-guard closed its output")
    return line


def default_command() -> list:
    """WARDEN_AGENT_GUARD_CMD, else `warden-mcp agent-guard` from PATH, else the pinned npm package through npx."""
    configured = os.environ.get("WARDEN_AGENT_GUARD_CMD", "").strip()
    if configured:
        return shlex.split(configured)
    if shutil.which("warden-mcp"):
        return ["warden-mcp", "agent-guard"]
    return ["npx", "-y", "--package=@aimarket/warden@0.38.0", "warden-mcp", "agent-guard"]


def origin_of(tool_name: str) -> str:
    """The place a tool reads from and writes to, for the masking policy's `origin` rule."""
    toolset = ""
    try:
        from tools.registry import registry  # Hermes' own registry
        toolset = registry.get_toolset_for_tool(tool_name) or ""
    except Exception:
        toolset = ""
    if toolset.startswith("mcp-"):
        return "mcp:" + toolset[4:]
    if toolset in LOCAL_TOOLSETS or tool_name in ("terminal", "read_file", "write_file", "patch", "search_files", "execute_code", "process", "memory"):
        return "local"
    if toolset in WEB_TOOLSETS or tool_name.startswith(("web_", "browser_")):
        return "web"
    return toolset or tool_name


def flow_call(tool_name: str, args: Dict[str, Any]) -> tuple:
    """Hermes' tool names and arguments in the form the flow guard knows (the Claude Code tool set)."""
    a = args or {}
    if tool_name == "terminal":
        return "Bash", {"command": str(a.get("command", ""))}
    if tool_name == "execute_code":
        return "Bash", {"command": str(a.get("code", ""))}
    if tool_name == "read_file":
        return "Read", {"file_path": str(a.get("path", ""))}
    if tool_name == "write_file":
        return "Write", {"file_path": str(a.get("path", "")), "content": str(a.get("content", ""))}
    if tool_name == "patch":
        return "Edit", {"file_path": str(a.get("path", "")), "old_string": str(a.get("old_string", "")), "new_string": str(a.get("new_string", a.get("patch", "")))}
    if tool_name == "search_files":
        return "Grep", {"pattern": str(a.get("pattern", "")), "path": str(a.get("path", ""))}
    if tool_name == "web_search":
        return "WebSearch", {"query": str(a.get("query", ""))}
    if tool_name == "web_extract":
        urls = a.get("urls") or []
        return "WebFetch", {"url": str(urls[0] if isinstance(urls, list) and urls else a.get("url", ""))}
    if tool_name == "browser_navigate":
        return "WebFetch", {"url": str(a.get("url", ""))}
    origin = origin_of(tool_name)
    if origin.startswith("mcp:"):
        server = origin[4:]
        prefix = "mcp_" + server.replace("-", "_") + "_"
        return f"mcp__{server}__{tool_name[len(prefix):] if tool_name.startswith(prefix) else tool_name}", a
    return f"mcp__hermes__{tool_name}", a


class WardenPlugin:
    def __init__(self, guard: Optional[AgentGuard] = None):
        self.guard = guard or AgentGuard()
        self.flow = os.environ.get("WARDEN_HERMES_FLOW", "on").strip().lower() not in ("off", "0", "false")
        self.notes: Dict[str, str] = {}

    # --- model boundary ---------------------------------------------------------------------------------------------

    def on_llm_request(self, request: Dict[str, Any] = None, session_id: str = "", **_: Any) -> Optional[dict]:
        """Every provider request: the conversation with credentials (and enabled personal data) as placeholders."""
        if not isinstance(request, dict):
            return None
        session = session_id or "default"
        changed = False
        out = dict(request)
        try:
            msgs = request.get("messages")
            if isinstance(msgs, list):
                new_msgs = []
                for m in msgs:
                    if isinstance(m, dict):
                        m, did = self._mask_message(session, m)
                        changed = changed or did
                    new_msgs.append(m)
                out["messages"] = new_msgs
            for key in ("input", "instructions", "system"):
                if key in request and request[key]:
                    r = self.guard.call("mask", {"session": session, "origin": "agent", "value": request[key], "history": True, "note": False})
                    if r.get("total"):
                        out[key], changed = r["value"], True
        except Refused:
            return None
        except GuardUnavailable as e:
            logger.error("WARDEN masking unavailable, request sent unmasked: %s", e)
            return None
        return {"request": out, "source": "warden", "reason": "masked credentials/personal data"} if changed else None

    def _mask_message(self, session: str, m: Dict[str, Any]) -> tuple:
        role = m.get("role")
        origin = "user" if role == "user" else "agent"
        fields = {k: m[k] for k in ("content", "tool_calls") if k in m and m[k]}
        if not fields:
            return m, False
        r = self.guard.call("mask", {"session": session, "origin": origin, "value": fields, "history": True, "note": False})
        if not r.get("total"):
            return m, False
        return {**m, **r["value"]}, True

    # --- tool results -----------------------------------------------------------------------------------------------

    def transform_tool_result(self, tool_name: str = "", args: Any = None, result: Any = None, session_id: str = "",
                              tool_call_id: str = "", **_: Any) -> Optional[str]:
        if not isinstance(result, str):
            return None
        session = session_id or "default"
        note = self.notes.pop(tool_call_id, None) if tool_call_id else None
        try:
            parsed: Any = json.loads(result)
            structured = isinstance(parsed, (dict, list))
        except ValueError:
            parsed, structured = result, False
        try:
            r = self.guard.call("mask", {"session": session, "origin": origin_of(tool_name), "tool": tool_name, "value": parsed})
        except (GuardUnavailable, Refused) as e:
            return json.dumps({"error": f"Result withheld by WARDEN: masking is unavailable ({e}). The tool already ran."})
        if not r.get("total") and not note:
            return None
        value = r["value"] if r.get("total") else parsed
        text = json.dumps(value, ensure_ascii=False) if structured else value
        extra = "\n".join(x for x in (r.get("note"), f"[WARDEN] {note}" if note else None) if x)
        if not extra:
            return text
        if structured and isinstance(value, dict):
            return json.dumps({**value, "warden_note": extra}, ensure_ascii=False)
        return f"{text}\n\n{extra}"

    # --- tool calls -------------------------------------------------------------------------------------------------

    def on_tool_execution(self, tool_name: str = "", args: Dict[str, Any] = None, next_call=None, session_id: str = "", **_: Any) -> Any:
        """The tool runs with real values in place of the placeholders the policy lets this destination have."""
        try:
            r = self.guard.call("restore", {"session": session_id or "default", "server": origin_of(tool_name), "tool": tool_name, "value": args or {}})
        except Refused as e:
            return json.dumps({"error": str(e)})
        except GuardUnavailable as e:
            if "WARDEN_" in json.dumps(args or {}) or "warden_email_" in json.dumps(args or {}):
                return json.dumps({"error": f"Refused by WARDEN: masking is unavailable ({e}), so the placeholders in this call cannot be resolved."})
            return next_call(args)
        return next_call(r["value"] if r.get("restored") else args)

    def pre_tool_call(self, tool_name: str = "", args: Dict[str, Any] = None, session_id: str = "", **_: Any) -> Optional[dict]:
        if not self.flow:
            return None
        session = session_id or "default"
        try:
            # The flow guard judges the call as it will run: with the real values put back.
            real = self.guard.call("restore", {"session": session, "server": origin_of(tool_name), "tool": tool_name, "value": args or {}})["value"]
            name, inp = flow_call(tool_name, real)
            d = self.guard.call("pre", {"session": session, "tool_name": name, "tool_input": inp, "cwd": os.getcwd()})
        except Refused as e:
            return {"action": "block", "message": str(e)}
        except GuardUnavailable as e:
            return {"action": "block", "message": f"Refused: the WARDEN flow guard is unavailable ({e})."}
        if d.get("decision") == "deny":
            return {"action": "block", "message": d.get("reason") or "Refused by the WARDEN flow guard."}
        if d.get("decision") == "ask":
            # One rule key per exact call: "always allow" in Hermes' prompt must not approve the next, different call.
            key = hashlib.sha256(json.dumps([tool_name, args], sort_keys=True, default=str).encode()).hexdigest()[:16]
            return {"action": "approve", "message": d.get("reason") or "WARDEN asks before this call.", "rule_key": f"warden:{tool_name}:{key}"}
        return None

    def post_tool_call(self, tool_name: str = "", args: Dict[str, Any] = None, result: Any = None, session_id: str = "",
                       tool_call_id: str = "", status: str = "", **_: Any) -> None:
        if not self.flow:
            return
        try:
            real = self.guard.call("restore", {"session": session_id or "default", "server": origin_of(tool_name), "tool": tool_name, "value": args or {}})["value"]
        except (Refused, GuardUnavailable):
            real = args or {}
        name, inp = flow_call(tool_name, real)
        try:
            out = self.guard.call("post", {"session": session_id or "default", "tool_name": name, "tool_input": inp,
                                           "tool_response": result, "tool_error": status in ("error", "blocked"), "cwd": os.getcwd()})
            if out.get("note") and tool_call_id:
                self.notes[tool_call_id] = out["note"]
        except (Refused, GuardUnavailable) as e:
            logger.error("WARDEN flow guard could not record %s: %s", tool_name, e)

    # --- the person's view ------------------------------------------------------------------------------------------

    def transform_llm_output(self, response_text: str = "", session_id: str = "", **_: Any) -> Optional[str]:
        if not response_text or "warden_" not in response_text.lower():
            return None
        try:
            r = self.guard.call("reveal", {"session": session_id or "default", "text": response_text})
        except (Refused, GuardUnavailable):
            return None
        return r["text"] if r.get("text") != response_text else None


_PLUGIN: Optional[WardenPlugin] = None


def register(ctx) -> None:
    global _PLUGIN
    _PLUGIN = WardenPlugin()
    p = _PLUGIN
    try:
        cfg = p.guard.call("config", {})
        # States only (on/off and the profile name): no value of any kind is logged.
        logger.info("WARDEN ready: masking %s, personal-data profile %s, flow guard %s",
                    "on" if cfg["credentials"]["enabled"] else "off",
                    cfg["personal"]["profile"] if cfg["personal"]["enabled"] else "off", "on" if p.flow else "off")
    except Exception as e:  # the first call retries; every later call is fail-closed while it stays down
        logger.error("WARDEN agent-guard did not start: %s", e)
    ctx.register_middleware("llm_request", p.on_llm_request)
    ctx.register_middleware("tool_execution", p.on_tool_execution)
    ctx.register_hook("transform_tool_result", p.transform_tool_result)
    ctx.register_hook("pre_tool_call", p.pre_tool_call)
    ctx.register_hook("post_tool_call", p.post_tool_call)
    ctx.register_hook("transform_llm_output", p.transform_llm_output)
