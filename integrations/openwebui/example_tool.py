"""
title: Mail (guarded by WARDEN)
author: AIMarket (alexar76)
version: 0.1.0
license: MIT
description: Example OpenWebUI tool whose methods are checked by the WARDEN gateway before they run.
"""
# The WARDEN guard block from warden_guard.py goes here, pasted in full: OpenWebUI imports a Tool as one file.
# For this example (and its tests) it is imported instead.
try:
    from warden_guard import warden_guard  # noqa: F401
except ImportError:  # pragma: no cover - in OpenWebUI the block is pasted above
    raise

from pydantic import BaseModel, Field


class Tools:
    class Valves(BaseModel):
        warden_url: str = Field(default="http://127.0.0.1:8787")
        warden_token: str = Field(default="")
        warden_approve_token: str = Field(default="")

    def __init__(self):
        self.valves = self.Valves()

    @warden_guard(server="mail", risky=True)
    async def send_email(self, to: str, subject: str, body: str,
                         __user__: dict = None, __metadata__: dict = None, __event_call__=None, __event_emitter__=None) -> str:
        """
        Send an email.
        :param to: recipient address
        :param subject: subject line
        :param body: message text
        """
        return f"sent to {to}"

    @warden_guard(server="mail")
    async def search_inbox(self, query: str,
                           __user__: dict = None, __metadata__: dict = None, __event_call__=None, __event_emitter__=None) -> str:
        """
        Search the user's inbox.
        :param query: words to look for
        """
        return f"3 messages match {query}"
