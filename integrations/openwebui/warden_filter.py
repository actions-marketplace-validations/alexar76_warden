"""
title: WARDEN flow guard
author: AIMarket (alexar76)
version: 0.2.0
license: MIT
description: Tells the WARDEN gateway what happens in a chat (the user's own words, web search, documents, files, approval codes) so it can refuse a send or a destructive call made after the model read someone else's text; masks credentials (and personal data, when the gateway has it on) in what the model reads and shows the person the real values in the answer.
requirements:
"""
# Install: Admin Panel -> Functions -> Import (this one file) -> enable it and make it Global.
# Settings (Valves): gateway_url, token, approve_token. The gateway itself is `warden-mcp gateway --config gateway.json`.
#
# What this filter does, and nothing more (every decision is the gateway's):
# - inlet: if the user's last message is "<phrase> <CODE>", approves that code (/v1/approve); records the message as the
#   user's own words (/v1/prompt); records outside text this turn will read (/v1/source): web search, attached files,
#   knowledge collections, fetched pages.
# - inlet, masking (mask_messages, default on): the chat's text goes to the model with credentials replaced by placeholders
#   (WARDEN_SECRET_…), and personal data too when the gateway's mask config turns it on (/v1/mask). The table that links
#   a placeholder to its value stays in the gateway's memory.
# - outlet: records the sources the answer was built from (web pages it cites); with reveal_answers (default on) the
#   person sees the answer with personal data back in place of its placeholders (/v1/reveal); credentials stay masked.
# - built-in tools: the model's placeholders become real values for the tool (/v1/pre returns tool_input), and the
#   result reaches the model masked (/v1/post returns tool_response).
# - guard_builtin_tools (default on): wraps OpenWebUI's built-in and integrated terminal tools in the chat middleware.
#   Like @warden_guard for a Python tool, it calls /v1/pre before execution (a confirmation dialog for `ask`) and
#   /v1/post before returning the result. If get_builtin_tools is unavailable, the inlet still reports web search.
# An approval code is taken ONLY from the last message with role "user", never from model output or a document.

import asyncio
import json
import re
import urllib.error
import urllib.request
from functools import wraps
from hashlib import sha256
from typing import Any, Optional

try:  # OpenWebUI ships pydantic; the fallback keeps the file importable in plain tests.
    from pydantic import BaseModel, Field
except ImportError:  # pragma: no cover
    class BaseModel:  # type: ignore
        def __init__(self, **kw):
            for k, v in type(self).__dict__.items():
                if not k.startswith("_") and not callable(v):
                    setattr(self, k, kw.get(k, v))

    def Field(default=None, **_kw):  # type: ignore
        return default


CODE = re.compile(r"^\s*(?P<phrase>[^\W\d_]{2,30})\s+(?P<code>[A-Za-z0-9]{4,8})\s*[.!]?\s*$", re.UNICODE)


class GatewayUnavailable(Exception):
    """The gateway could not be reached at all."""


class GatewayRefused(Exception):
    """The gateway answered with an error: whatever was asked is refused."""


# The Filter instance OpenWebUI created last (its valves are read at call time) and whether the wrap is in place.
_STATE = {"filter": None, "builtin_guard": False}
# Built-in tools that neither read outside text nor act: the only ones that run when the gateway cannot be reached.
SAFE_BUILTIN = {"get_current_timestamp", "calculate_timestamp", "ask_user", "view_skill"}


def _jsonable(v: Any) -> Any:
    try:
        json.dumps(v)
        return v
    except (TypeError, ValueError):
        return str(v)


def _wrap_tool(name: str, fn, extra_params: dict, policy_name: str):
    # Preserve the callable's signature without copying OpenWebUI's __function__ / __extra_params__.
    # The middleware would otherwise rebuild the callable from those fields and drop the guard.
    @wraps(fn, updated=())
    async def guarded(*args, **kwargs):
        f = _STATE["filter"]
        if f is None or not f.valves.guard_builtin_tools:
            return await fn(*args, **kwargs)
        meta = (extra_params or {}).get("__metadata__") or {}
        user = (extra_params or {}).get("__user__") or {}
        who = {"chat_id": str(meta.get("chat_id") or (extra_params or {}).get("__chat_id__") or ""), "user_id": str(user.get("id") or "")}
        call = {**who, "server": "builtin", "tool_name": policy_name, "tool_input": {k: _jsonable(v) for k, v in kwargs.items() if not k.startswith("__")}}
        event_call = (extra_params or {}).get("__event_call__")
        emitter = (extra_params or {}).get("__event_emitter__")
        try:
            pre = await f._call("/v1/pre", call)
            if pre.get("decision") == "ask" and event_call and pre.get("code"):
                answer = await event_call({"type": "confirmation", "data": {
                    "title": f"WARDEN: подтвердите {name}",
                    "message": f"{pre.get('message', '')}\n\nАргументы:\n```\n{pre.get('preview', '')}\n```"}})
                if answer is True or answer is False:
                    await f._call("/v1/approve", {**who, "code": pre["code"], "approved": answer}, approve=True)
                    if answer is False:
                        return f"Refused: the user declined {name} in the WARDEN confirmation."
                    pre = await f._call("/v1/pre", call)
                # No dialog answer (no browser session): the refusal below carries the code for the person to type.
            if pre.get("decision") != "allow":
                return pre.get("refusal") or "Refused by the WARDEN flow guard."
            if isinstance(pre.get("tool_input"), dict):
                # The model passed placeholders; the tool gets the real values the masking policy allows.
                kwargs = {**kwargs, **{k: v for k, v in pre["tool_input"].items() if not k.startswith("__")}}
        except GatewayRefused as e:
            return f"Refused by WARDEN ({e}): {name} was not run."
        except GatewayUnavailable as e:
            safe = policy_name in SAFE_BUILTIN
            await f._warn(emitter, f"WARDEN недоступен ({e}): {name} {'выполнен без проверки' if safe else 'не выполнен'}")
            if not safe:
                return f"Refused: the WARDEN gateway is unavailable ({e}), so {name} cannot be checked."
            return await fn(*args, **kwargs)
        error = False
        try:
            result = await fn(*args, **kwargs)
        except Exception as e:  # recorded like any other result, then raised as OpenWebUI expects
            error, result = True, e
        try:
            out = await f._call("/v1/post", {**call, "tool_response": _jsonable(result) if not error else f"{type(result).__name__}: {result}", "tool_error": error})
        except (GatewayUnavailable, GatewayRefused) as e:
            await f._warn(emitter, f"WARDEN недоступен ({e}): результат {name} не записан")
            return f"Result withheld: the WARDEN gateway could not record it ({e})."
        if error:
            raise result
        if out.get("withhold"):
            return f"Tool result withheld by WARDEN: it reads as instructions to the model ({', '.join(out.get('codes') or [])})."
        if "tool_response" in out:
            # Masked by the gateway: the model reads placeholders, never the credentials or personal data in the result.
            result = out["tool_response"]
        if isinstance(result, str):
            notice, note = out.get("notice"), out.get("flowNote")
            return "\n\n".join(x for x in (notice, result, f"[WARDEN] {note}" if note else None, out.get("mask_note")) if x)
        return result

    guarded.__warden_guarded__ = True
    return guarded


def _guard_tools(tools, extra_params: dict, prefix: str = "") -> None:
    for name, tool in (tools or {}).items():
        if isinstance(tool, dict) and callable(tool.get("callable")) and not getattr(tool["callable"], "__warden_guarded__", False):
            tool["callable"] = _wrap_tool(name, tool["callable"], extra_params, prefix + name)


def install_builtin_guard() -> bool:
    """Wrap the middleware's tool factories, including on versions with integrated terminals."""
    try:
        import open_webui.utils.middleware as mw  # noqa: PLC0415 - only inside OpenWebUI
    except Exception:
        return False
    builtin = getattr(mw, "get_builtin_tools", None)
    if callable(builtin):
        original_builtin = getattr(builtin, "__warden_original__", builtin)

        async def get_builtin_tools(request, extra_params, *args, **kwargs):
            tools = await original_builtin(request, extra_params, *args, **kwargs)
            _guard_tools(tools, extra_params)
            return tools

        get_builtin_tools.__warden_original__ = original_builtin
        mw.get_builtin_tools = get_builtin_tools

    terminal = getattr(mw, "get_terminal_tools", None)
    if callable(terminal):
        original_terminal = getattr(terminal, "__warden_original__", terminal)

        async def get_terminal_tools(request, terminal_id, user, extra_params, *args, **kwargs):
            result = await original_terminal(request, terminal_id, user, extra_params, *args, **kwargs)
            tools = result[0] if isinstance(result, tuple) else result
            # Include the connection in the tool identity so approval for one terminal cannot authorize another.
            connection = sha256(terminal_id.encode()).hexdigest()[:24]
            context = {**extra_params, "__user__": {"id": user.id}}
            _guard_tools(tools, context, f"terminal:{connection}:")
            return result

        get_terminal_tools.__warden_original__ = original_terminal
        mw.get_terminal_tools = get_terminal_tools
    _STATE["builtin_guard"] = callable(builtin)
    return _STATE["builtin_guard"]


def _post(url: str, token: str, body: dict, timeout: float) -> dict:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"content-type": "application/json", "authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read().decode()).get("error", "")
        except Exception:
            detail = ""
        raise GatewayRefused(f"HTTP {e.code} {detail}".strip()) from None
    except Exception as e:  # connection refused, timeout, bad JSON
        raise GatewayUnavailable(type(e).__name__) from None


def _text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text")
    return ""


def last_user_text(messages: Any) -> str:
    for m in reversed(messages if isinstance(messages, list) else []):
        if isinstance(m, dict) and m.get("role") == "user":
            return _text(m.get("content"))
    return ""


def approval_code(text: str, phrases: list) -> Optional[str]:
    m = CODE.match(text or "")
    if not m or m.group("phrase").lower() not in phrases:
        return None
    return m.group("code").upper()


def file_sources(files: Any) -> list:
    """(kind, name, url) for each attached file, knowledge collection or fetched page."""
    out = []
    for f in files if isinstance(files, list) else []:
        if not isinstance(f, dict):
            continue
        t = f.get("type") or ""
        name = str(f.get("name") or (f.get("file") or {}).get("filename") or f.get("id") or "")[:500]
        url = f.get("url") if isinstance(f.get("url"), str) else ""
        if t in ("web", "url") or (url and re.match(r"^https?://", url) and t not in ("file", "collection")):
            out.append(("url", name, url))
        elif t == "collection" or f.get("collection_names") or f.get("legacy"):
            out.append(("knowledge", name, ""))
        else:
            out.append(("file", name, ""))
    return out


def answer_sources(messages: Any) -> list:
    """Web URLs the last assistant message cites (OpenWebUI `sources`)."""
    for m in reversed(messages if isinstance(messages, list) else []):
        if isinstance(m, dict) and m.get("role") == "assistant":
            urls = []
            for s in m.get("sources") or []:
                if not isinstance(s, dict):
                    continue
                for meta in s.get("metadata") or []:
                    u = meta.get("source") if isinstance(meta, dict) else None
                    if isinstance(u, str) and re.match(r"^https?://", u):
                        urls.append(u)
                u = (s.get("source") or {}).get("url") if isinstance(s.get("source"), dict) else None
                if isinstance(u, str) and re.match(r"^https?://", u):
                    urls.append(u)
            return list(dict.fromkeys(urls))[:50]
    return []


class Filter:
    class Valves(BaseModel):
        gateway_url: str = Field(default="http://127.0.0.1:8787", description="WARDEN gateway base URL")
        token: str = Field(default="", description="Gateway bearer token (WARDEN_GATEWAY_TOKEN)")
        approve_token: str = Field(default="", description="Token for /v1/approve if the gateway sets approveTokenEnv; else leave empty")
        approve_phrases: str = Field(default="подтверждаю,approve", description="Words the user types before an approval code")
        guard_builtin_tools: bool = Field(default=True, description="Check OpenWebUI's built-in and integrated terminal tools with WARDEN before and after each chat tool call")
        native_tools_read_outside_text: bool = Field(default=False, description="Treat every chat whose model may call OpenWebUI's built-in web/knowledge tools as having read outside text (only needed when guard_builtin_tools is off)")
        mask_messages: bool = Field(default=True, description="Send the chat's messages to the model with credentials (and personal data, when the gateway's mask config has it on) replaced by placeholders")
        mask_fail_closed: bool = Field(default=False, description="If the gateway cannot mask a message, do not send it to the model (for organisations that must not send personal data to the model provider)")
        reveal_answers: bool = Field(default=True, description="Show the person the answer with personal data back in place of its placeholders (credentials stay masked)")
        timeout_seconds: float = Field(default=5.0, description="Per request to the gateway")
        priority: int = Field(default=-100, description="Run before other filters")

    def __init__(self):
        self.valves = self.Valves()
        _STATE["filter"] = self
        install_builtin_guard()

    async def _call(self, path: str, body: dict, approve: bool = False) -> dict:
        token = (self.valves.approve_token or self.valves.token) if approve else self.valves.token
        url = self.valves.gateway_url.rstrip("/") + path
        return await asyncio.to_thread(_post, url, token, body, float(self.valves.timeout_seconds))

    async def _warn(self, emitter, text: str) -> None:
        if emitter:
            try:
                await emitter({"type": "status", "data": {"description": text, "done": True}})
            except Exception:
                pass

    async def _approve(self, who: dict, code: str, event_call, emitter) -> None:
        """The person typed an approval code. Show them what it approves (OpenWebUI's dialog when there is one), then answer."""
        peek = await self._call("/v1/approve", {**who, "code": code, "peek": True}, approve=True)
        if not peek.get("ok"):
            await self._warn(emitter, "WARDEN: код не подошёл или устарел")
            return
        tool, preview = peek.get("tool", ""), peek.get("preview", "")
        # The typed code is the person's answer; the dialog only lets them take it back. Only an explicit Cancel declines:
        # without a browser session OpenWebUI answers the dialog with an error object, which is not a "no".
        approved = True
        if event_call:
            try:
                answer = await event_call({"type": "confirmation", "data": {
                    "title": f"WARDEN: подтвердить {tool}?",
                    "message": f"Код {code} разрешит один вызов {tool} с этими аргументами:\n```\n{preview}\n```"}})
            except Exception:
                answer = None
            if answer is False:
                approved = False
        r = await self._call("/v1/approve", {**who, "code": code, "approved": approved}, approve=True)
        if r.get("ok") and approved:
            await self._warn(emitter, f"WARDEN: подтверждён один вызов {tool}: {preview[:300]}")
        elif r.get("ok"):
            await self._warn(emitter, f"WARDEN: вызов {tool} отклонён")
        else:
            await self._warn(emitter, "WARDEN: код не подошёл или устарел")

    async def inlet(self, body: dict, __user__: Optional[dict] = None, __metadata__: Optional[dict] = None,
                    __event_emitter__=None, __event_call__=None) -> dict:
        meta = __metadata__ or {}
        chat_id = str(meta.get("chat_id") or body.get("chat_id") or "")
        user_id = str((__user__ or {}).get("id") or "")
        if not chat_id:
            # No chat id: the gateway judges this chat's proxied tool calls as made after outside text.
            return body
        who = {"chat_id": chat_id, "user_id": user_id}
        text = last_user_text(body.get("messages"))
        phrases = [p.strip().lower() for p in self.valves.approve_phrases.split(",") if p.strip()]
        try:
            code = approval_code(text, phrases)
            if code:
                await self._approve(who, code, __event_call__, __event_emitter__)
        except (GatewayUnavailable, GatewayRefused) as e:
            await self._warn(__event_emitter__, f"WARDEN: код не принят ({e})")
        first = False
        try:
            if text:
                first = bool((await self._call("/v1/prompt", {**who, "prompt": text})).get("first"))
        except (GatewayUnavailable, GatewayRefused) as e:
            # Not recorded as the person's words: later destinations they named are judged as unnamed (stricter).
            await self._warn(__event_emitter__, f"WARDEN недоступен ({e}): сообщение не записано")
        _STATE["filter"] = self
        native = (meta.get("params") or {}).get("function_calling") != "legacy"
        guarded = self.valves.guard_builtin_tools and _STATE["builtin_guard"]
        features = body.get("features") or meta.get("features") or {}
        sources = []
        # A chat the gateway has no state for (new to it, removed after retention, older than the install) but with earlier
        # messages: what those messages brought in is unknown, so it counts as outside text.
        history = [m for m in (body.get("messages") or [])[:-1] if isinstance(m, dict) and m.get("role") in ("user", "assistant")]
        if first and history:
            sources.append({"kind": "other", "name": "earlier messages of this chat"})
        # In native function calling a guarded search_web records what it really read, when it reads it; the legacy mode
        # searches before the model runs and puts the results into its prompt.
        if features.get("web_search") and not (native and guarded):
            sources.append({"kind": "web_search", "query": text[:2000]})
        for kind, name, url in file_sources(body.get("files") or meta.get("files")):
            sources.append({"kind": kind, "name": name, **({"url": url} if url else {})})
        if self.valves.native_tools_read_outside_text and native and not guarded:
            sources.append({"kind": "other", "name": "built-in tools"})
        failed = None
        history_failed = False
        for src in sources:
            try:
                await self._call("/v1/source", {**who, **src})
            except (GatewayUnavailable, GatewayRefused) as e:
                failed = e
                history_failed = history_failed or src.get("name") == "earlier messages of this chat"
        if history_failed:
            # The chat's earlier messages are outside text WARDEN could not record: the model gets this message without
            # them (system prompt and the person's last message only).
            msgs = body.get("messages") or []
            body["messages"] = [m for m in msgs[:-1] if isinstance(m, dict) and m.get("role") == "system"] + msgs[-1:]
            await self._warn(__event_emitter__, f"WARDEN недоступен ({failed}): ранние сообщения чата не переданы модели")
        if failed:
            # Outside text that WARDEN could not record must not reach the model: this message goes without its web
            # search and files.
            body.pop("files", None)
            if isinstance(meta.get("files"), list):
                meta["files"] = []
            if isinstance(body.get("metadata"), dict):
                body["metadata"].pop("files", None)
            if isinstance(body.get("features"), dict):
                body["features"]["web_search"] = False
            await self._warn(__event_emitter__, f"WARDEN недоступен ({failed}): веб-поиск и файлы для этого сообщения отключены")
        if self.valves.mask_messages:
            await self._mask_messages(who, body, __event_emitter__)
        return body

    async def _mask_messages(self, who: dict, body: dict, emitter) -> None:
        """Replace credentials (and personal data, when on) in the text of every message with the gateway's placeholders.

        Only text: an image part's data URL is not text and is left alone. The person's own messages are masked with origin
        `user` (their personal data may go to any tool, a key they typed only where the policy names); every other message
        is history, whose known values keep the origins they had."""
        slots = []  # (message, part index or None, role)
        for m in body.get("messages") or []:
            if not isinstance(m, dict):
                continue
            content = m.get("content")
            if isinstance(content, str) and content:
                slots.append((m, None, m.get("role")))
            elif isinstance(content, list):
                for i, part in enumerate(content):
                    if isinstance(part, dict) and part.get("type") == "text" and isinstance(part.get("text"), str) and part["text"]:
                        slots.append((m, i, m.get("role")))
        if not slots:
            return

        def text_of(slot):
            m, i, _ = slot
            return m["content"] if i is None else m["content"][i]["text"]

        def set_text(slot, value):
            m, i, _ = slot
            if i is None:
                m["content"] = value
            else:
                m["content"][i] = {**m["content"][i], "text": value}

        try:
            for origin, group in (("user", [s for s in slots if s[2] == "user"]), ("chat", [s for s in slots if s[2] != "user"])):
                if not group:
                    continue
                r = await self._call("/v1/mask", {**who, **({"origin": "user"} if origin == "user" else {"server": "openwebui-chat"}),
                                                  "value": [text_of(s) for s in group], "history": True})
                values = r.get("value")
                if isinstance(values, list) and len(values) == len(group) and r.get("total"):
                    for s, v in zip(group, values):
                        if isinstance(v, str):
                            set_text(s, v)
        except (GatewayUnavailable, GatewayRefused) as e:
            if self.valves.mask_fail_closed:
                raise Exception(f"WARDEN could not mask this message ({e}); it was not sent to the model.") from None
            await self._warn(emitter, f"WARDEN недоступен ({e}): сообщения ушли модели без маскирования")

    async def outlet(self, body: dict, __user__: Optional[dict] = None, __metadata__: Optional[dict] = None,
                     __event_emitter__=None) -> dict:
        meta = __metadata__ or {}
        chat_id = str(meta.get("chat_id") or body.get("chat_id") or "")
        user_id = str((__user__ or {}).get("id") or "")
        if not chat_id:
            return body
        try:
            for url in answer_sources(body.get("messages")):
                await self._call("/v1/source", {"chat_id": chat_id, "user_id": user_id, "kind": "url", "url": url[:4000]})
        except (GatewayUnavailable, GatewayRefused) as e:
            await self._warn(__event_emitter__, f"WARDEN недоступен ({e})")
        if self.valves.reveal_answers:
            # The answer the person reads: personal data back in place of its placeholders (the gateway keeps credentials
            # masked). The next turn sends this text to the model again, and the inlet masks it again.
            msgs = [m for m in (body.get("messages") or []) if isinstance(m, dict)]
            last = msgs[-1] if msgs else None
            if last and last.get("role") == "assistant" and isinstance(last.get("content"), str) and "warden_" in last["content"].lower():
                try:
                    r = await self._call("/v1/reveal", {"chat_id": chat_id, "user_id": user_id, "text": last["content"]})
                    if isinstance(r.get("text"), str):
                        last["content"] = r["text"]
                except (GatewayUnavailable, GatewayRefused):
                    pass  # the person sees placeholders; nothing is lost
        return body
