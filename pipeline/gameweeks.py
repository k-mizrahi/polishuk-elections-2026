"""Game-week calendar helpers — docs/00 glossary, docs/04 game_weeks.

A game week runs Sunday 00:00 – Saturday 23:59 Asia/Jerusalem; bets for it
lock the preceding Friday 12:00 (⚠️ provisional, stored per-week in the DB —
these helpers only generate the default schedule).
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

IL_TZ = ZoneInfo("Asia/Jerusalem")
LOCK_TIME = time(12, 0)          # Friday noon
LOCK_DAYS_BEFORE_WEEK = 2        # Friday precedes the Sunday week start


def week_start_for(d: date) -> date:
    """The Sunday on or before d."""
    return d - timedelta(days=(d.weekday() + 1) % 7)


def week_end_for(d: date) -> date:
    return week_start_for(d) + timedelta(days=6)


def lock_at_for(week_start: date) -> datetime:
    """UTC-aware lock instant for the week starting at week_start (a Sunday)."""
    local = datetime.combine(
        week_start - timedelta(days=LOCK_DAYS_BEFORE_WEEK), LOCK_TIME, tzinfo=IL_TZ)
    return local.astimezone(ZoneInfo("UTC"))


def generate_weeks(first: date, last: date) -> list[dict]:
    """Week rows (dicts matching game_weeks columns) covering [first, last]."""
    out = []
    ws = week_start_for(first)
    while ws <= last:
        out.append({
            "week_start": ws.isoformat(),
            "week_end": (ws + timedelta(days=6)).isoformat(),
            "lock_at": lock_at_for(ws).isoformat(),
        })
        ws += timedelta(days=7)
    return out
