# --- WARDEN guard for OpenWebUI Python tools: paste this block at the top of a Tool file (see example_tool.py). ---
#
# OpenWebUI runs its own Python tools in-process, out of any proxy's sight. `@warden_guard(...)` asks the WARDEN gateway
# before each call (/v1/pre) and records the result after it (/v1/post), on the chat's flow-guard state:
# - allow: the tool runs;
# - deny: the tool does not run; the model reads the reason;
# - ask: OpenWebUI's confirmation dialog shows the tool, the masked arguments and WARDEN's reason; the person's answer
#   goes to /v1/approve and only a "yes" lets this exact call run. Without a dialog (no browser session) the model reads
#   the approval code, the person may type it, and the call can be repeated.
# If the gateway cannot be reached (connection refused, timeout), a tool marked risky=True — the default — is refused;
# a tool declared risky=False (it only reads the user's own data) runs, and the chat shows that protection is off.
# Any answer from the gateway that is an error (4xx/5xx) refuses the call: an error is not an outage.
#
# The decorated method must declare __user__, __metadata__ and __event_call__ (and may declare __event_emitter__):
# OpenWebUI passes them only to methods that ask for them. Settings come from the Tool's Valves: warden_url,
# warden_token, warden_approve_token.
import asyncio as _w_asyncio
import functools as _w_functools
import json as _w_json
import urllib.error as _w_urlerror
import urllib.request as _w_request


class WardenUnavailable(Exception):
    """The gateway could not be reached at all."""


class WardenRefused(Exception):
    """The gateway answered with an error: the call is refused, never run."""


def _warden_post(url: str, token: str, body: dict, timeout: float) -> dict:
    req = _w_request.Request(url, data=_w_json.dumps(body, default=str).encode(), method="POST",
                             headers={"content-type": "application/json", "authorization": f"Bearer {token}"})
    try:
        with _w_request.urlopen(req, timeout=timeout) as r:
            return _w_json.loads(r.read().decode() or "{}")
    except _w_urlerror.HTTPError as e:
        try:
            detail = _w_json.loads(e.read().decode()).get("error", "")
        except Exception:
            detail = ""
        raise WardenRefused(f"HTTP {e.code} {detail}".strip()) from None
    except Exception as e:  # connection refused, DNS, timeout
        raise WardenUnavailable(type(e).__name__) from None


def warden_guard(server: str = "openwebui", risky: bool = True, timeout: float = 10.0):
    """Guard one tool method. `server` names the toolkit to the flow policy: the call is mcp__<server>__<method>."""

    def wrap(fn):
        @_w_functools.wraps(fn)
        async def guarded(self, *args, **kwargs):
            valves = getattr(self, "valves", None)
            base = str(getattr(valves, "warden_url", "http://127.0.0.1:8787")).rstrip("/")
            token = str(getattr(valves, "warden_token", ""))
            approve_token = str(getattr(valves, "warden_approve_token", "")) or token
            user = kwargs.get("__user__") or {}
            meta = kwargs.get("__metadata__") or {}
            event_call = kwargs.get("__event_call__")
            emitter = kwargs.get("__event_emitter__")
            who = {"chat_id": str(meta.get("chat_id") or ""), "user_id": str(user.get("id") or "")}
            tool_input = {k: v for k, v in kwargs.items() if not k.startswith("__")}
            call = {**who, "server": server, "tool_name": fn.__name__, "tool_input": tool_input}

            async def post(path, body, tok=token):
                return await _w_asyncio.to_thread(_warden_post, base + path, tok, body, timeout)

            async def status(text):
                if emitter:
                    try:
                        await emitter({"type": "status", "data": {"description": text, "done": True}})
                    except Exception:
                        pass

            try:
                pre = await post("/v1/pre", call)
                if pre.get("decision") == "ask" and event_call and pre.get("code"):
                    answer = await event_call({"type": "confirmation", "data": {
                        "title": f"WARDEN: подтвердите {fn.__name__}",
                        "message": f"{pre.get('message', '')}\n\nАргументы:\n```\n{pre.get('preview', '')}\n```"}})
                    if answer is True or answer is False:
                        await post("/v1/approve", {**who, "code": pre["code"], "approved": answer}, approve_token)
                        if answer is False:
                            return f"Refused: the user declined {fn.__name__} in the WARDEN confirmation."
                        pre = await post("/v1/pre", call)
                    # No dialog answer (no browser session): the refusal below carries the code for the person to type.
                if pre.get("decision") != "allow":
                    return pre.get("refusal") or "Refused by the WARDEN flow guard."
                if isinstance(pre.get("tool_input"), dict):
                    # Placeholders the model passed become the real values the masking policy allows for this tool.
                    kwargs = {**kwargs, **{k: v for k, v in pre["tool_input"].items() if not k.startswith("__")}}
            except WardenRefused as e:
                return f"Refused by WARDEN ({e}): {fn.__name__} was not run."
            except WardenUnavailable as e:
                await status(f"WARDEN недоступен ({e}): {fn.__name__} {'не выполнен' if risky else 'выполнен без проверки'}")
                if risky:
                    return f"Refused: the WARDEN gateway is unavailable ({e}) and {fn.__name__} sends data out or changes things."
                return await fn(self, *args, **kwargs)

            error = False
            try:
                result = await fn(self, *args, **kwargs)
            except Exception as e:
                error, result = True, f"{type(e).__name__}: {e}"
            try:
                out = await post("/v1/post", {**call, "tool_response": result if isinstance(result, (str, dict, list)) else str(result), "tool_error": error})
            except (WardenUnavailable, WardenRefused) as e:
                await status(f"WARDEN недоступен ({e}): результат {fn.__name__} не записан")
                return f"Result withheld: the WARDEN gateway could not record it ({e}). The tool already ran."
            if out.get("withhold"):
                return f"Tool result withheld by WARDEN: it reads as instructions to the model ({', '.join(out.get('codes') or [])}). The tool already ran."
            if "tool_response" in out:
                result = out["tool_response"]  # masked: credentials and enabled personal data replaced by placeholders
            if isinstance(result, str):
                notice, note = out.get("notice"), out.get("flowNote")
                return "\n\n".join(x for x in (notice, result, f"[WARDEN] {note}" if note else None, out.get("mask_note")) if x)
            return result

        return guarded

    return wrap
# --- end of the WARDEN guard block ---
