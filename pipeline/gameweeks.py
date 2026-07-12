"""Game-week calendar helpers — docs/00 glossary, docs/04 game_weeks.

A game week runs Friday 00:00 – Thursday 23:59 Asia/Jerusalem (the "Friday→Friday"
poll window, docs/02 §2); bets for it lock at the week's own Friday 12:00 (⚠️
provisional, stored per-week in the DB — these helpers only generate the default
schedule). Poll membership keys on fieldwork_end within the window.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

IL_TZ = ZoneInfo("Asia/Jerusalem")
LOCK_TIME = time(12, 0)          # Friday noon
FRIDAY = 4                       # date.weekday(): Mon=0 … Fri=4


def week_start_for(d: date) -> date:
    """The Friday on or before d."""
    return d - timedelta(days=(d.weekday() - FRIDAY) % 7)


def week_end_for(d: date) -> date:
    return week_start_for(d) + timedelta(days=6)


def lock_at_for(week_start: date) -> datetime:
    """UTC-aware lock instant for the week starting at week_start (a Friday):
    that Friday at 12:00 Israel time."""
    local = datetime.combine(week_start, LOCK_TIME, tzinfo=IL_TZ)
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
