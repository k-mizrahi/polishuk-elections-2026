"""Thin Supabase PostgREST client for the pipeline (service-role key).

No supabase-py dependency — the pipeline needs four verbs and full control
over headers. All multi-row writes go through SQL RPCs (docs/04 §RPCs) so
they are transactional; plain REST is used only for reads and single-row
bookkeeping updates.
"""
from __future__ import annotations

import os

import requests


class Supa:
    def __init__(self, url: str | None = None, key: str | None = None):
        self.url = (url or os.environ["SUPABASE_URL"]).rstrip("/")
        self.key = key or os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        self.s = requests.Session()
        self.s.headers.update({
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
        })

    def get(self, table: str, **params) -> list[dict]:
        """params are PostgREST query params, e.g. select='*', status='eq.open'.
        Use or_=... for PostgREST's `or` (Python keyword)."""
        if "or_" in params:
            params["or"] = params.pop("or_")
        r = self.s.get(f"{self.url}/rest/v1/{table}", params=params, timeout=60)
        r.raise_for_status()
        return r.json()

    def patch(self, table: str, values: dict, **params) -> None:
        r = self.s.patch(f"{self.url}/rest/v1/{table}", json=values,
                         params=params, timeout=60)
        r.raise_for_status()

    def upsert(self, table: str, rows: list[dict], on_conflict: str) -> None:
        r = self.s.post(
            f"{self.url}/rest/v1/{table}", json=rows,
            params={"on_conflict": on_conflict},
            headers={"Prefer": "resolution=merge-duplicates"}, timeout=60)
        r.raise_for_status()

    def rpc(self, fn: str, args: dict):
        r = self.s.post(f"{self.url}/rest/v1/rpc/{fn}", json=args, timeout=120)
        r.raise_for_status()
        return r.json() if r.text else None

    def get_setting(self, key: str, default=None):
        rows = self.get("app_settings", select="value", key=f"eq.{key}")
        return rows[0]["value"] if rows else default

    def set_setting(self, key: str, value) -> None:
        self.upsert("app_settings", [{"key": key, "value": value}], on_conflict="key")
